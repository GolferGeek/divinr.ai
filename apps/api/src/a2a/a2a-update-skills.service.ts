import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_SERVICE,
  type DatabaseService,
  type QueryResult,
} from '@orchestratorai/planes/database';
import {
  AgentContractSchemaRegistry,
  ContractValidationError,
} from '../agent-contracts/contract-bundle';

export interface ValidatedUpdatesCommand {
  readonly effectiveUserId: string;
  readonly skillId: 'general_updates' | 'personal_updates';
  readonly input: Readonly<{
    schemaVersion: 2;
    requestId: string;
    idempotencyKey: string;
    since?: string;
    categories?: readonly string[];
    pageSize?: number;
    pageToken?: string;
  }>;
}

interface NotificationRow {
  id: string;
  event_type: string;
  title: string;
  summary: string | null;
  created_at: string;
}

function rows<T>(result: QueryResult): T[] {
  if (result.error) throw new Error(result.error.message);
  return (result.data as T[] | null) ?? [];
}

function category(eventType: string): 'market' | 'analysis' | 'portfolio' | 'tournament' {
  if (eventType.startsWith('tournament_')) return 'tournament';
  if (eventType === 'trade_recommendation' || eventType === 'stop_loss') {
    return 'portfolio';
  }
  if (eventType === 'nightly_eval' || eventType === 'tier3_proposal') {
    return 'analysis';
  }
  return 'market';
}

const EVENTS_BY_CATEGORY: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    platform: [],
    market: ['contrarian_alert', 'fear_greed_alert'],
    analysis: ['nightly_eval', 'tier3_proposal'],
    portfolio: ['trade_recommendation', 'stop_loss'],
    tournament: [
      'tournament_starting',
      'tournament_started',
      'tournament_ended',
      'tournament_rank_change',
      'tournament_results',
    ],
  });

@Injectable()
export class A2AUpdateSkillsService {
  private readonly schemas = new AgentContractSchemaRegistry();

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async execute(command: ValidatedUpdatesCommand): Promise<Record<string, unknown>> {
    try {
      this.schemas.validate('updatesRequest', command.input);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new Error(`Validated updates command is invalid: ${error.message}`);
      }
      throw error;
    }
    const pageSize = Math.min(command.input.pageSize ?? 20, 50);
    const generalEvents = [
      'nightly_eval',
      'tournament_starting',
      'tournament_started',
      'tournament_ended',
      'tournament_results',
    ];
    let cursor: { createdAt: string; id: string } | undefined;
    if (command.input.pageToken) {
      try {
        const parsed = JSON.parse(
          Buffer.from(command.input.pageToken, 'base64url').toString('utf8'),
        ) as Record<string, unknown>;
        if (
          typeof parsed.createdAt !== 'string'
          || typeof parsed.id !== 'string'
          || Number.isNaN(Date.parse(parsed.createdAt))
        ) throw new Error('invalid cursor');
        cursor = { createdAt: parsed.createdAt, id: parsed.id };
      } catch {
        throw new Error('Validated updates command has an invalid page token');
      }
    }
    const categoryEvents = [
      ...new Set(
        (command.input.categories ?? [])
          .flatMap((requested) => EVENTS_BY_CATEGORY[requested] ?? []),
      ),
    ];
    const filterCategories = (command.input.categories?.length ?? 0) > 0;
    const result = await this.db.rawQuery(
      `SELECT id, event_type, title, summary, created_at
         FROM prediction.notifications
        WHERE user_id = $1
          AND ($2::timestamptz IS NULL OR created_at >= $2)
          AND ($3::boolean = false OR event_type = ANY($4::text[]))
          AND ($5::boolean = false OR event_type = ANY($6::text[]))
          AND (
            $7::timestamptz IS NULL
            OR (created_at, id) < ($7::timestamptz, $8::text)
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $9`,
      [
        command.effectiveUserId,
        command.input.since ?? null,
        command.skillId === 'general_updates',
        generalEvents,
        filterCategories,
        categoryEvents,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        pageSize + 1,
      ],
    );
    const notificationRows = rows<NotificationRow>(result);
    const selected = notificationRows.slice(0, pageSize);
    const updates = selected.map((row) => ({
        updateId: row.id,
        category: category(row.event_type),
        title: row.title.slice(0, 300),
        summary: (row.summary ?? row.title).slice(0, 2000),
        occurredAt: new Date(row.created_at).toISOString(),
      }));
    const response: Record<string, unknown> = {
      schemaVersion: 2,
      updates,
      ...(notificationRows.length > pageSize
        ? {
            nextPageToken: Buffer.from(JSON.stringify({
              createdAt: selected.at(-1)?.created_at,
              id: selected.at(-1)?.id,
            })).toString('base64url'),
          }
        : {}),
    };
    this.schemas.validate('updatesResult', response);
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 1024 * 1024) {
      throw new Error('Validated updates output exceeds 1 MiB');
    }
    return response;
  }
}
