"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SupabaseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const supabase_js_1 = require("@supabase/supabase-js");
const path_1 = require("path");
const dotenv = __importStar(require("dotenv"));
const supabase_client_config_1 = require("./supabase-client.config");
let SupabaseService = SupabaseService_1 = class SupabaseService {
    configService;
    anonClient = null;
    serviceClient = null;
    coreSchema;
    companySchema;
    logger = new common_1.Logger(SupabaseService_1.name);
    constructor(configService) {
        this.configService = configService;
        // Initialize synchronously so clients exist before any consumer calls getServiceClient().
        // Constructor runs before onModuleInit; some modules (MemoryManager, LLMPricing) use DB
        // during their onModuleInit, so we must have the client ready by then.
        this.initializeClients();
    }
    onModuleInit() {
        // No-op: initialization moved to constructor for earlier availability
    }
    /**
     * Ensure .env is loaded before reading config (handles module init order edge cases).
     * Mirrors main.ts bootstrap logic. Uses override to ensure .env wins over parent env.
     */
    ensureEnvLoaded() {
        const baseEnvPath = process.env.ENV_FILE
            ? process.env.ENV_FILE.startsWith('/')
                ? process.env.ENV_FILE
                : (0, path_1.join)(process.cwd(), process.env.ENV_FILE)
            : (0, path_1.join)(process.cwd(), '../../.env');
        const result = dotenv.config({ path: baseEnvPath, override: true });
        if (result.error) {
            this.logger.warn(`SupabaseService: dotenv load failed from ${baseEnvPath}: ${result.error.message}`);
        }
    }
    initializeClients() {
        this.ensureEnvLoaded();
        // Get configuration - process.env first, then ConfigService, then local dev defaults
        const LOCAL_DEFAULT_URL = 'http://127.0.0.1:6010';
        const LOCAL_DEFAULT_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
        const supabaseConfig = this.configService.get('supabase');
        const url = process.env.SUPABASE_URL ??
            supabaseConfig?.url ??
            this.configService.get('SUPABASE_URL') ??
            LOCAL_DEFAULT_URL;
        const anonKey = process.env.SUPABASE_ANON_KEY ??
            supabaseConfig?.anonKey ??
            this.configService.get('SUPABASE_ANON_KEY');
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ??
            supabaseConfig?.serviceKey ??
            this.configService.get('SUPABASE_SERVICE_ROLE_KEY') ??
            LOCAL_DEFAULT_SERVICE_KEY;
        const coreSchema = this.configService.get('supabase.coreSchema') ||
            this.configService.get('SUPABASE_CORE_SCHEMA') ||
            'public';
        const companySchema = this.configService.get('supabase.companySchema') ||
            this.configService.get('SUPABASE_COMPANY_SCHEMA') ||
            'public';
        // Both schemas are now 'public' after consolidation, but keep variables for compatibility
        // Log the configuration
        this.logger.warn(`Supabase config - URL: ${url ? 'SET' : 'NOT SET'}, AnonKey: ${anonKey ? 'SET' : 'NOT SET'}, ServiceKey: ${serviceKey ? 'SET' : 'NOT SET'}`);
        // Store schema configuration for easy access
        this.coreSchema = coreSchema;
        this.companySchema = companySchema;
        if (!url) {
            this.logger.error('Supabase URL not set. Set SUPABASE_URL in .env. Ensure API is started with start-dev.sh (npm run dev:api) so env is loaded.');
            return;
        }
        if (!serviceKey) {
            this.logger.error('Supabase service role key not set. Set SUPABASE_SERVICE_ROLE_KEY in .env.');
        }
        // Initialize anonymous client (for RLS-compliant operations)
        if (anonKey) {
            this.anonClient = (0, supabase_js_1.createClient)(url, anonKey, {
                global: {
                    fetch: (requestUrl, options = {}) => fetch(requestUrl, {
                        ...options,
                        signal: AbortSignal.timeout(60000), // 60 second timeout
                    }),
                },
            });
        }
        // Initialize service client (bypasses RLS - use with caution)
        if (serviceKey) {
            this.serviceClient = (0, supabase_js_1.createClient)(url, serviceKey, {
                global: {
                    fetch: (requestUrl, options = {}) => fetch(requestUrl, {
                        ...options,
                        signal: AbortSignal.timeout(60000), // 60 second timeout
                    }),
                },
            });
        }
    }
    /**
     * Get the anonymous Supabase client (respects RLS policies)
     * Equivalent to FastAPI's get_supabase_client()
     */
    getAnonClient() {
        if (!this.anonClient) {
            throw new common_1.HttpException('Supabase client is not available. Check server configuration.', common_1.HttpStatus.SERVICE_UNAVAILABLE);
        }
        return this.anonClient;
    }
    /**
     * Get the service role client (bypasses RLS - use with extreme caution)
     * Equivalent to FastAPI's get_supabase_service_client()
     */
    getServiceClient() {
        if (!this.serviceClient) {
            throw new common_1.HttpException('Supabase service client is not available. Check server configuration.', common_1.HttpStatus.SERVICE_UNAVAILABLE);
        }
        return this.serviceClient;
    }
    /**
     * Create a new client instance with a specific auth token
     * Equivalent to FastAPI's get_supabase_client_as_current_user()
     */
    createAuthenticatedClient(token) {
        const url = this.configService.get('supabase.url') ||
            this.configService.get('SUPABASE_URL');
        const anonKey = this.configService.get('supabase.anonKey') ||
            this.configService.get('SUPABASE_ANON_KEY');
        if (!url || !anonKey) {
            throw new common_1.HttpException('Authentication service configuration error.', common_1.HttpStatus.SERVICE_UNAVAILABLE);
        }
        try {
            const authenticatedClient = (0, supabase_js_1.createClient)(url, anonKey, {
                global: {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                },
            });
            return authenticatedClient;
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : 'Could not create authenticated client.';
            this.logger.error(message, error instanceof Error ? error.stack : undefined);
            throw new common_1.HttpException('Could not create authenticated client.', common_1.HttpStatus.UNAUTHORIZED);
        }
    }
    /**
     * Execute a query with proper error handling and connection management
     * Ports the error handling patterns from FastAPI
     */
    async executeQuery(callback, useServiceClient = false) {
        const client = useServiceClient
            ? this.getServiceClient()
            : this.getAnonClient();
        try {
            return await callback(client);
        }
        catch (error) {
            this.logger.error('Supabase query execution failed', error instanceof Error ? error.stack : undefined);
            throw error;
        }
    }
    /**
     * Get current Supabase configuration information
     */
    getConfig() {
        const url = this.configService.get('supabase.url') ||
            this.configService.get('SUPABASE_URL') ||
            '';
        return {
            url: url.substring(0, 30) + '...', // Truncate for security
            coreSchema: this.coreSchema,
            companySchema: this.companySchema,
            clientsAvailable: {
                anon: this.anonClient !== null,
                service: this.serviceClient !== null,
            },
        };
    }
    /**
     * Get schema-aware table name
     */
    getTableName(tableName, explicitSchema) {
        return (0, supabase_client_config_1.getTableName)(tableName, explicitSchema);
    }
    /**
     * Get core schema name
     */
    getCoreSchema() {
        return this.coreSchema;
    }
    /**
     * Get company schema name
     */
    getCompanySchema() {
        return this.companySchema;
    }
    /**
     * Health check for database connectivity
     * Can be used to verify Supabase connection status
     */
    async checkConnection() {
        if (!this.anonClient) {
            return {
                status: 'disabled',
                message: 'Supabase not configured - service disabled',
            };
        }
        try {
            // Attempt a simple query to test connectivity.
            // Users live in the authz schema, not public.
            const { error } = await this.anonClient
                .schema('authz')
                .from('users')
                .select('id')
                .limit(1);
            if (error) {
                return { status: 'error', message: error.message };
            }
            return { status: 'ok', message: 'Database connection successful' };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Supabase health check failed', error instanceof Error ? error.stack : undefined);
            return { status: 'error', message };
        }
    }
};
exports.SupabaseService = SupabaseService;
exports.SupabaseService = SupabaseService = SupabaseService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SupabaseService);
