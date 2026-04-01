export { DATABASE_SERVICE } from './database.interface';
export type {
  DatabaseService,
  QueryResult,
  QueryBuilder,
} from './database.interface';
export { SupabaseDatabaseService } from './supabase-database.service';
export { SqlServerDatabaseService } from './sqlserver-database.service';
export { DatabaseModule } from './database.module';
// SupabaseService is an internal implementation detail of the database plane.
// It is exported from DatabaseModule for sibling planes (storage, auth) that
// need the raw Supabase client, but should NOT be imported by products directly.
export { SupabaseService } from './supabase-client.service';
export { getTableName, getSchemaForTable } from './supabase-client.config';
