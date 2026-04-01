import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  ModelConfigurationService,
  SystemModelConfiguration,
  ModelConfiguration,
} from './model-configuration.service';
import * as fs from 'fs';
import { DATABASE_SERVICE, DatabaseService } from '@/database';

function deepMerge<T>(base: T, patch: Partial<T>): T {
  const out = (Array.isArray(base)
    ? [...(base as unknown as unknown[])]
    : { ...(base as unknown as Record<string, unknown>) }) as unknown as T;
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      (out as Record<string, unknown>)[k] = deepMerge(
        (out as Record<string, unknown>)[k] || {},
        v as unknown as Partial<unknown>,
      );
    } else {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ModelConfigurationService,
      useFactory: async (configService: ConfigService, db: DatabaseService) => {
        const json = configService.get<string>('MODEL_CONFIG_JSON');
        const path = configService.get<string>('MODEL_CONFIG_PATH');
        const patchJson = configService.get<string>('MODEL_CONFIG_PATCH_JSON');
        const globalJson = configService.get<string>(
          'MODEL_CONFIG_GLOBAL_JSON',
        );

        if ((json || path) && globalJson) {
          throw new Error(
            'MODEL_CONFIG_GLOBAL_JSON is mutually exclusive with MODEL_CONFIG_JSON/MODEL_CONFIG_PATH',
          );
        }

        let baseConfig: SystemModelConfiguration | undefined;
        let globalConfig:
          | ModelConfiguration
          | undefined
          | { default: ModelConfiguration; localOnly?: ModelConfiguration };
        if (globalJson) {
          try {
            const parsed: unknown = JSON.parse(globalJson);
            // Support either a flat ModelConfiguration or a dual config { default, localOnly }
            if (parsed && typeof parsed === 'object' && 'default' in parsed) {
              globalConfig = parsed as {
                default: ModelConfiguration;
                localOnly?: ModelConfiguration;
              };
            } else {
              globalConfig = parsed as ModelConfiguration;
            }
          } catch (_parseError) {
            throw new Error(
              `Invalid MODEL_CONFIG_GLOBAL_JSON: ${(_parseError as Error).message}. Value: ${globalJson}`,
            );
          }
        }

        // If no env-provided global config, try database-backed global config
        if (!globalConfig) {
          try {
            const { data: rawData, error } = (await db.rpc(
              'get_global_model_config',
            )) as { data: unknown; error: unknown };
            if (!error && rawData) {
              // SQL Server rpc returns recordset array; Supabase returns scalar directly
              let configValue: unknown = rawData;
              if (Array.isArray(rawData) && rawData.length > 0) {
                const firstRow = rawData[0] as Record<string, unknown>;
                const values = Object.values(firstRow);
                if (values.length === 1) configValue = values[0];
              }
              const parsed =
                typeof configValue === 'string'
                  ? (JSON.parse(configValue) as unknown)
                  : configValue;
              if (parsed && typeof parsed === 'object' && 'default' in parsed) {
                globalConfig = parsed as {
                  default: ModelConfiguration;
                  localOnly?: ModelConfiguration;
                };
              } else if (parsed) {
                globalConfig = parsed as ModelConfiguration;
              }
            }
          } catch {
            // Silently ignore DB config issues and continue with file/system config
          }
        }
        if (json) {
          baseConfig = JSON.parse(json) as SystemModelConfiguration;
        } else if (path) {
          const raw = fs.readFileSync(path, 'utf8');
          baseConfig = JSON.parse(raw) as SystemModelConfiguration;
        }

        if (!baseConfig && !globalConfig) {
          // Allow service construction; validation can be invoked by consumer
          return new ModelConfigurationService(undefined);
        }

        if (patchJson && baseConfig) {
          const patch = JSON.parse(
            patchJson,
          ) as Partial<SystemModelConfiguration>;
          baseConfig = deepMerge(baseConfig, patch);
        }

        const service = new ModelConfigurationService(
          baseConfig ?? globalConfig,
        );
        service.validateConfig();
        return service;
      },
      inject: [ConfigService, DATABASE_SERVICE],
    },
  ],
  exports: [ModelConfigurationService],
})
export class ModelConfigurationModule {}
