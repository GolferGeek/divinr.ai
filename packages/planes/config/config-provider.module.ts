import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONFIG_PROVIDER_SERVICE,
  ConfigProvider,
} from './config-provider.interface';
import { LocalConfigProvider } from './local-config-provider';
import { AzureKeyVaultConfigProvider } from './azure-keyvault-config-provider';
import { GcpSecretManagerConfigProvider } from './gcp-secret-manager-config-provider';
import { SupabaseVaultConfigProvider } from './supabase-vault-config-provider';

/**
 * Forces eager resolution of CONFIG_PROVIDER_SERVICE at startup.
 * Without this, the factory only fires when something first @Inject()s the token.
 */
@Injectable()
class ConfigProviderBootstrap implements OnModuleInit {
  private readonly logger = new Logger('ConfigProviderBootstrap');

  constructor(
    @Inject(CONFIG_PROVIDER_SERVICE)
    private readonly configProvider: ConfigProvider,
  ) {}

  onModuleInit(): void {
    const info = this.configProvider.getProviderInfo();
    this.logger.log(`Config provider ready: ${info.provider} (${info.source})`);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: CONFIG_PROVIDER_SERVICE,
      useFactory: async (
        configService: ConfigService,
      ): Promise<ConfigProvider> => {
        const provider =
          configService.get<string>('CONFIG_PROVIDER') || 'local';
        // eslint-disable-next-line no-console
        console.log(`[ConfigProviderModule] CONFIG_PROVIDER=${provider}`);
        switch (provider) {
          case 'local':
            return new LocalConfigProvider(configService);
          case 'azure_keyvault': {
            const kv = new AzureKeyVaultConfigProvider(configService);
            await kv.onModuleInit();
            return kv;
          }
          case 'gcp_secret_manager': {
            const gcp = new GcpSecretManagerConfigProvider(configService);
            await gcp.onModuleInit();
            return gcp;
          }
          case 'supabase_vault': {
            const vault = new SupabaseVaultConfigProvider(configService);
            await vault.onModuleInit();
            return vault;
          }
          default:
            throw new Error(
              `Unsupported CONFIG_PROVIDER '${provider}'. Expected: local, supabase_vault, azure_keyvault, gcp_secret_manager`,
            );
        }
      },
      inject: [ConfigService],
    },
    ConfigProviderBootstrap,
  ],
  exports: [CONFIG_PROVIDER_SERVICE],
})
export class ConfigProviderModule {}
