"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigProviderModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const config_provider_interface_1 = require("./config-provider.interface");
const local_config_provider_1 = require("./local-config-provider");
const azure_keyvault_config_provider_1 = require("./azure-keyvault-config-provider");
const gcp_secret_manager_config_provider_1 = require("./gcp-secret-manager-config-provider");
const supabase_vault_config_provider_1 = require("./supabase-vault-config-provider");
/**
 * Forces eager resolution of CONFIG_PROVIDER_SERVICE at startup.
 * Without this, the factory only fires when something first @Inject()s the token.
 */
let ConfigProviderBootstrap = class ConfigProviderBootstrap {
    configProvider;
    logger = new common_1.Logger('ConfigProviderBootstrap');
    constructor(configProvider) {
        this.configProvider = configProvider;
    }
    onModuleInit() {
        const info = this.configProvider.getProviderInfo();
        this.logger.log(`Config provider ready: ${info.provider} (${info.source})`);
    }
};
ConfigProviderBootstrap = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(config_provider_interface_1.CONFIG_PROVIDER_SERVICE)),
    __metadata("design:paramtypes", [Object])
], ConfigProviderBootstrap);
let ConfigProviderModule = class ConfigProviderModule {
};
exports.ConfigProviderModule = ConfigProviderModule;
exports.ConfigProviderModule = ConfigProviderModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: config_provider_interface_1.CONFIG_PROVIDER_SERVICE,
                useFactory: async (configService) => {
                    const provider = configService.get('CONFIG_PROVIDER') || 'local';
                    // eslint-disable-next-line no-console
                    console.log(`[ConfigProviderModule] CONFIG_PROVIDER=${provider}`);
                    switch (provider) {
                        case 'local':
                            return new local_config_provider_1.LocalConfigProvider(configService);
                        case 'azure_keyvault': {
                            const kv = new azure_keyvault_config_provider_1.AzureKeyVaultConfigProvider(configService);
                            await kv.onModuleInit();
                            return kv;
                        }
                        case 'gcp_secret_manager': {
                            const gcp = new gcp_secret_manager_config_provider_1.GcpSecretManagerConfigProvider(configService);
                            await gcp.onModuleInit();
                            return gcp;
                        }
                        case 'supabase_vault': {
                            const vault = new supabase_vault_config_provider_1.SupabaseVaultConfigProvider(configService);
                            await vault.onModuleInit();
                            return vault;
                        }
                        default:
                            throw new Error(`Unsupported CONFIG_PROVIDER '${provider}'. Expected: local, supabase_vault, azure_keyvault, gcp_secret_manager`);
                    }
                },
                inject: [config_1.ConfigService],
            },
            ConfigProviderBootstrap,
        ],
        exports: [config_provider_interface_1.CONFIG_PROVIDER_SERVICE],
    })
], ConfigProviderModule);
