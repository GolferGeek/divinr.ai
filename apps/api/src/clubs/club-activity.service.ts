import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ClubSchemaService } from './club-schema.service';
import { ClubService } from './club.service';
import type {
  ClubPredictionChallenge,
  ClubChallengeResponse,
  ClubConsensusPoll,
  ClubConsensusVote,
  ClubStrategyJournal,
} from './club.types';

@Injectable()
export class ClubActivityService {
  private readonly logger = new Logger(ClubActivityService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ClubSchemaService) private readonly schema: ClubSchemaService,
    @Inject(ClubService) private readonly clubs: ClubService,
  ) {}

  // ─── Prediction Challenges ─────────────────────────────────────

  async createChallenge(
    clubId: string,
    input: { instrument_id: string; symbol: string; prompt?: string },
    userId: string,
  ): Promise<ClubPredictionChallenge> {
    await this.schema.ensureSchema();
    await this.clubs.requireRole(clubId, userId, ['owner', 'admin']);

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_prediction_challenges (id, club_id, created_by, instrument_id, symbol, prompt)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, clubId, userId, input.instrument_id, input.symbol, input.prompt ?? null],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as ClubPredictionChallenge[] | null) ?? [])[0]!;
  }

  async listChallenges(clubId: string, userId: string): Promise<Array<ClubPredictionChallenge & { response_count: number; my_response?: ClubChallengeResponse }>> {
    await this.schema.ensureSchema();
    await this.clubs.requireMembership(clubId, userId);

    const result = await this.db.rawQuery(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM prediction.club_challenge_responses r WHERE r.challenge_id = c.id) as response_count
       FROM prediction.club_prediction_challenges c
       WHERE c.club_id = $1
       ORDER BY c.created_at DESC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    const challenges = (result.data as Array<ClubPredictionChallenge & { response_count: number }> | null) ?? [];

    // Attach user's response if any
    for (const challenge of challenges) {
      const respResult = await this.db.rawQuery(
        `SELECT * FROM prediction.club_challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
        [challenge.id, userId],
      );
      (challenge as unknown as Record<string, unknown>).my_response = ((respResult.data as ClubChallengeResponse[] | null) ?? [])[0] ?? null;
    }

    return challenges as Array<ClubPredictionChallenge & { response_count: number; my_response?: ClubChallengeResponse }>;
  }

  async respondToChallenge(
    challengeId: string,
    input: { direction: 'bull' | 'bear' | 'neutral'; thesis: string },
    userId: string,
  ): Promise<ClubChallengeResponse> {
    await this.schema.ensureSchema();

    // Get challenge to verify club membership
    const cResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_prediction_challenges WHERE id = $1`,
      [challengeId],
    );
    if (cResult.error) throw new Error(cResult.error.message);
    const challenges = (cResult.data as ClubPredictionChallenge[] | null) ?? [];
    if (challenges.length === 0) throw new Error('Challenge not found');

    const challenge = challenges[0]!;
    if (challenge.status !== 'open') throw new Error('Challenge is not open for responses');
    await this.clubs.requireMembership(challenge.club_id, userId);

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_challenge_responses (id, challenge_id, user_id, direction, thesis)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, challengeId, userId, input.direction, input.thesis],
    );
    if (result.error) {
      if (result.error.message.includes('unique') || result.error.message.includes('duplicate')) {
        throw new Error('Already responded to this challenge');
      }
      throw new Error(result.error.message);
    }
    return ((result.data as ClubChallengeResponse[] | null) ?? [])[0]!;
  }

  async revealChallenge(challengeId: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();

    const cResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_prediction_challenges WHERE id = $1`,
      [challengeId],
    );
    const challenges = (cResult.data as ClubPredictionChallenge[] | null) ?? [];
    if (challenges.length === 0) throw new Error('Challenge not found');

    await this.clubs.requireRole(challenges[0]!.club_id, userId, ['owner', 'admin']);

    await this.db.rawQuery(
      `UPDATE prediction.club_prediction_challenges SET status = 'revealed', revealed_at = now() WHERE id = $1`,
      [challengeId],
    );
  }

  // ─── Consensus Polls ───────────────────────────────────────────

  async createPoll(
    clubId: string,
    input: { instrument_id: string; symbol: string },
    userId: string,
  ): Promise<ClubConsensusPoll> {
    await this.schema.ensureSchema();
    await this.clubs.requireRole(clubId, userId, ['owner', 'admin']);

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_consensus_polls (id, club_id, created_by, instrument_id, symbol)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, clubId, userId, input.instrument_id, input.symbol],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as ClubConsensusPoll[] | null) ?? [])[0]!;
  }

  async listPolls(clubId: string, userId: string): Promise<Array<ClubConsensusPoll & { bull_count: number; bear_count: number; neutral_count: number; my_vote?: ClubConsensusVote }>> {
    await this.schema.ensureSchema();
    await this.clubs.requireMembership(clubId, userId);

    const result = await this.db.rawQuery(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM prediction.club_consensus_votes v WHERE v.poll_id = p.id AND v.direction = 'bull') as bull_count,
              (SELECT COUNT(*)::int FROM prediction.club_consensus_votes v WHERE v.poll_id = p.id AND v.direction = 'bear') as bear_count,
              (SELECT COUNT(*)::int FROM prediction.club_consensus_votes v WHERE v.poll_id = p.id AND v.direction = 'neutral') as neutral_count
       FROM prediction.club_consensus_polls p
       WHERE p.club_id = $1
       ORDER BY p.created_at DESC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    const polls = (result.data as Array<ClubConsensusPoll & { bull_count: number; bear_count: number; neutral_count: number }> | null) ?? [];

    for (const poll of polls) {
      const voteResult = await this.db.rawQuery(
        `SELECT * FROM prediction.club_consensus_votes WHERE poll_id = $1 AND user_id = $2`,
        [poll.id, userId],
      );
      (poll as unknown as Record<string, unknown>).my_vote = ((voteResult.data as ClubConsensusVote[] | null) ?? [])[0] ?? null;
    }

    return polls as Array<ClubConsensusPoll & { bull_count: number; bear_count: number; neutral_count: number; my_vote?: ClubConsensusVote }>;
  }

  async vote(pollId: string, direction: 'bull' | 'bear' | 'neutral', userId: string): Promise<ClubConsensusVote> {
    await this.schema.ensureSchema();

    const pResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_consensus_polls WHERE id = $1`,
      [pollId],
    );
    const polls = (pResult.data as ClubConsensusPoll[] | null) ?? [];
    if (polls.length === 0) throw new Error('Poll not found');

    const poll = polls[0]!;
    if (poll.status !== 'open') throw new Error('Poll is not open for voting');
    await this.clubs.requireMembership(poll.club_id, userId);

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_consensus_votes (id, poll_id, user_id, direction)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, pollId, userId, direction],
    );
    if (result.error) {
      if (result.error.message.includes('unique') || result.error.message.includes('duplicate')) {
        throw new Error('Already voted on this poll');
      }
      throw new Error(result.error.message);
    }
    return ((result.data as ClubConsensusVote[] | null) ?? [])[0]!;
  }

  async revealPoll(pollId: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();

    const pResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_consensus_polls WHERE id = $1`,
      [pollId],
    );
    const polls = (pResult.data as ClubConsensusPoll[] | null) ?? [];
    if (polls.length === 0) throw new Error('Poll not found');

    await this.clubs.requireRole(polls[0]!.club_id, userId, ['owner', 'admin']);

    await this.db.rawQuery(
      `UPDATE prediction.club_consensus_polls SET status = 'revealed', revealed_at = now() WHERE id = $1`,
      [pollId],
    );
  }

  // ─── Strategy Journals ─────────────────────────────────────────

  async addJournalEntry(
    clubId: string,
    input: { entry: string; symbol?: string; tournament_id?: string },
    userId: string,
  ): Promise<ClubStrategyJournal> {
    await this.schema.ensureSchema();
    await this.clubs.requireMembership(clubId, userId);

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_strategy_journals (id, club_id, user_id, tournament_id, symbol, entry)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, clubId, userId, input.tournament_id ?? null, input.symbol ?? null, input.entry],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as ClubStrategyJournal[] | null) ?? [])[0]!;
  }

  async listJournals(clubId: string, userId: string): Promise<Array<ClubStrategyJournal & { display_name?: string }>> {
    await this.schema.ensureSchema();
    await this.clubs.requireMembership(clubId, userId);

    const result = await this.db.rawQuery(
      `SELECT j.*, u.display_name
       FROM prediction.club_strategy_journals j
       LEFT JOIN authz.users u ON u.id = j.user_id
       WHERE j.club_id = $1
       ORDER BY j.created_at DESC
       LIMIT 100`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<ClubStrategyJournal & { display_name?: string }> | null) ?? [];
  }
}
