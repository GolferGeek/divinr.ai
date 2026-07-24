import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { SupabaseService } from './supabase-client.service';
import {
  DatabaseService,
  DatabaseTransaction,
  TransactionIsolationLevel,
  QueryBuilder,
  QueryResult,
} from './database.interface';

/**
 * Supabase implementation of DatabaseService.
 *
 * Delegates directly to the Supabase PostgREST query builder,
 * which is already chainable and PromiseLike.
 */
@Injectable()
export class SupabaseDatabaseService implements DatabaseService, OnModuleDestroy {
  private readonly logger = new Logger(SupabaseDatabaseService.name);
  private pool: Pool | null = null;

  constructor(
    @Inject(SupabaseService) private readonly supabaseService: SupabaseService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async onModuleDestroy() {
    if (this.pool) {
      const p = this.pool;
      this.pool = null;
      try {
        await p.end();
      } catch {
        // Pool may already be ended by another module teardown — safe to ignore
      }
    }
  }

  from(schema: string | null, table: string): QueryBuilder {
    const client = this.supabaseService.getServiceClient();
    if (schema) {
      return client.schema(schema).from(table) as unknown as QueryBuilder;
    }
    return client.from(table) as unknown as QueryBuilder;
  }

  async rpc(
    functionName: string,
    args?: Record<string, unknown>,
    schema?: string | null,
  ): Promise<QueryResult> {
    const client = this.supabaseService.getServiceClient();
    if (schema) {
      return client
        .schema(schema)
        .rpc(functionName, args) as unknown as Promise<QueryResult>;
    }
    return client.rpc(functionName, args) as unknown as Promise<QueryResult>;
  }

  async checkConnection(): Promise<{ status: string; message: string }> {
    return this.supabaseService.checkConnection();
  }

  async rawQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      const pool = this.getPool();
      const result = await pool.query(sql, params ?? []);
      return { data: result.rows, error: null, count: result.rowCount ?? null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    }
  }

  async withTransaction<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
    options?: { isolationLevel?: TransactionIsolationLevel },
  ): Promise<T> {
    const client = await this.getPool().connect();
    const isolation = (options?.isolationLevel ?? 'read committed').toUpperCase();
    try {
      await client.query('BEGIN');
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
      const result = await work({
        rawQuery: (sql, params) => this.rawQueryWithClient(client, sql, params),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error('Supabase PostgreSQL transaction rollback failed', rollbackError);
      }
      throw error;
    } finally {
      client.release();
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

  private getConnectionString(): string {
    const url = this.configService.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error(
        'DATABASE_URL is required for raw query and checkpoint support',
      );
    }
    return url;
  }

  private getPool(): Pool {
    if (this.pool) {
      return this.pool;
    }
    const connectionString = this.getConnectionString();
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    return this.pool;
  }

  private async rawQueryWithClient(
    client: PoolClient,
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult> {
    try {
      const result = await client.query(sql, params ?? []);
      return { data: result.rows, error: null, count: result.rowCount ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { data: null, error: { message } };
    }
  }
}
