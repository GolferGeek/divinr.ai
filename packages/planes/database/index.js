"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSchemaForTable = exports.getTableName = exports.SupabaseService = exports.DatabaseModule = exports.SqlServerDatabaseService = exports.SupabaseDatabaseService = exports.DATABASE_SERVICE = void 0;
var database_interface_1 = require("./database.interface");
Object.defineProperty(exports, "DATABASE_SERVICE", { enumerable: true, get: function () { return database_interface_1.DATABASE_SERVICE; } });
var supabase_database_service_1 = require("./supabase-database.service");
Object.defineProperty(exports, "SupabaseDatabaseService", { enumerable: true, get: function () { return supabase_database_service_1.SupabaseDatabaseService; } });
var sqlserver_database_service_1 = require("./sqlserver-database.service");
Object.defineProperty(exports, "SqlServerDatabaseService", { enumerable: true, get: function () { return sqlserver_database_service_1.SqlServerDatabaseService; } });
var database_module_1 = require("./database.module");
Object.defineProperty(exports, "DatabaseModule", { enumerable: true, get: function () { return database_module_1.DatabaseModule; } });
// SupabaseService is an internal implementation detail of the database plane.
// It is exported from DatabaseModule for sibling planes (storage, auth) that
// need the raw Supabase client, but should NOT be imported by products directly.
var supabase_client_service_1 = require("./supabase-client.service");
Object.defineProperty(exports, "SupabaseService", { enumerable: true, get: function () { return supabase_client_service_1.SupabaseService; } });
var supabase_client_config_1 = require("./supabase-client.config");
Object.defineProperty(exports, "getTableName", { enumerable: true, get: function () { return supabase_client_config_1.getTableName; } });
Object.defineProperty(exports, "getSchemaForTable", { enumerable: true, get: function () { return supabase_client_config_1.getSchemaForTable; } });
