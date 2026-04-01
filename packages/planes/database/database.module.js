"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const supabase_client_service_1 = require("./supabase-client.service");
const supabase_client_config_1 = __importDefault(require("./supabase-client.config"));
const database_interface_1 = require("./database.interface");
const supabase_database_service_1 = require("./supabase-database.service");
const sqlserver_database_service_1 = require("./sqlserver-database.service");
const postgresql_database_service_1 = require("./postgresql-database.service");
// Evaluated at module load time before NestJS DI wires anything.
// SupabaseService and SupabaseDatabaseService are only registered when
// DB_PROVIDER is supabase or supabase_pg. On Azure (sqlserver) and GCP
// (postgresql) deployments, they are excluded entirely to prevent
// SupabaseService from initialising without its required env vars.
const dbProvider = process.env.DB_PROVIDER || 'supabase';
const needsSupabase = dbProvider === 'supabase' || dbProvider === 'supabase_pg';
let DatabaseModule = class DatabaseModule {
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: needsSupabase ? [config_1.ConfigModule.forFeature(supabase_client_config_1.default)] : [],
        providers: [
            ...(needsSupabase ? [supabase_client_service_1.SupabaseService, supabase_database_service_1.SupabaseDatabaseService] : []),
            sqlserver_database_service_1.SqlServerDatabaseService,
            postgresql_database_service_1.PostgresqlDatabaseService,
            {
                provide: database_interface_1.DATABASE_SERVICE,
                useFactory: (configService, sqlServerDb, postgresqlDb, supabaseDb) => {
                    const provider = configService.get('DB_PROVIDER') || 'supabase';
                    switch (provider) {
                        case 'supabase':
                        case 'supabase_pg':
                            if (!supabaseDb) {
                                throw new Error('SupabaseDatabaseService not available — DB_PROVIDER is not supabase/supabase_pg');
                            }
                            return supabaseDb;
                        case 'sqlserver':
                            return sqlServerDb;
                        case 'postgresql':
                            return postgresqlDb;
                        default:
                            throw new Error(`Unsupported DB_PROVIDER '${provider}'. Expected: supabase, supabase_pg, sqlserver, postgresql`);
                    }
                },
                // Non-supabase providers come first (always present).
                // SupabaseDatabaseService is appended only when needsSupabase, making it
                // the last positional argument (supabaseDb? in the factory).
                inject: [
                    config_1.ConfigService,
                    sqlserver_database_service_1.SqlServerDatabaseService,
                    postgresql_database_service_1.PostgresqlDatabaseService,
                    ...(needsSupabase ? [supabase_database_service_1.SupabaseDatabaseService] : []),
                ],
            },
        ],
        exports: [database_interface_1.DATABASE_SERVICE, ...(needsSupabase ? [supabase_client_service_1.SupabaseService] : [])],
    })
], DatabaseModule);
