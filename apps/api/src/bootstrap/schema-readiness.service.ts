import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export interface SchemaReadinessCheck {
  ok: boolean;
  missing: string[];
  checkedAt: string;
}

@Injectable()
export class SchemaReadinessService {
  private readonly requiredRelations = [
    'billing.subscriptions',
    'credentials.user_llm_credentials',
    'prediction.learning_panel_messages',
    'prediction.learning_panel_thread_state',
    'prediction.learning_panel_threads',
    'prediction.service_api_keys',
    'prediction.user_surface_touches',
    'authz.user_preferences',
  ] as const;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async check(): Promise<SchemaReadinessCheck> {
    const result = await this.db.rawQuery(
      `SELECT key,
              to_regclass(key) IS NOT NULL AS present
         FROM unnest($1::text[]) AS key`,
      [this.requiredRelations],
    );
    if (result.error) {
      throw new Error(`Schema readiness query failed: ${result.error.message}`);
    }

    const rows = (result.data as Array<{ key: string; present: boolean }> | null) ?? [];
    const missing = rows.filter((row) => !row.present).map((row) => row.key);
    return {
      ok: missing.length === 0,
      missing,
      checkedAt: new Date().toISOString(),
    };
  }

  async assertReady(): Promise<void> {
    const state = await this.check();
    if (!state.ok) {
      throw new Error(
        `Schema bootstrap readiness failed; missing relations: ${state.missing.join(', ')}`,
      );
    }
  }
}
