import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import {
  DatabaseService,
  QueryBuilder,
  QueryResult,
} from './database.interface';

/**
 * PostgreSQL implementation of DatabaseService.
 *
 * Translates the chainable QueryBuilder API into standard SQL queries
 * executed against a PostgreSQL instance via the pg driver.
 *
 * Schema mapping: schema is passed as part of the qualified table name.
 */
@Injectable()
export class PostgresqlDatabaseService implements DatabaseService, OnModuleDestroy {
  private readonly logger = new Logger(PostgresqlDatabaseService.name);
  private pool: Pool | null = null;

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  from(schema: string | null, table: string): QueryBuilder {
    return new PostgresQueryBuilder(() => this.getPool(), schema, table);
  }

  async rpc(
    functionName: string,
    args?: Record<string, unknown>,
    schema?: string | null,
  ): Promise<QueryResult> {
    const pool = await this.getPool();
    const qualifiedName = schema
      ? `"${schema}"."${functionName}"`
      : `"${functionName}"`;

    const params: unknown[] = [];
    let argList = '';
    if (args) {
      const entries = Object.entries(args);
      argList = entries.map((_, i) => `$${i + 1}`).join(', ');
      params.push(...entries.map(([, v]) => v));
    }

    try {
      const result = await pool.query(
        `SELECT * FROM ${qualifiedName}(${argList})`,
        params,
      );
      // Mimic PostgREST / supabase-js RPC behavior: unwrap a single-row,
      // single-column result to its scalar value. SQL functions returning
      // a scalar (e.g. boolean) should land as `data: <scalar>` so consumers
      // can do `data === true` without driver-aware shape handling.
      let data: unknown = result.rows;
      if (result.rowCount === 1) {
        const firstRow = result.rows[0] as Record<string, unknown>;
        const cols = Object.keys(firstRow);
        if (cols.length === 1) {
          data = firstRow[cols[0]];
        }
      }
      return {
        data,
        error: null,
        count: result.rowCount ?? null,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    }
  }

  async checkConnection(): Promise<{ status: string; message: string }> {
    try {
      const pool = await this.getPool();
      await pool.query('SELECT 1 AS ok');
      return { status: 'ok', message: 'PostgreSQL connection healthy' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'error', message };
    }
  }

  async rawQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      const pool = await this.getPool();
      const result = await pool.query(sql, params ?? []);
      return { data: result.rows, error: null, count: result.rowCount ?? null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    }
  }

  getConfig() {
    const url = this.resolveConnectionString();
    return {
      provider: 'postgresql',
      url,
      schemas: [
        'public',
        'authz',
        'orch_flow',
        'prediction',
        'risk',
        'crawler',
      ],
      clientsAvailable: { service: true, anon: false },
    };
  }

  private resolveConnectionString(): string {
    const explicit = this.configService.get<string>('POSTGRESQL_URL');
    if (explicit) return explicit;

    const host = this.configService.getOrThrow<string>('PG_HOST');
    const port = this.configService.get<string>('PG_PORT') ?? '5432';
    const database = this.configService.getOrThrow<string>('PG_DATABASE');
    const user = this.configService.getOrThrow<string>('PG_USER');
    const password = this.configService.getOrThrow<string>('PG_PASSWORD');
    return `postgresql://${user}:${password}@${host}:${port}/${database}`;
  }

  private getPool(): Promise<Pool> {
    if (this.pool) {
      return Promise.resolve(this.pool);
    }

    const connectionString = this.resolveConnectionString();
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    return Promise.resolve(this.pool);
  }
}

// ---------------------------------------------------------------------------
// PostgresQueryBuilder
// ---------------------------------------------------------------------------

class PostgresQueryBuilder implements QueryBuilder {
  private readonly getPool: () => Promise<Pool>;
  private readonly schemaName: string | null;
  private readonly tableName: string;

  private operation:
    | 'select'
    | 'insert'
    | 'update'
    | 'upsert'
    | 'delete'
    | null = null;
  private selectColumns = '*';
  private countMode: 'exact' | 'planned' | 'estimated' | null = null;
  private headOnly = false;
  private returning = false;
  private returningColumns = '*';

  private insertData:
    | Record<string, unknown>
    | Record<string, unknown>[]
    | null = null;
  private updateData: Record<string, unknown> | null = null;
  private upsertData:
    | Record<string, unknown>
    | Record<string, unknown>[]
    | null = null;
  private upsertConflict: string | null = null;
  private upsertIgnoreDuplicates = false;

  private conditions: string[] = [];
  private params: unknown[] = [];

  private orderClauses: string[] = [];
  private limitCount: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private singleRow = false;
  private maybeSingleRow = false;

  constructor(
    poolFn: () => Promise<Pool>,
    schema: string | null,
    table: string,
  ) {
    this.getPool = poolFn;
    this.schemaName = schema;
    this.tableName = table;
  }

  private qualifiedTable(): string {
    return this.schemaName
      ? `"${this.schemaName}"."${this.tableName}"`
      : `"${this.tableName}"`;
  }

  private nextParam(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  // ---- Data operations ----

  select(
    columns?: string,
    options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
  ): QueryBuilder {
    if (this.operation === null) {
      this.operation = 'select';
      this.selectColumns = columns ?? '*';
    } else {
      this.returning = true;
      this.returningColumns = columns ?? '*';
    }
    if (options?.count) {
      this.countMode = options.count;
    }
    if (options?.head) {
      this.headOnly = true;
    }
    return this;
  }

  insert(data: unknown): QueryBuilder {
    this.operation = 'insert';
    this.insertData = data as
      | Record<string, unknown>
      | Record<string, unknown>[];
    return this;
  }

  update(data: unknown): QueryBuilder {
    this.operation = 'update';
    this.updateData = data as Record<string, unknown>;
    return this;
  }

  upsert(
    data: unknown,
    options?: {
      onConflict?: string;
      ignoreDuplicates?: boolean;
      count?: 'exact' | 'planned' | 'estimated';
    },
  ): QueryBuilder {
    this.operation = 'upsert';
    this.upsertData = data as
      | Record<string, unknown>
      | Record<string, unknown>[];
    this.upsertConflict = options?.onConflict ?? null;
    this.upsertIgnoreDuplicates = options?.ignoreDuplicates ?? false;
    return this;
  }

  delete(_options?: {
    count?: 'exact' | 'planned' | 'estimated';
  }): QueryBuilder {
    this.operation = 'delete';
    return this;
  }

  // ---- Filters ----

  eq(column: string, value: unknown): QueryBuilder {
    if (value === null) {
      this.conditions.push(`"${column}" IS NULL`);
    } else {
      const p = this.nextParam(value);
      this.conditions.push(`"${column}" = ${p}`);
    }
    return this;
  }

  neq(column: string, value: unknown): QueryBuilder {
    if (value === null) {
      this.conditions.push(`"${column}" IS NOT NULL`);
    } else {
      const p = this.nextParam(value);
      this.conditions.push(`"${column}" != ${p}`);
    }
    return this;
  }

  gt(column: string, value: unknown): QueryBuilder {
    const p = this.nextParam(value);
    this.conditions.push(`"${column}" > ${p}`);
    return this;
  }

  gte(column: string, value: unknown): QueryBuilder {
    const p = this.nextParam(value);
    this.conditions.push(`"${column}" >= ${p}`);
    return this;
  }

  lt(column: string, value: unknown): QueryBuilder {
    const p = this.nextParam(value);
    this.conditions.push(`"${column}" < ${p}`);
    return this;
  }

  lte(column: string, value: unknown): QueryBuilder {
    const p = this.nextParam(value);
    this.conditions.push(`"${column}" <= ${p}`);
    return this;
  }

  in(column: string, values: unknown[]): QueryBuilder {
    if (values.length === 0) {
      this.conditions.push('1 = 0');
      return this;
    }
    const params = values.map((v) => this.nextParam(v));
    this.conditions.push(`"${column}" IN (${params.join(', ')})`);
    return this;
  }

  is(column: string, value: null | boolean): QueryBuilder {
    if (value === null) {
      this.conditions.push(`"${column}" IS NULL`);
    } else {
      const p = this.nextParam(value);
      this.conditions.push(`"${column}" IS ${p}`);
    }
    return this;
  }

  not(column: string, operator: string, value: unknown): QueryBuilder {
    switch (operator) {
      case 'is':
        if (value === null) {
          this.conditions.push(`"${column}" IS NOT NULL`);
        } else {
          const p = this.nextParam(value);
          this.conditions.push(`"${column}" IS NOT ${p}`);
        }
        break;
      case 'eq': {
        const p = this.nextParam(value);
        this.conditions.push(`NOT ("${column}" = ${p})`);
        break;
      }
      case 'in': {
        const vals = value as unknown[];
        if (vals.length === 0) break;
        const params = vals.map((v) => this.nextParam(v));
        this.conditions.push(`"${column}" NOT IN (${params.join(', ')})`);
        break;
      }
      default: {
        const p = this.nextParam(value);
        this.conditions.push(
          `NOT ("${column}" ${this.sqlOperator(operator)} ${p})`,
        );
        break;
      }
    }
    return this;
  }

  contains(column: string, value: unknown): QueryBuilder {
    if (Array.isArray(value)) {
      const p = this.nextParam(JSON.stringify(value));
      this.conditions.push(`"${column}" @> ${p}::jsonb`);
    } else if (typeof value === 'object' && value !== null) {
      const p = this.nextParam(JSON.stringify(value));
      this.conditions.push(`"${column}" @> ${p}::jsonb`);
    } else {
      const p = this.nextParam(value);
      this.conditions.push(`"${column}" = ${p}`);
    }
    return this;
  }

  overlaps(column: string, value: unknown[]): QueryBuilder {
    const p = this.nextParam(JSON.stringify(value));
    this.conditions.push(`"${column}" && ${p}::jsonb`);
    return this;
  }

  ilike(column: string, pattern: string): QueryBuilder {
    const p = this.nextParam(pattern);
    this.conditions.push(`"${column}" ILIKE ${p}`);
    return this;
  }

  like(column: string, pattern: string): QueryBuilder {
    const p = this.nextParam(pattern);
    this.conditions.push(`"${column}" LIKE ${p}`);
    return this;
  }

  or(filters: string): QueryBuilder {
    const clauses = filters.split(',');
    const orParts: string[] = [];

    for (const raw of clauses) {
      const parsed = parseFilterClause(raw.trim());
      if (!parsed) continue;
      const sql = this.filterClauseToSql(parsed);
      if (sql) orParts.push(sql);
    }

    if (orParts.length > 0) {
      this.conditions.push(`(${orParts.join(' OR ')})`);
    }
    return this;
  }

  filter(column: string, operator: string, value: unknown): QueryBuilder {
    switch (operator) {
      case 'eq':
        return this.eq(column, value);
      case 'neq':
        return this.neq(column, value);
      case 'gt':
        return this.gt(column, value);
      case 'gte':
        return this.gte(column, value);
      case 'lt':
        return this.lt(column, value);
      case 'lte':
        return this.lte(column, value);
      case 'like':
        return this.like(column, value as string);
      case 'ilike':
        return this.ilike(column, value as string);
      case 'is':
        return this.is(column, value as null | boolean);
      case 'cs':
        return this.contains(column, value);
      default: {
        const p = this.nextParam(value);
        this.conditions.push(`"${column}" ${this.sqlOperator(operator)} ${p}`);
        return this;
      }
    }
  }

  match(query: Record<string, unknown>): QueryBuilder {
    for (const [col, val] of Object.entries(query)) {
      this.eq(col, val);
    }
    return this;
  }

  textSearch(
    column: string,
    query: string,
    options?: { type?: 'plain' | 'phrase' | 'websearch'; config?: string },
  ): QueryBuilder {
    const config = options?.config ?? 'english';
    const type = options?.type ?? 'plain';
    const p = this.nextParam(query);
    const tsFunction =
      type === 'websearch'
        ? 'websearch_to_tsquery'
        : type === 'phrase'
          ? 'phraseto_tsquery'
          : 'plainto_tsquery';
    this.conditions.push(
      `to_tsvector('${config}', "${column}") @@ ${tsFunction}('${config}', ${p})`,
    );
    return this;
  }

  // ---- Modifiers ----

  order(column: string, options?: { ascending?: boolean }): QueryBuilder {
    const dir = options?.ascending === false ? 'DESC' : 'ASC';
    this.orderClauses.push(`"${column}" ${dir}`);
    return this;
  }

  limit(count: number): QueryBuilder {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number): QueryBuilder {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  single(): QueryBuilder {
    this.singleRow = true;
    return this;
  }

  maybeSingle(): QueryBuilder {
    this.maybeSingleRow = true;
    return this;
  }

  // ---- PromiseLike ----

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  // ---- Private helpers ----

  private filterClauseToSql(parsed: ParsedFilterClause): string | null {
    const { column, operator, value } = parsed;
    switch (operator) {
      case 'eq':
        if (value === 'null') return `"${column}" IS NULL`;
        if (value === 'true') return `"${column}" IS TRUE`;
        if (value === 'false') return `"${column}" IS FALSE`;
        return `"${column}" = ${this.nextParam(value)}`;
      case 'neq':
        return `"${column}" != ${this.nextParam(value)}`;
      case 'gt':
        return `"${column}" > ${this.nextParam(value)}`;
      case 'gte':
        return `"${column}" >= ${this.nextParam(value)}`;
      case 'lt':
        return `"${column}" < ${this.nextParam(value)}`;
      case 'lte':
        return `"${column}" <= ${this.nextParam(value)}`;
      case 'is':
        if (value === 'null') return `"${column}" IS NULL`;
        if (value === 'true') return `"${column}" IS TRUE`;
        if (value === 'false') return `"${column}" IS FALSE`;
        return null;
      case 'like':
        return `"${column}" LIKE ${this.nextParam(value)}`;
      case 'ilike':
        return `"${column}" ILIKE ${this.nextParam(value)}`;
      default:
        return null;
    }
  }

  private sqlOperator(op: string): string {
    const map: Record<string, string> = {
      eq: '=',
      neq: '!=',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
      like: 'LIKE',
      ilike: 'ILIKE',
    };
    return map[op] ?? '=';
  }

  private whereClause(): string {
    if (this.conditions.length === 0) return '';
    return ` WHERE ${this.conditions.join(' AND ')}`;
  }

  private buildSelect(): string {
    const table = this.qualifiedTable();
    const where = this.whereClause();
    const cols = this.selectColumns;

    if (this.headOnly) {
      return `SELECT COUNT(*) AS __count FROM ${table}${where}`;
    }

    const countCol = this.countMode ? ', COUNT(*) OVER() AS __total_count' : '';
    const orderBy =
      this.orderClauses.length > 0
        ? ` ORDER BY ${this.orderClauses.join(', ')}`
        : '';

    let pagination = '';
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      pagination = ` OFFSET ${this.rangeFrom} LIMIT ${this.rangeTo - this.rangeFrom + 1}`;
    } else if (this.limitCount !== null) {
      pagination = ` LIMIT ${this.limitCount}`;
    }

    return `SELECT ${cols}${countCol} FROM ${table}${where}${orderBy}${pagination}`;
  }

  private buildInsert(): string {
    const table = this.qualifiedTable();
    const rows = Array.isArray(this.insertData)
      ? this.insertData
      : [this.insertData!];

    const columns = Object.keys(rows[0]!);
    const colList = columns.map((c) => `"${c}"`).join(', ');
    const returning = this.returning
      ? ` RETURNING ${this.returningColumns}`
      : '';

    const valueRows = rows.map((row) => {
      const vals = columns.map((c) => {
        const v = row[c];
        return this.nextParam(
          typeof v === 'object' && v !== null && !(v instanceof Date)
            ? JSON.stringify(v)
            : v,
        );
      });
      return `(${vals.join(', ')})`;
    });

    return `INSERT INTO ${table} (${colList}) VALUES ${valueRows.join(', ')}${returning}`;
  }

  private buildUpdate(): string {
    const table = this.qualifiedTable();
    const where = this.whereClause();
    const returning = this.returning
      ? ` RETURNING ${this.returningColumns}`
      : '';

    const sets = Object.entries(this.updateData!).map(([col, val]) => {
      const p = this.nextParam(
        typeof val === 'object' && val !== null && !(val instanceof Date)
          ? JSON.stringify(val)
          : val,
      );
      return `"${col}" = ${p}`;
    });

    return `UPDATE ${table} SET ${sets.join(', ')}${where}${returning}`;
  }

  private buildUpsert(): string {
    const table = this.qualifiedTable();
    const rows = Array.isArray(this.upsertData)
      ? this.upsertData
      : [this.upsertData!];

    const columns = Object.keys(rows[0]!);
    const conflictCols = this.upsertConflict
      ? this.upsertConflict.split(',').map((c) => c.trim())
      : ['id'];

    const colList = columns.map((c) => `"${c}"`).join(', ');
    const returning = this.returning
      ? ` RETURNING ${this.returningColumns}`
      : '';

    // For multiple rows, build a single INSERT with multiple value sets
    const valueRows = rows.map((row) => {
      const vals = columns.map((c) => {
        const v = row[c];
        return this.nextParam(
          typeof v === 'object' && v !== null && !(v instanceof Date)
            ? JSON.stringify(v)
            : v,
        );
      });
      return `(${vals.join(', ')})`;
    });

    const conflictTarget = `(${conflictCols.map((c) => `"${c}"`).join(', ')})`;

    if (this.upsertIgnoreDuplicates) {
      return (
        `INSERT INTO ${table} (${colList}) VALUES ${valueRows.join(', ')} ` +
        `ON CONFLICT ${conflictTarget} DO NOTHING${returning}`
      );
    }

    const nonConflictCols = columns.filter((c) => !conflictCols.includes(c));
    const updateSet = nonConflictCols
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');

    return (
      `INSERT INTO ${table} (${colList}) VALUES ${valueRows.join(', ')} ` +
      `ON CONFLICT ${conflictTarget} DO UPDATE SET ${updateSet}${returning}`
    );
  }

  private buildDelete(): string {
    const table = this.qualifiedTable();
    const where = this.whereClause();
    const returning = this.returning
      ? ` RETURNING ${this.returningColumns}`
      : '';
    return `DELETE FROM ${table}${where}${returning}`;
  }

  private buildSql(): string {
    switch (this.operation) {
      case 'select':
        return this.buildSelect();
      case 'insert':
        return this.buildInsert();
      case 'update':
        return this.buildUpdate();
      case 'upsert':
        return this.buildUpsert();
      case 'delete':
        return this.buildDelete();
      default:
        throw new Error(
          'No operation specified. Call select(), insert(), update(), upsert(), or delete() before executing.',
        );
    }
  }

  private async execute(): Promise<QueryResult> {
    let client: PoolClient | null = null;
    try {
      const pool = await this.getPool();
      const sql = this.buildSql();

      client = await pool.connect();
      const result = await client.query(sql, this.params);
      const rows = result.rows as Record<string, unknown>[];

      if (this.headOnly) {
        const countVal = rows[0]?.__count;
        return {
          data: null,
          error: null,
          count:
            countVal !== undefined
              ? parseInt(`${countVal as string | number}`, 10)
              : null,
        };
      }

      let count: number | null = null;
      if (this.countMode && rows.length > 0) {
        const firstRow = rows[0];
        count =
          firstRow?.__total_count !== undefined
            ? parseInt(`${firstRow.__total_count as string | number}`, 10)
            : null;
        for (const row of rows) {
          delete row.__total_count;
        }
      }

      if (this.singleRow) {
        if (rows.length === 0) {
          return {
            data: null,
            error: { message: 'Row not found', code: 'PGRST116' },
          };
        }
        if (rows.length > 1) {
          return {
            data: null,
            error: {
              message: 'Multiple rows returned for single()',
              code: 'PGRST116',
            },
          };
        }
        return { data: rows[0] as unknown, error: null, count };
      }

      if (this.maybeSingleRow) {
        if (rows.length > 1) {
          return {
            data: null,
            error: {
              message: 'Multiple rows returned for maybeSingle()',
              code: 'PGRST116',
            },
          };
        }
        return {
          data: rows.length === 1 ? (rows[0] as unknown) : null,
          error: null,
          count,
        };
      }

      return { data: rows as unknown, error: null, count };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    } finally {
      if (client) client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// PostgREST filter string parser (shared with other providers)
// ---------------------------------------------------------------------------

interface ParsedFilterClause {
  column: string;
  operator: string;
  value: string;
}

function parseFilterClause(raw: string): ParsedFilterClause | null {
  const firstDot = raw.indexOf('.');
  if (firstDot === -1) return null;
  const column = raw.substring(0, firstDot);
  const rest = raw.substring(firstDot + 1);
  const secondDot = rest.indexOf('.');
  if (secondDot === -1) return null;
  const operator = rest.substring(0, secondDot);
  const value = rest.substring(secondDot + 1);
  return { column, operator, value };
}
