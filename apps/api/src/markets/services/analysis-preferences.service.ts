import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import type { DashboardPriorityMode } from '../utils/dashboard-relevance';

export interface AnalysisPreferenceResponse {
  followed_analyst_ids: string[];
  watched_instrument_ids: string[];
  muted_instrument_ids: string[];
  priority_mode: DashboardPriorityMode;
}

const PRIORITY_MODES = new Set<DashboardPriorityMode>(['balanced', 'portfolio_first', 'tournaments_first']);
const PREFERENCE_TYPES = ['followed_analyst', 'watched_instrument', 'muted_instrument'] as const;
type AnalysisPreferenceType = typeof PREFERENCE_TYPES[number];

@Injectable()
export class AnalysisPreferencesService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async getPreferences(userId: string): Promise<AnalysisPreferenceResponse> {
    const [prefsResult, dashboardResult] = await Promise.all([
      this.db.rawQuery(
        `select preference_type, target_id
         from prediction.user_analysis_preferences
         where user_id = $1
         order by preference_type, target_id`,
        [userId],
      ),
      this.db.rawQuery(
        `select priority_mode
         from prediction.user_dashboard_preferences
         where user_id = $1
         limit 1`,
        [userId],
      ),
    ]);
    if (prefsResult.error) throw new Error(prefsResult.error.message);
    if (dashboardResult.error) throw new Error(dashboardResult.error.message);

    const response = defaultPreferences();
    for (const row of ((prefsResult.data as Array<{ preference_type: AnalysisPreferenceType; target_id: string }> | null) ?? [])) {
      if (row.preference_type === 'followed_analyst') response.followed_analyst_ids.push(row.target_id);
      if (row.preference_type === 'watched_instrument') response.watched_instrument_ids.push(row.target_id);
      if (row.preference_type === 'muted_instrument') response.muted_instrument_ids.push(row.target_id);
    }
    const priority = String(((dashboardResult.data as Array<{ priority_mode: string }> | null) ?? [])[0]?.priority_mode ?? 'balanced');
    response.priority_mode = isPriorityMode(priority) ? priority : 'balanced';
    return response;
  }

  async replacePreferences(userId: string, input: Partial<AnalysisPreferenceResponse>): Promise<AnalysisPreferenceResponse> {
    const next: AnalysisPreferenceResponse = {
      followed_analyst_ids: dedupeIds(input.followed_analyst_ids ?? []),
      watched_instrument_ids: dedupeIds(input.watched_instrument_ids ?? []),
      muted_instrument_ids: dedupeIds(input.muted_instrument_ids ?? []),
      priority_mode: parsePriorityMode(input.priority_mode),
    };

    await this.validateTargets('followed_analyst', next.followed_analyst_ids);
    await this.validateTargets('watched_instrument', next.watched_instrument_ids);
    await this.validateTargets('muted_instrument', next.muted_instrument_ids);

    const deleteResult = await this.db.rawQuery(
      `delete from prediction.user_analysis_preferences where user_id = $1`,
      [userId],
    );
    if (deleteResult.error) throw new Error(deleteResult.error.message);

    const rows: Array<{ type: AnalysisPreferenceType; targetId: string }> = [
      ...next.followed_analyst_ids.map((targetId) => ({ type: 'followed_analyst' as const, targetId })),
      ...next.watched_instrument_ids.map((targetId) => ({ type: 'watched_instrument' as const, targetId })),
      ...next.muted_instrument_ids.map((targetId) => ({ type: 'muted_instrument' as const, targetId })),
    ];
    for (const row of rows) {
      const result = await this.db.rawQuery(
        `insert into prediction.user_analysis_preferences
          (user_id, preference_type, target_id, created_at, updated_at)
         values ($1, $2, $3, now(), now())
         on conflict (user_id, preference_type, target_id)
         do update set updated_at = excluded.updated_at`,
        [userId, row.type, row.targetId],
      );
      if (result.error) throw new Error(result.error.message);
    }

    const dashboardResult = await this.db.rawQuery(
      `insert into prediction.user_dashboard_preferences (user_id, priority_mode, created_at, updated_at)
       values ($1, $2, now(), now())
       on conflict (user_id) do update
         set priority_mode = excluded.priority_mode,
             updated_at = excluded.updated_at`,
      [userId, next.priority_mode],
    );
    if (dashboardResult.error) throw new Error(dashboardResult.error.message);

    return this.getPreferences(userId);
  }

  private async validateTargets(type: AnalysisPreferenceType, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const table = type === 'followed_analyst' ? 'prediction.market_analysts' : 'prediction.instruments';
    const result = await this.db.rawQuery(
      `select id from ${table} where id = any($1::text[])`,
      [ids],
    );
    if (result.error) throw new Error(result.error.message);
    const found = new Set(((result.data as Array<{ id: string }> | null) ?? []).map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown ${type} target id(s): ${missing.join(', ')}`);
    }
  }
}

function defaultPreferences(): AnalysisPreferenceResponse {
  return {
    followed_analyst_ids: [],
    watched_instrument_ids: [],
    muted_instrument_ids: [],
    priority_mode: 'balanced',
  };
}

function isPriorityMode(value: string): value is DashboardPriorityMode {
  return PRIORITY_MODES.has(value as DashboardPriorityMode);
}

function parsePriorityMode(value: unknown): DashboardPriorityMode {
  if (typeof value !== 'string' || !isPriorityMode(value)) {
    throw new BadRequestException('priority_mode must be balanced, portfolio_first, or tournaments_first');
  }
  return value;
}

function dedupeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw new BadRequestException('preference id fields must be arrays');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new BadRequestException('preference ids must be non-empty strings');
    }
    const id = raw.trim();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
