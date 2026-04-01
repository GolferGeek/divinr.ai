/**
 * ConfigProvider — provider-plane interface for configuration and secrets.
 *
 * CONFIG_PROVIDER = local              → LocalConfigProvider           (.env files only)
 * CONFIG_PROVIDER = supabase_vault     → SupabaseVaultConfigProvider   (pgsodium vault + env fallback)
 * CONFIG_PROVIDER = azure_keyvault     → AzureKeyVaultConfigProvider   (Azure Key Vault + env fallback)
 * CONFIG_PROVIDER = gcp_secret_manager → GcpSecretManagerConfigProvider (GCP Secret Manager + env fallback)
 */
export const CONFIG_PROVIDER_SERVICE = Symbol('CONFIG_PROVIDER_SERVICE');

export interface ConfigProvider {
  /**
   * Get a required config value. Throws if missing.
   */
  getRequired(key: string): string;

  /**
   * Get an optional config value with a default.
   */
  getOptional(key: string, defaultValue: string): string;

  /**
   * Get a required secret value. May be async for remote vaults.
   * Throws if missing.
   */
  getSecret(key: string): Promise<string>;

  /**
   * Get an optional secret value with a default.
   */
  getSecretOptional(key: string, defaultValue: string): Promise<string>;

  /**
   * Typed parsers.
   */
  getBoolean(key: string, defaultValue?: boolean): boolean;
  getNumber(key: string, defaultValue?: number): number;
  getJson<T = unknown>(key: string, defaultValue?: T): T;

  /**
   * Validate that all required keys exist. Returns list of missing keys.
   * Empty array means all keys are present.
   */
  validateRequired(keys: string[]): string[];

  /**
   * Provider metadata.
   */
  getProviderInfo(): { provider: string; source: string };
}
