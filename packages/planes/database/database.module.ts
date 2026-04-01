import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase-client.service';
import supabaseConfig from './supabase-client.config';
import { DATABASE_SERVICE, DatabaseService } from './database.interface';
import { SupabaseDatabaseService } from './supabase-database.service';
import { SqlServerDatabaseService } from './sqlserver-database.service';
import { PostgresqlDatabaseService } from './postgresql-database.service';
import { resolveDatabaseProvider } from './provider-selection';

@Global()
@Module({
  imports: [ConfigModule.forFeature(supabaseConfig)],
  providers: [
    SupabaseService,
    SupabaseDatabaseService,
    SqlServerDatabaseService,
    PostgresqlDatabaseService,
    {
      provide: DATABASE_SERVICE,
      useFactory: (
        configService: ConfigService,
        sqlServerDb: SqlServerDatabaseService,
        postgresqlDb: PostgresqlDatabaseService,
        supabaseDb: SupabaseDatabaseService,
      ): DatabaseService => {
        const provider = resolveDatabaseProvider(
          configService.get<string>('DB_PROVIDER'),
        );
        switch (provider) {
          case 'supabase':
          case 'supabase_pg':
            return supabaseDb;
          case 'sqlserver':
            return sqlServerDb;
          case 'postgresql':
            return postgresqlDb;
        }
      },
      inject: [
        ConfigService,
        SqlServerDatabaseService,
        PostgresqlDatabaseService,
        SupabaseDatabaseService,
      ],
    },
  ],
  exports: [DATABASE_SERVICE, SupabaseService],
})
export class DatabaseModule {}
