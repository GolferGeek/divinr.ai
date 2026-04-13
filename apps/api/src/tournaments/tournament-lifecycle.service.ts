import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { NIL_UUID } from '@orchestrator-ai/transport-types';
import { TournamentSchemaService } from './tournament-schema.service';
import { TournamentLeaderboardService } from './tournament-leaderboard.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationService } from '../markets/services/notification.service';
import type { Tournament, TournamentEntry } from './tournament.types';

@Injectable()
export class TournamentLifecycleService {
  private readonly logger = new Logger(TournamentLifecycleService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(TournamentSchemaService) private readonly schema: TournamentSchemaService,
    @Inject(TournamentLeaderboardService) private readonly leaderboard: TournamentLeaderboardService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Optional() @Inject(ObservabilityEventsService) private readonly observability?: ObservabilityEventsService,
  ) {}

  /** Runs every 5 minutes to check tournament lifecycle transitions */
  @Cron('*/5 * * * *')
  async handleLifecycleCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_TOURNAMENT_LIFECYCLE === 'true') return;
    try {
      await this.processLifecycleTransitions();
    } catch (err) {
      this.logger.error(`Tournament lifecycle cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async processLifecycleTransitions(): Promise<void> {
    await this.schema.ensureSchema();

    // Transition upcoming → active
    await this.activateTournaments();

    // Transition active → completed
    await this.completeTournaments();

    // Send "starting soon" notifications
    await this.sendStartingSoonNotifications();
  }

  private async activateTournaments(): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments WHERE status = 'upcoming' AND starts_at <= now()`,
    );
    if (result.error) throw new Error(result.error.message);
    const tournaments = (result.data as Tournament[] | null) ?? [];

    for (const tournament of tournaments) {
      try {
        // Transition to active
        await this.db.rawQuery(
          `UPDATE prediction.tournaments SET status = 'active' WHERE id = $1`,
          [tournament.id],
        );

        // Create messaging channel
        const channel = await this.messaging.createChannel('tournament', tournament.id, tournament.name);
        await this.db.rawQuery(
          `UPDATE prediction.tournaments SET channel_id = $1 WHERE id = $2`,
          [channel.id, tournament.id],
        );

        // Add all entrants as channel members
        const entries = await this.getEntries(tournament.id);
        for (const entry of entries) {
          const role = entry.user_id === tournament.created_by ? 'admin' : 'member';
          await this.messaging.addChannelMember(channel.id, entry.user_id, role as 'member' | 'admin');
        }

        // Notify all entrants
        for (const entry of entries) {
          await this.notifications.notify(entry.user_id, {
            event_type: 'tournament_started',
            urgency: 'actionable',
            title: `${tournament.name} has started!`,
            summary: 'The tournament is now active. Queue your trades!',
            link_to: `/tournaments/${tournament.id}`,
          });
        }

        // Push SSE event
        await this.pushTournamentEvent('tournament_status_changed', tournament.id, 'active');

        this.logger.log(`Tournament ${tournament.id} (${tournament.name}) activated`);
      } catch (err) {
        this.logger.error(`Failed to activate tournament ${tournament.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async completeTournaments(): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.tournaments WHERE status = 'active' AND ends_at <= now()`,
    );
    if (result.error) throw new Error(result.error.message);
    const tournaments = (result.data as Tournament[] | null) ?? [];

    for (const tournament of tournaments) {
      try {
        // Finalize results (closes positions, sets rankings)
        await this.leaderboard.finalizeResults(tournament.id);

        // Transition to completed
        await this.db.rawQuery(
          `UPDATE prediction.tournaments SET status = 'completed' WHERE id = $1`,
          [tournament.id],
        );

        // Archive messaging channel
        if (tournament.channel_id) {
          await this.db.rawQuery(
            `UPDATE messaging.channels SET is_archived = true WHERE id = $1`,
            [tournament.channel_id],
          );
        }

        // Get final standings for notifications
        const leaderboardData = await this.leaderboard.getLeaderboard(tournament.id);
        const winner = leaderboardData[0];

        // Notify all entrants with results
        const entries = await this.getEntries(tournament.id);
        for (const entry of entries) {
          const rank = leaderboardData.find(l => l.user_id === entry.user_id)?.rank ?? 0;
          await this.notifications.notify(entry.user_id, {
            event_type: 'tournament_results',
            urgency: 'informational',
            title: `${tournament.name} has ended!`,
            summary: `You finished #${rank}. Winner: ${winner?.display_name ?? 'Unknown'} (${winner?.return_pct ?? 0}% return)`,
            link_to: `/tournaments/${tournament.id}/results`,
          });
        }

        // Push SSE event
        await this.pushTournamentEvent('tournament_status_changed', tournament.id, 'completed');

        this.logger.log(`Tournament ${tournament.id} (${tournament.name}) completed`);
      } catch (err) {
        this.logger.error(`Failed to complete tournament ${tournament.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async sendStartingSoonNotifications(): Promise<void> {
    // 24h and 1h before start
    const windows = [
      { label: '24 hours', interval: '24 hours', offsetCheck: '23 hours' },
      { label: '1 hour', interval: '1 hour', offsetCheck: '55 minutes' },
    ];

    for (const window of windows) {
      const result = await this.db.rawQuery(
        `SELECT * FROM prediction.tournaments
         WHERE status = 'upcoming'
           AND starts_at > now()
           AND starts_at <= now() + $1::interval
           AND starts_at > now() + $2::interval`,
        [window.interval, window.offsetCheck],
      );
      if (result.error) continue;
      const tournaments = (result.data as Tournament[] | null) ?? [];

      for (const tournament of tournaments) {
        const entries = await this.getEntries(tournament.id);
        for (const entry of entries) {
          // Check if we already sent this notification (avoid duplicates on re-run)
          const existing = await this.db.rawQuery(
            `SELECT id FROM prediction.notifications
             WHERE user_id = $1 AND event_type = 'tournament_starting'
               AND link_to = $2 AND title LIKE $3
             LIMIT 1`,
            [entry.user_id, `/tournaments/${tournament.id}`, `%${window.label}%`],
          );
          if (((existing.data as Array<unknown> | null) ?? []).length > 0) continue;

          await this.notifications.notify(entry.user_id, {
            event_type: 'tournament_starting',
            urgency: 'informational',
            title: `${tournament.name} starts in ${window.label}`,
            summary: `Get ready! The tournament begins soon.`,
            link_to: `/tournaments/${tournament.id}`,
          });
        }
      }
    }
  }

  private async getEntries(tournamentId: string): Promise<TournamentEntry[]> {
    const result = await this.db.rawQuery(
      `SELECT * FROM prediction.tournament_entries WHERE tournament_id = $1`,
      [tournamentId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as TournamentEntry[] | null) ?? [];
  }

  private async pushTournamentEvent(eventType: string, tournamentId: string, status: string): Promise<void> {
    if (!this.observability) return;
    await this.observability.push({
      context: {
        userId: 'system',
        conversationId: NIL_UUID,
        agentSlug: 'tournament-lifecycle',
        agentType: 'context',
        provider: 'system',
        model: 'system',
      },
      source_app: 'divinr-api',
      hook_event_type: eventType,
      status,
      message: `Tournament ${tournamentId} → ${status}`,
      progress: null,
      step: null,
      payload: { tournament_id: tournamentId, status },
      timestamp: Date.now(),
    }).catch(err => this.logger.warn(`SSE push failed: ${err}`));
  }
}
