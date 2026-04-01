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
var SupabaseDatabaseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseDatabaseService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const pg_1 = require("pg");
const supabase_client_service_1 = require("./supabase-client.service");
/**
 * Supabase implementation of DatabaseService.
 *
 * Delegates directly to the Supabase PostgREST query builder,
 * which is already chainable and PromiseLike.
 */
let SupabaseDatabaseService = SupabaseDatabaseService_1 = class SupabaseDatabaseService {
    supabaseService;
    configService;
    logger = new common_1.Logger(SupabaseDatabaseService_1.name);
    pool = null;
    constructor(supabaseService, configService) {
        this.supabaseService = supabaseService;
        this.configService = configService;
    }
    from(schema, table) {
        const client = this.supabaseService.getServiceClient();
        if (schema) {
            return client.schema(schema).from(table);
        }
        return client.from(table);
    }
    async rpc(functionName, args, schema) {
        const client = this.supabaseService.getServiceClient();
        if (schema) {
            return client
                .schema(schema)
                .rpc(functionName, args);
        }
        return client.rpc(functionName, args);
    }
    async checkConnection() {
        return this.supabaseService.checkConnection();
    }
    async rawQuery(sql, params) {
        try {
            const pool = this.getPool();
            const result = await pool.query(sql, params ?? []);
            return { data: result.rows, error: null, count: result.rowCount ?? null };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { data: null, error: { message } };
        }
    }
    getConfig() {
        const config = this.supabaseService.getConfig();
        return {
            provider: 'supabase',
            url: config.url,
            schemas: [...new Set([config.coreSchema, config.companySchema])],
            clientsAvailable: config.clientsAvailable,
        };
    }
    getConnectionString() {
        const url = this.configService.get('DATABASE_URL');
        if (!url) {
            throw new Error('DATABASE_URL is required for raw query and checkpoint support');
        }
        return url;
    }
    getPool() {
        if (this.pool) {
            return this.pool;
        }
        const connectionString = this.getConnectionString();
        this.pool = new pg_1.Pool({
            connectionString,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });
        return this.pool;
    }
};
exports.SupabaseDatabaseService = SupabaseDatabaseService;
exports.SupabaseDatabaseService = SupabaseDatabaseService = SupabaseDatabaseService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_client_service_1.SupabaseService,
        config_1.ConfigService])
], SupabaseDatabaseService);
