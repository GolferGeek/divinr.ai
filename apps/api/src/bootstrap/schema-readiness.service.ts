import { Inject, Injectable } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  AGENT_COMMERCE_REQUIRED_RELATIONS,
  APPLE_ASSISTANT_OAUTH_CLIENT_ID,
} from '../agent-commerce/agent-commerce-schema.constants';
import {
  AGENT_KEY_PROVIDER,
  type AgentKeyProvider,
} from '../agent-commerce/agent-key-provider';

export interface SchemaReadinessCheck {
  ok: boolean;
  missing: string[];
  checkedAt: string;
}

@Injectable()
export class SchemaReadinessService {
  private readonly requiredRelations = [
    'authz.invites',
    'authz.user_preferences',
    'billing.subscriptions',
    'credentials.user_llm_credentials',
    'messaging.channels',
    'prediction.clubs',
    'prediction.curricula',
    'prediction.instruments',
    'prediction.learning_panel_messages',
    'prediction.learning_panel_thread_state',
    'prediction.learning_panel_threads',
    'prediction.user_learning_profiles',
    'prediction.market_analysts',
    'prediction.market_predictions',
    'prediction.service_api_keys',
    'prediction.tournaments',
    'prediction.user_surface_touches',
    ...AGENT_COMMERCE_REQUIRED_RELATIONS,
  ] as const;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AGENT_KEY_PROVIDER) private readonly agentKeys: AgentKeyProvider,
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
    const agentCommerceRelationsPresent = AGENT_COMMERCE_REQUIRED_RELATIONS.every(
      (key) => rows.some((row) => row.key === key && row.present),
    );
    if (agentCommerceRelationsPresent) {
      const seedResult = await this.db.rawQuery(
        `SELECT
           EXISTS (
             SELECT 1 FROM agent_commerce.oauth_clients
              WHERE client_id = $1
                AND client_type = 'public'
                AND client_secret_hash IS NULL
                AND status = 'active'
           ) AS oauth_client_present,
           (
             SELECT count(*)::integer
               FROM agent_commerce.a2a_products
              WHERE product_version = 2 AND status = 'active'
           ) AS active_product_count`,
        [APPLE_ASSISTANT_OAUTH_CLIENT_ID],
      );
      if (seedResult.error) {
        throw new Error(`Schema seed readiness query failed: ${seedResult.error.message}`);
      }
      const seed = (
        seedResult.data as Array<{
          oauth_client_present: boolean;
          active_product_count: number;
        }> | null
      )?.[0];
      if (!seed?.oauth_client_present) {
        missing.push(`seed:${APPLE_ASSISTANT_OAUTH_CLIENT_ID}`);
      }
      if (seed?.active_product_count !== 7) {
        missing.push('seed:agent_commerce.a2a_products:v0.2');
      }
      if (missing.length === 0) {
        try {
          await this.agentKeys.assertProductionReady();
        } catch {
          missing.push('key:agent-card-production-readiness');
        }
      }
    }
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
