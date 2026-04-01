import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mssql from 'mssql';
import {
  DatabaseService,
  QueryBuilder,
  QueryResult,
} from './database.interface';

/**
 * SQL Server implementation of DatabaseService.
 *
 * Translates the chainable QueryBuilder API into T-SQL queries
 * executed against a SQL Server instance via the mssql driver.
 *
 * Schema mapping: PostgreSQL schemas → SQL Server schemas.
 * JSON columns: PostgreSQL JSONB → SQL Server NVARCHAR(MAX) with JSON functions.
 */
@Injectable()
export class SqlServerDatabaseService implements DatabaseService {
  private readonly logger = new Logger(SqlServerDatabaseService.name);
  private pool: mssql.ConnectionPool | null = null;

  constructor(private readonly configService: ConfigService) {}

  from(schema: string | null, table: string): QueryBuilder {
    return new SqlServerQueryBuilder(() => this.getPool(), schema, table);
  }

  async rpc(
    functionName: string,
    args?: Record<string, unknown>,
    schema?: string | null,
  ): Promise<QueryResult> {
    const pool = await this.getPool();
    const request = pool.request();

    const qualifiedName = schema
      ? `[${schema}].[${functionName}]`
      : `[dbo].[${functionName}]`;

    if (args) {
      for (const [key, value] of Object.entries(args)) {
        if (value === null || value === undefined) {
          request.input(key, null);
        } else if (typeof value === 'number') {
          if (Number.isInteger(value)) {
            request.input(key, mssql.BigInt, value);
          } else {
            request.input(key, mssql.Float, value);
          }
        } else if (typeof value === 'boolean') {
          request.input(key, mssql.Bit, value);
        } else if (typeof value === 'string') {
          request.input(key, mssql.NVarChar(mssql.MAX), value);
        } else if (value instanceof Date) {
          request.input(key, mssql.DateTime2, value);
        } else {
          request.input(key, mssql.NVarChar(mssql.MAX), JSON.stringify(value));
        }
      }
    }

    try {
      const result = await request.execute(qualifiedName);
      return {
        data: result.recordset ?? null,
        error: null,
        count: result.recordset?.length ?? null,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    }
  }

  async checkConnection(): Promise<{ status: string; message: string }> {
    try {
      const pool = await this.getPool();
      await pool.request().query('SELECT 1 AS ok');
      return { status: 'ok', message: 'SQL Server connection healthy' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'error', message };
    }
  }

  async rawQuery(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      const pool = await this.getPool();
      const request = pool.request();
      if (params) {
        for (let i = 0; i < params.length; i++) {
          const value = params[i];
          if (value === null || value === undefined) {
            request.input(`p${i}`, null);
          } else if (typeof value === 'number') {
            if (Number.isInteger(value)) {
              request.input(`p${i}`, mssql.BigInt, value);
            } else {
              request.input(`p${i}`, mssql.Float, value);
            }
          } else if (typeof value === 'boolean') {
            request.input(`p${i}`, mssql.Bit, value);
          } else if (typeof value === 'string') {
            request.input(`p${i}`, mssql.NVarChar(mssql.MAX), value);
          } else if (value instanceof Date) {
            request.input(`p${i}`, mssql.DateTime2, value);
          } else {
            request.input(
              `p${i}`,
              mssql.NVarChar(mssql.MAX),
              JSON.stringify(value),
            );
          }
        }
      }
      // Replace $1, $2, ... PostgreSQL-style params with @p0, @p1, ...
      const adaptedSql = sql.replace(
        /\$(\d+)/g,
        (_match: string, num: string) => `@p${parseInt(num, 10) - 1}`,
      );
      const result = await request.query(adaptedSql);
      return {
        data: result.recordset ?? [],
        error: null,
        count: result.recordset?.length ?? null,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    }
  }

  getConfig() {
    const host = this.configService.getOrThrow<string>('SQLSERVER_HOST');
    const database =
      this.configService.getOrThrow<string>('SQLSERVER_DATABASE');
    return {
      provider: 'sqlserver',
      url: `sqlserver://${host}/${database}`,
      schemas: ['dbo', 'authz', 'orch_flow', 'prediction', 'risk', 'crawler'],
      clientsAvailable: { service: true, anon: false },
    };
  }

  private async getPool(): Promise<mssql.ConnectionPool> {
    if (this.pool?.connected) {
      return this.pool;
    }

    const host = this.configService.getOrThrow<string>('SQLSERVER_HOST');
    const port = parseInt(
      this.configService.getOrThrow<string>('SQLSERVER_PORT'),
      10,
    );
    const database =
      this.configService.getOrThrow<string>('SQLSERVER_DATABASE');
    const user = this.configService.getOrThrow<string>('SQLSERVER_USER');
    const password =
      this.configService.getOrThrow<string>('SQLSERVER_PASSWORD');
    const encrypt =
      this.configService.get<string>('SQLSERVER_ENCRYPT', 'true') === 'true';
    const trustServerCertificate =
      this.configService.get<string>('SQLSERVER_TRUST_SERVER_CERT', 'false') ===
      'true';

    this.pool = await new mssql.ConnectionPool({
      server: host,
      port,
      database,
      user,
      password,
      connectionTimeout: 10000,
      requestTimeout: 30000,
      pool: { min: 2, max: 10, idleTimeoutMillis: 30000 },
      options: { encrypt, trustServerCertificate },
    }).connect();

    return this.pool;
  }
}

// ---------------------------------------------------------------------------
// PostgREST filter‑string operators used inside .or()
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

// ---------------------------------------------------------------------------
// SqlServerQueryBuilder
// ---------------------------------------------------------------------------

class SqlServerQueryBuilder implements QueryBuilder {
  private readonly getPool: () => Promise<mssql.ConnectionPool>;
  private readonly schemaName: string;
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
  private upsertCountMode: 'exact' | 'planned' | 'estimated' | null = null;
  private deleteCountMode: 'exact' | 'planned' | 'estimated' | null = null;

  private conditions: string[] = [];
  private paramMap = new Map<string, unknown>();
  private paramCounter = 0;

  private orderClauses: string[] = [];
  private limitCount: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private singleRow = false;
  private maybeSingleRow = false;

  constructor(
    poolFn: () => Promise<mssql.ConnectionPool>,
    schema: string | null,
    table: string,
  ) {
    this.getPool = poolFn;
    this.schemaName = schema ?? 'dbo';
    this.tableName = table;
  }

  private qualifiedTable(): string {
    return `[${this.schemaName}].[${this.tableName}]`;
  }

  private nextParam(value: unknown): string {
    const name = `p${this.paramCounter++}`;
    this.paramMap.set(name, value);
    return `@${name}`;
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
      // Called after insert/update/delete/upsert → set returning columns
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
    this.upsertCountMode = options?.count ?? null;
    return this;
  }

  delete(options?: {
    count?: 'exact' | 'planned' | 'estimated';
  }): QueryBuilder {
    this.operation = 'delete';
    this.deleteCountMode = options?.count ?? null;
    return this;
  }

  // ---- Filters ----

  eq(column: string, value: unknown): QueryBuilder {
    if (value === null) {
      this.conditions.push(`[${column}] IS NULL`);
    } else {
      const p = this.nextParam(value);
      this.conditions.push(`[${column}] = ${p}`);
    }
    return this;
  }

  neq(column: string, value: unknown): QueryBuilder {
    if (value === null) {
      this.conditions.push(`[${column}] IS NOT NULL`);
    } else {
      const p = this.nextParam(value);
      this.conditions.push(`[${column}] <> ${p}`);
    }
    return this;
  }

  gt(column: string, value: unknown): QueryBuilder {
    const p = this.nextParam(value);
    this.conditions.push(`[${column}] > ${p}`);
    return this;
  }

  gte(column: string, value: unknown): QueryBuilder {
    const p = this.nextParam(value);
    this.conditions.push(`[${column}] >= ${p}`);
    return this;
  }

  lt(column: string, value: unknown): QueryBuilder {
    const p = this.nextParam(value);
    this.conditions.push(`[${column}] < ${p}`);
    return this;
  }

  lte(column: string, value: unknown): QueryBuilder {
    const p = this.nextParam(value);
    this.conditions.push(`[${column}] <= ${p}`);
    return this;
  }

  in(column: string, values: unknown[]): QueryBuilder {
    if (values.length === 0) {
      this.conditions.push('1 = 0'); // Empty IN → always false
      return this;
    }
    const params = values.map((v) => this.nextParam(v));
    this.conditions.push(`[${column}] IN (${params.join(', ')})`);
    return this;
  }

  is(column: string, value: null | boolean): QueryBuilder {
    if (value === null) {
      this.conditions.push(`[${column}] IS NULL`);
    } else {
      this.conditions.push(`[${column}] = ${value ? 1 : 0}`);
    }
    return this;
  }

  not(column: string, operator: string, value: unknown): QueryBuilder {
    switch (operator) {
      case 'is':
        if (value === null) {
          this.conditions.push(`[${column}] IS NOT NULL`);
        } else {
          this.conditions.push(`[${column}] <> ${(value as boolean) ? 1 : 0}`);
        }
        break;
      case 'eq': {
        const p = this.nextParam(value);
        this.conditions.push(`NOT ([${column}] = ${p})`);
        break;
      }
      case 'in': {
        const vals = value as unknown[];
        if (vals.length === 0) break;
        const params = vals.map((v) => this.nextParam(v));
        this.conditions.push(`[${column}] NOT IN (${params.join(', ')})`);
        break;
      }
      case 'cs': {
        // Negate containment — value is array or object
        const cond = this.buildContainsCondition(column, value);
        this.conditions.push(`NOT (${cond})`);
        break;
      }
      default: {
        const p = this.nextParam(value);
        this.conditions.push(
          `NOT ([${column}] ${this.sqlOperator(operator)} ${p})`,
        );
        break;
      }
    }
    return this;
  }

  contains(column: string, value: unknown): QueryBuilder {
    const cond = this.buildContainsCondition(column, value);
    this.conditions.push(cond);
    return this;
  }

  overlaps(column: string, value: unknown[]): QueryBuilder {
    // Array overlap: check if any element in column's JSON array matches any in value
    const p = this.nextParam(JSON.stringify(value));
    this.conditions.push(
      `EXISTS (SELECT 1 FROM OPENJSON([${column}]) AS a ` +
        `INNER JOIN OPENJSON(${p}) AS b ON a.[value] = b.[value])`,
    );
    return this;
  }

  ilike(column: string, pattern: string): QueryBuilder {
    // SQL Server LIKE is case-insensitive with most collations
    const p = this.nextParam(pattern);
    this.conditions.push(`[${column}] LIKE ${p}`);
    return this;
  }

  like(column: string, pattern: string): QueryBuilder {
    const p = this.nextParam(pattern);
    this.conditions.push(`[${column}] LIKE ${p}`);
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
      case 'cd': {
        // containedBy — value contains column's data
        const p = this.nextParam(
          typeof value === 'string' ? value : JSON.stringify(value),
        );
        this.conditions.push(
          `EXISTS (SELECT 1 FROM OPENJSON([${column}]) AS a ` +
            `WHERE a.[value] IN (SELECT [value] FROM OPENJSON(${p})))`,
        );
        return this;
      }
      default: {
        const p = this.nextParam(value);
        this.conditions.push(`[${column}] ${this.sqlOperator(operator)} ${p}`);
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
    const p = this.nextParam(query);
    if (options?.type === 'phrase') {
      this.conditions.push(`CONTAINS([${column}], ${p})`);
    } else {
      this.conditions.push(`FREETEXT([${column}], ${p})`);
    }
    return this;
  }

  // ---- Modifiers ----

  order(column: string, options?: { ascending?: boolean }): QueryBuilder {
    const dir = options?.ascending === false ? 'DESC' : 'ASC';
    this.orderClauses.push(`[${column}] ${dir}`);
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

  // ---- Internal helpers ----

  private buildContainsCondition(column: string, value: unknown): string {
    if (Array.isArray(value)) {
      // Array containment: check each element exists in the JSON array column
      if (value.length === 0) return '1 = 1';
      const parts = value.map((item) => {
        const p = this.nextParam(
          typeof item === 'object' ? JSON.stringify(item) : String(item),
        );
        return `EXISTS (SELECT 1 FROM OPENJSON([${column}]) WHERE [value] = ${p})`;
      });
      return parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`;
    }

    if (typeof value === 'object' && value !== null) {
      // Object containment: check each key-value pair
      const entries = Object.entries(value as Record<string, unknown>);
      const parts = entries.map(([key, val]) => {
        const p = this.nextParam(
          typeof val === 'object' && val !== null
            ? JSON.stringify(val)
            : val === true
              ? 'true'
              : val === false
                ? 'false'
                : String(val),
        );
        return `JSON_VALUE([${column}], '$.${key}') = ${p}`;
      });
      return parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`;
    }

    // Scalar containment
    const p = this.nextParam(String(value));
    return `[${column}] = ${p}`;
  }

  private filterClauseToSql(parsed: ParsedFilterClause): string | null {
    const { column, operator, value } = parsed;
    switch (operator) {
      case 'eq':
        if (value === 'true') return `[${column}] = 1`;
        if (value === 'false') return `[${column}] = 0`;
        if (value === 'null') return `[${column}] IS NULL`;
        return `[${column}] = ${this.nextParam(value)}`;
      case 'neq':
        return `[${column}] <> ${this.nextParam(value)}`;
      case 'gt':
        return `[${column}] > ${this.nextParam(value)}`;
      case 'gte':
        return `[${column}] >= ${this.nextParam(value)}`;
      case 'lt':
        return `[${column}] < ${this.nextParam(value)}`;
      case 'lte':
        return `[${column}] <= ${this.nextParam(value)}`;
      case 'is':
        if (value === 'null') return `[${column}] IS NULL`;
        if (value === 'true') return `[${column}] = 1`;
        if (value === 'false') return `[${column}] = 0`;
        return null;
      case 'like':
        return `[${column}] LIKE ${this.nextParam(value)}`;
      case 'ilike':
        return `[${column}] LIKE ${this.nextParam(value)}`;
      default:
        return null;
    }
  }

  private sqlOperator(op: string): string {
    const map: Record<string, string> = {
      eq: '=',
      neq: '<>',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
      like: 'LIKE',
      ilike: 'LIKE',
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
      // Just return the count
      return `SELECT COUNT(*) AS [__count] FROM ${table}${where}`;
    }

    const countCol = this.countMode
      ? ', COUNT(*) OVER() AS [__total_count]'
      : '';

    // Determine pagination strategy
    const hasOrder = this.orderClauses.length > 0;
    const hasRange = this.rangeFrom !== null && this.rangeTo !== null;
    const hasLimit = this.limitCount !== null;

    if (hasRange) {
      const orderBy = hasOrder
        ? ` ORDER BY ${this.orderClauses.join(', ')}`
        : ' ORDER BY (SELECT NULL)';
      const offset = this.rangeFrom!;
      const fetch = this.rangeTo! - this.rangeFrom! + 1;
      return (
        `SELECT ${cols}${countCol} FROM ${table}${where}` +
        `${orderBy} OFFSET ${offset} ROWS FETCH NEXT ${fetch} ROWS ONLY`
      );
    }

    if (hasLimit && hasOrder) {
      const orderBy = ` ORDER BY ${this.orderClauses.join(', ')}`;
      return (
        `SELECT ${cols}${countCol} FROM ${table}${where}` +
        `${orderBy} OFFSET 0 ROWS FETCH NEXT ${this.limitCount} ROWS ONLY`
      );
    }

    if (hasLimit && !hasOrder) {
      return `SELECT TOP ${this.limitCount} ${cols}${countCol} FROM ${table}${where}`;
    }

    if (hasOrder) {
      const orderBy = ` ORDER BY ${this.orderClauses.join(', ')}`;
      return `SELECT ${cols}${countCol} FROM ${table}${where}${orderBy}`;
    }

    return `SELECT ${cols}${countCol} FROM ${table}${where}`;
  }

  private buildInsert(): string {
    const table = this.qualifiedTable();
    const rows = Array.isArray(this.insertData)
      ? this.insertData
      : [this.insertData!];

    const columns = Object.keys(rows[0]!);
    const colList = columns.map((c) => `[${c}]`).join(', ');
    const output = this.returning ? ' OUTPUT inserted.*' : '';

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

    return `INSERT INTO ${table} (${colList})${output} VALUES ${valueRows.join(', ')}`;
  }

  private buildUpdate(): string {
    const table = this.qualifiedTable();
    const where = this.whereClause();
    const output = this.returning ? ' OUTPUT inserted.*' : '';

    const sets = Object.entries(this.updateData!).map(([col, val]) => {
      const p = this.nextParam(
        typeof val === 'object' && val !== null && !(val instanceof Date)
          ? JSON.stringify(val)
          : val,
      );
      return `[${col}] = ${p}`;
    });

    return `UPDATE ${table} SET ${sets.join(', ')}${output}${where}`;
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

    const output = this.returning ? ' OUTPUT inserted.*' : '';
    const statements: string[] = [];

    for (const row of rows) {
      const sourceSelect = columns
        .map((c) => {
          const v = row[c];
          const p = this.nextParam(
            typeof v === 'object' && v !== null && !(v instanceof Date)
              ? JSON.stringify(v)
              : v,
          );
          return `${p} AS [${c}]`;
        })
        .join(', ');

      const onClause = conflictCols
        .map((c) => `target.[${c}] = source.[${c}]`)
        .join(' AND ');

      const nonConflictCols = columns.filter((c) => !conflictCols.includes(c));

      const updateSet = nonConflictCols
        .map((c) => `target.[${c}] = source.[${c}]`)
        .join(', ');

      const insertCols = columns.map((c) => `[${c}]`).join(', ');
      const insertVals = columns.map((c) => `source.[${c}]`).join(', ');

      let sql = `MERGE ${table} AS target USING (SELECT ${sourceSelect}) AS source ON ${onClause}`;

      if (!this.upsertIgnoreDuplicates && nonConflictCols.length > 0) {
        sql += ` WHEN MATCHED THEN UPDATE SET ${updateSet}`;
      }

      sql += ` WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
      sql += `${output};`;

      statements.push(sql);
    }

    return statements.join('\n');
  }

  private buildDelete(): string {
    const table = this.qualifiedTable();
    const where = this.whereClause();
    const output = this.returning ? ' OUTPUT deleted.*' : '';
    return `DELETE FROM ${table}${output}${where}`;
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
    try {
      const pool = await this.getPool();
      const request = pool.request();

      // Build SQL first — buildSql() populates paramMap via nextParam()
      const sql = this.buildSql();

      // Bind parameters after SQL generation so all params are registered
      for (const [name, value] of this.paramMap) {
        if (value === null || value === undefined) {
          request.input(name, null);
        } else if (typeof value === 'number') {
          if (Number.isInteger(value)) {
            request.input(name, mssql.BigInt, value);
          } else {
            request.input(name, mssql.Float, value);
          }
        } else if (typeof value === 'boolean') {
          request.input(name, mssql.Bit, value);
        } else if (typeof value === 'string') {
          request.input(name, mssql.NVarChar(mssql.MAX), value);
        } else if (value instanceof Date) {
          request.input(name, mssql.DateTime2, value);
        } else {
          // Objects/arrays → JSON string
          request.input(name, mssql.NVarChar(mssql.MAX), JSON.stringify(value));
        }
      }

      const result = await request.query(sql);
      const recordset: Record<string, unknown>[] = result.recordset ?? [];

      // Auto-parse JSON strings in NVARCHAR(MAX) columns.
      // PostgreSQL returns arrays/JSONB as native JS types; SQL Server stores
      // them as NVARCHAR(MAX) strings. Parse them back so the rest of the
      // codebase sees the same types regardless of provider.
      for (const row of recordset) {
        for (const [key, val] of Object.entries(row)) {
          if (typeof val === 'string' && val.length > 0) {
            const ch = val[0];
            if (ch === '[' || ch === '{') {
              try {
                row[key] = JSON.parse(val);
              } catch {
                // Not valid JSON — leave as string
              }
            }
          }
        }
      }

      // Handle head-only (count) queries
      if (this.headOnly) {
        const countVal = (recordset[0] as Record<string, unknown> | undefined)
          ?.__count;
        return {
          data: null,
          error: null,
          count: typeof countVal === 'number' ? countVal : null,
        };
      }

      // Extract __total_count if present
      let count: number | null = null;
      if (this.countMode && recordset.length > 0) {
        const firstRow = recordset[0] as Record<string, unknown>;
        count =
          typeof firstRow.__total_count === 'number'
            ? firstRow.__total_count
            : null;
        // Strip __total_count from returned data
        for (const row of recordset) {
          delete row.__total_count;
        }
      }

      // Handle single/maybeSingle
      if (this.singleRow) {
        if (recordset.length === 0) {
          return {
            data: null,
            error: {
              message: 'Row not found',
              code: 'PGRST116',
            },
          };
        }
        if (recordset.length > 1) {
          return {
            data: null,
            error: {
              message: 'Multiple rows returned for single()',
              code: 'PGRST116',
            },
          };
        }
        return { data: recordset[0] as unknown, error: null, count };
      }

      if (this.maybeSingleRow) {
        if (recordset.length > 1) {
          return {
            data: null,
            error: {
              message: 'Multiple rows returned for maybeSingle()',
              code: 'PGRST116',
            },
          };
        }
        return {
          data: recordset.length === 1 ? (recordset[0] as unknown) : null,
          error: null,
          count,
        };
      }

      // Default: return the full result set
      return {
        data: recordset as unknown,
        error: null,
        count,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    }
  }
}
