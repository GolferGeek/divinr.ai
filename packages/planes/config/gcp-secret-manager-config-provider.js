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
var GcpSecretManagerConfigProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcpSecretManagerConfigProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
/**
 * GcpSecretManagerConfigProvider — reads secrets from GCP Secret Manager,
 * falls back to env vars for non-secret configuration.
 *
 * Selected when CONFIG_PROVIDER=gcp_secret_manager.
 *
 * Secret Manager secret names use hyphens (e.g., anthropic-api-key)
 * while env var names use underscores (e.g., ANTHROPIC_API_KEY).
 * This provider normalizes between the two conventions.
 */
let GcpSecretManagerConfigProvider = GcpSecretManagerConfigProvider_1 = class GcpSecretManagerConfigProvider {
    configService;
    logger = new common_1.Logger(GcpSecretManagerConfigProvider_1.name);
    client;
    secretCache = new Map();
    projectId;
    constructor(configService) {
        this.configService = configService;
        this.projectId = this.configService.getOrThrow('GCP_PROJECT_ID');
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
        /* eslint-enable @typescript-eslint/no-require-imports */
        this.client = new SecretManagerServiceClient();
    }
    onModuleInit() {
        this.logger.log(`GCP Secret Manager connected: projects/${this.projectId}`);
    }
    getRequired(key) {
        const value = this.configService.get(key);
        if (value !== undefined && value !== null && value.trim() !== '') {
            return value;
        }
        throw new Error(`Missing required configuration key: ${key}. Not found in environment. For secrets, use getSecret() instead.`);
    }
    getOptional(key, defaultValue) {
        return this.configService.get(key) ?? defaultValue;
    }
    async getSecret(key) {
        // Check cache first
        const cached = this.secretCache.get(key);
        if (cached !== undefined)
            return cached;
        // Check env vars (allows overrides)
        const envValue = this.configService.get(key);
        if (envValue !== undefined && envValue !== null && envValue.trim() !== '') {
            this.secretCache.set(key, envValue);
            return envValue;
        }
        // Fetch from Secret Manager
        const secretName = this.toSecretManagerName(key);
        try {
            const [response] = await this.client.accessSecretVersion({
                name: secretName,
            });
            const secretValue = response.payload?.data?.toString();
            if (!secretValue) {
                throw new Error(`Secret '${secretName}' exists in Secret Manager but has no value`);
            }
            this.secretCache.set(key, secretValue);
            return secretValue;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to retrieve secret '${key}' (secret name: '${secretName}') from GCP Secret Manager: ${message}`);
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
        const raw = this.configService.get(key);
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
        const raw = this.configService.get(key);
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
        const raw = this.configService.get(key);
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
            const value = this.configService.get(key);
            return value === undefined || value === null || value.trim() === '';
        });
    }
    getProviderInfo() {
        return {
            provider: 'gcp_secret_manager',
            source: `projects/${this.projectId}`,
        };
    }
    /**
     * Convert env var name to GCP Secret Manager secret resource name.
     * Secret names use hyphens and lowercase: ANTHROPIC_API_KEY -> anthropic-api-key
     * Full resource path: projects/{project}/secrets/{name}/versions/latest
     */
    toSecretManagerName(key) {
        const secretId = key.replace(/_/g, '-').toLowerCase();
        return `projects/${this.projectId}/secrets/${secretId}/versions/latest`;
    }
};
exports.GcpSecretManagerConfigProvider = GcpSecretManagerConfigProvider;
exports.GcpSecretManagerConfigProvider = GcpSecretManagerConfigProvider = GcpSecretManagerConfigProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GcpSecretManagerConfigProvider);
