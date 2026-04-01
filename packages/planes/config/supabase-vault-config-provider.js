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
var SupabaseVaultConfigProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseVaultConfigProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
/**
 * SupabaseVaultConfigProvider — reads secrets from Supabase Vault (pgsodium),
 * preloads them into process.env at startup so all existing ConfigService.get()
 * calls work transparently.
 *
 * Selected when CONFIG_PROVIDER=supabase_vault.
 *
 * On init:
 *   1. Connects to PostgreSQL using DATABASE_URL
 *   2. Queries vault.decrypted_secrets for all stored secrets
 *   3. Injects each secret into process.env (skips if env var already set)
 *
 * Secrets are stored via vault.create_secret(value, name, description).
 * The 'name' field should match the env var name (e.g. ANTHROPIC_API_KEY).
 *
 * This means the rest of the codebase doesn't need to change —
 * ConfigService.get('ANTHROPIC_API_KEY') returns the Vault value.
 */
let SupabaseVaultConfigProvider = SupabaseVaultConfigProvider_1 = class SupabaseVaultConfigProvider {
    configService;
    logger = new common_1.Logger(SupabaseVaultConfigProvider_1.name);
    databaseUrl;
    secretCache = new Map();
    constructor(configService) {
        this.configService = configService;
        this.databaseUrl = this.configService.getOrThrow('DATABASE_URL');
    }
    /**
     * Preload ALL secrets from Supabase Vault into process.env.
     * Env vars already set take precedence (allows local overrides).
     */
    async onModuleInit() {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Client } = require('pg');
        const client = new Client({ connectionString: this.databaseUrl });
        try {
            await client.connect();
            this.logger.log('Supabase Vault: connected');
            const result = await client.query('SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name IS NOT NULL');
            let loaded = 0;
            let skipped = 0;
            for (const row of result.rows) {
                const envName = row.name;
                const secretValue = row.decrypted_secret;
                if (!envName || !secretValue)
                    continue;
                // Don't overwrite env vars that are already set (local overrides win)
                if (process.env[envName] !== undefined &&
                    process.env[envName] !== null &&
                    process.env[envName].trim() !== '') {
                    skipped++;
                    continue;
                }
                process.env[envName] = secretValue;
                this.secretCache.set(envName, secretValue);
                loaded++;
            }
            this.logger.log(`Vault preload: ${loaded} secrets loaded, ${skipped} skipped (env override), ${result.rows.length} total in vault`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to connect to Supabase Vault: ${message}`);
        }
        finally {
            await client.end();
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
        throw new Error(`Missing required configuration key: ${key}. Not found in environment or Supabase Vault.`);
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
        // For Supabase Vault, all secrets are preloaded at startup.
        // If it's not in env by now, it doesn't exist.
        throw new Error(`Secret '${key}' not found in environment or Supabase Vault. ` +
            `Ensure it was added via: SELECT vault.create_secret('value', '${key}', 'description');`);
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
        return {
            provider: 'supabase_vault',
            source: 'vault.decrypted_secrets (pgsodium)',
        };
    }
};
exports.SupabaseVaultConfigProvider = SupabaseVaultConfigProvider;
exports.SupabaseVaultConfigProvider = SupabaseVaultConfigProvider = SupabaseVaultConfigProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SupabaseVaultConfigProvider);
