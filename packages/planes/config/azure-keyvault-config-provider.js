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
var AzureKeyVaultConfigProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureKeyVaultConfigProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const keyvault_secrets_1 = require("@azure/keyvault-secrets");
const identity_1 = require("@azure/identity");
/**
 * AzureKeyVaultConfigProvider — reads secrets from Azure Key Vault
 * and injects them into process.env at startup so all existing
 * ConfigService.get() calls work transparently.
 *
 * Selected when CONFIG_PROVIDER=azure_keyvault.
 *
 * On init:
 *   1. Lists every secret in the vault
 *   2. Fetches each value
 *   3. Converts vault name to env var name: google-api-key → GOOGLE_API_KEY
 *   4. Sets process.env[envName] = value (skips if env var already set)
 *
 * This means the rest of the codebase doesn't need to change —
 * ConfigService.get('GOOGLE_API_KEY') returns the Key Vault value.
 */
let AzureKeyVaultConfigProvider = AzureKeyVaultConfigProvider_1 = class AzureKeyVaultConfigProvider {
    configService;
    logger = new common_1.Logger(AzureKeyVaultConfigProvider_1.name);
    secretClient;
    secretCache = new Map();
    vaultUrl;
    constructor(configService) {
        this.configService = configService;
        this.vaultUrl = this.configService.getOrThrow('AZURE_KEYVAULT_URL');
        // Use ManagedIdentityCredential directly (system-assigned).
        // DefaultAzureCredential picks up AZURE_CLIENT_ID from env and
        // misinterprets it as a User-Assigned identity client ID, but our
        // Container App uses System-Assigned identity.
        const credential = new identity_1.ManagedIdentityCredential();
        this.secretClient = new keyvault_secrets_1.SecretClient(this.vaultUrl, credential);
    }
    /**
     * Preload ALL secrets from Key Vault into process.env.
     * Env vars already set take precedence (allows local overrides).
     */
    async onModuleInit() {
        this.logger.log(`Azure Key Vault: ${this.vaultUrl}`);
        let loaded = 0;
        let skipped = 0;
        const errors = [];
        // List all secrets in the vault
        const secretNames = [];
        for await (const secretProperties of this.secretClient.listPropertiesOfSecrets()) {
            if (secretProperties.enabled) {
                secretNames.push(secretProperties.name);
            }
        }
        // Fetch each secret and inject into process.env
        for (const vaultName of secretNames) {
            const envName = this.toEnvVarName(vaultName);
            // Don't overwrite env vars that are already set (local overrides win)
            if (process.env[envName] !== undefined &&
                process.env[envName] !== null &&
                process.env[envName].trim() !== '') {
                skipped++;
                continue;
            }
            try {
                const secret = await this.secretClient.getSecret(vaultName);
                if (secret.value) {
                    process.env[envName] = secret.value;
                    this.secretCache.set(envName, secret.value);
                    loaded++;
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                errors.push(`${vaultName}: ${message}`);
            }
        }
        this.logger.log(`Key Vault preload: ${loaded} secrets loaded, ${skipped} skipped (env override), ${errors.length} errors`);
        if (errors.length > 0) {
            this.logger.warn(`Key Vault errors: ${errors.join('; ')}`);
        }
    }
    getRequired(key) {
        const value = this.configService.get(key);
        if (value !== undefined && value !== null && value.trim() !== '') {
            return value;
        }
        // Also check process.env directly (secrets injected after ConfigService init)
        const envValue = process.env[key];
        if (envValue !== undefined && envValue.trim() !== '') {
            return envValue;
        }
        throw new Error(`Missing required configuration key: ${key}. Not found in environment or Key Vault.`);
    }
    getOptional(key, defaultValue) {
        return (this.configService.get(key) ?? process.env[key] ?? defaultValue);
    }
    async getSecret(key) {
        // Check cache first
        const cached = this.secretCache.get(key);
        if (cached !== undefined)
            return cached;
        // Check env vars (includes preloaded vault secrets)
        const envValue = process.env[key];
        if (envValue !== undefined && envValue.trim() !== '') {
            this.secretCache.set(key, envValue);
            return envValue;
        }
        // Fetch from Key Vault on-demand (for secrets not in the initial list)
        const vaultName = this.toVaultSecretName(key);
        try {
            const secret = await this.secretClient.getSecret(vaultName);
            if (!secret.value) {
                throw new Error(`Secret '${vaultName}' exists in Key Vault but has no value`);
            }
            this.secretCache.set(key, secret.value);
            process.env[key] = secret.value; // Also inject for ConfigService
            return secret.value;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to retrieve secret '${key}' (vault name: '${vaultName}') from Azure Key Vault: ${message}`);
        }
    }
    async getSecretOptional(key, defaultValue) {
        try {
            return await this.getSecret(key);
        }
        catch {
            return defaultValue;
        }
    }
    getBoolean(key, defaultValue) {
        const raw = this.configService.get(key) ?? process.env[key];
        if (raw === undefined || raw === null || raw.trim() === '') {
            if (defaultValue !== undefined)
                return defaultValue;
            throw new Error(`Missing required boolean configuration key: ${key}`);
        }
        const lower = raw.trim().toLowerCase();
        if (lower === 'true' || lower === '1' || lower === 'yes')
            return true;
        if (lower === 'false' || lower === '0' || lower === 'no')
            return false;
        throw new Error(`Invalid boolean value for key '${key}': '${raw}'. Expected: true/false, 1/0, yes/no`);
    }
    getNumber(key, defaultValue) {
        const raw = this.configService.get(key) ?? process.env[key];
        if (raw === undefined || raw === null || raw.trim() === '') {
            if (defaultValue !== undefined)
                return defaultValue;
            throw new Error(`Missing required number configuration key: ${key}`);
        }
        const num = Number(raw);
        if (isNaN(num)) {
            throw new Error(`Invalid number value for key '${key}': '${raw}'`);
        }
        return num;
    }
    getJson(key, defaultValue) {
        const raw = this.configService.get(key) ?? process.env[key];
        if (raw === undefined || raw === null || raw.trim() === '') {
            if (defaultValue !== undefined)
                return defaultValue;
            throw new Error(`Missing required JSON configuration key: ${key}`);
        }
        try {
            return JSON.parse(raw);
        }
        catch {
            throw new Error(`Invalid JSON value for key '${key}': ${raw}`);
        }
    }
    validateRequired(keys) {
        return keys.filter((key) => {
            const value = this.configService.get(key) ?? process.env[key];
            return value === undefined || value === null || value.trim() === '';
        });
    }
    getProviderInfo() {
        return { provider: 'azure_keyvault', source: this.vaultUrl };
    }
    /**
     * Convert env var name to Azure Key Vault secret name.
     * Key Vault names can only contain alphanumeric characters and hyphens.
     * GOOGLE_API_KEY → google-api-key
     */
    toVaultSecretName(key) {
        return key.replace(/_/g, '-').toLowerCase();
    }
    /**
     * Convert Azure Key Vault secret name back to env var name.
     * google-api-key → GOOGLE_API_KEY
     */
    toEnvVarName(vaultName) {
        return vaultName.replace(/-/g, '_').toUpperCase();
    }
};
exports.AzureKeyVaultConfigProvider = AzureKeyVaultConfigProvider;
exports.AzureKeyVaultConfigProvider = AzureKeyVaultConfigProvider = AzureKeyVaultConfigProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AzureKeyVaultConfigProvider);
