"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_PROVIDER_SERVICE = void 0;
/**
 * ConfigProvider — provider-plane interface for configuration and secrets.
 *
 * CONFIG_PROVIDER = local              → LocalConfigProvider           (.env files only)
 * CONFIG_PROVIDER = supabase_vault     → SupabaseVaultConfigProvider   (pgsodium vault + env fallback)
 * CONFIG_PROVIDER = azure_keyvault     → AzureKeyVaultConfigProvider   (Azure Key Vault + env fallback)
 * CONFIG_PROVIDER = gcp_secret_manager → GcpSecretManagerConfigProvider (GCP Secret Manager + env fallback)
 */
exports.CONFIG_PROVIDER_SERVICE = Symbol('CONFIG_PROVIDER_SERVICE');
