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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalConfigProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
/**
 * LocalConfigProvider — reads all config from NestJS ConfigService (process.env / .env files).
 * Selected when CONFIG_PROVIDER=local.
 */
let LocalConfigProvider = class LocalConfigProvider {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    getRequired(key) {
        const value = this.configService.get(key);
        if (value === undefined || value === null || value.trim() === '') {
            throw new Error(`Missing required configuration key: ${key}`);
        }
        return value;
    }
    getOptional(key, defaultValue) {
        return this.configService.get(key) ?? defaultValue;
    }
    async getSecret(key) {
        await Promise.resolve();
        return this.getRequired(key);
    }
    async getSecretOptional(key, defaultValue) {
        await Promise.resolve();
        return this.getOptional(key, defaultValue);
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
        return { provider: 'local', source: 'process.env / .env files' };
    }
};
exports.LocalConfigProvider = LocalConfigProvider;
exports.LocalConfigProvider = LocalConfigProvider = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], LocalConfigProvider);
