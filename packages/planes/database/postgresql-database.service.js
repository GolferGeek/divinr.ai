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
var PostgresqlDatabaseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresqlDatabaseService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const pg_1 = require("pg");
/**
 * PostgreSQL implementation of DatabaseService.
 *
 * Translates the chainable QueryBuilder API into standard SQL queries
 * executed against a PostgreSQL instance via the pg driver.
 *
 * Schema mapping: schema is passed as part of the qualified table name.
 */
let PostgresqlDatabaseService = PostgresqlDatabaseService_1 = class PostgresqlDatabaseService {
    configService;
    logger = new common_1.Logger(PostgresqlDatabaseService_1.name);
    pool = null;
    constructor(configService) {
        this.configService = configService;
    }
    from(schema, table) {
        return new PostgresQueryBuilder(() => this.getPool(), schema, table);
    }
    async rpc(functionName, args, schema) {
        const pool = await this.getPool();
        const qualifiedName = schema
            ? `"${schema}"."${functionName}"`
            : `"${functionName}"`;
        const params = [];
        let argList = '';
        if (args) {
            const entries = Object.entries(args);
            argList = entries.map((_, i) => `$${i + 1}`).join(', ');
            params.push(...entries.map(([, v]) => v));
        }
        try {
            const result = await pool.query(`SELECT * FROM ${qualifiedName}(${argList})`, params);
            return {
                data: result.rows,
                error: null,
                count: result.rowCount ?? null,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { data: null, error: { message } };
        }
    }
    async checkConnection() {
        try {
            const pool = await this.getPool();
            await pool.query('SELECT 1 AS ok');
            return { status: 'ok', message: 'PostgreSQL connection healthy' };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { status: 'error', message };
        }
    }
    async rawQuery(sql, params) {
        try {
            const pool = await this.getPool();
            const result = await pool.query(sql, params ?? []);
            return { data: result.rows, error: null, count: result.rowCount ?? null };
        }
        catch (err) {
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
    resolveConnectionString() {
        const explicit = this.configService.get('POSTGRESQL_URL');
        if (explicit)
            return explicit;
        const host = this.configService.getOrThrow('PG_HOST');
        const port = this.configService.get('PG_PORT') ?? '5432';
        const database = this.configService.getOrThrow('PG_DATABASE');
        const user = this.configService.getOrThrow('PG_USER');
        const password = this.configService.getOrThrow('PG_PASSWORD');
        return `postgresql://${user}:${password}@${host}:${port}/${database}`;
    }
    getPool() {
        if (this.pool) {
            return Promise.resolve(this.pool);
        }
        const connectionString = this.resolveConnectionString();
        this.pool = new pg_1.Pool({
            connectionString,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });
        return Promise.resolve(this.pool);
    }
};
exports.PostgresqlDatabaseService = PostgresqlDatabaseService;
exports.PostgresqlDatabaseService = PostgresqlDatabaseService = PostgresqlDatabaseService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PostgresqlDatabaseService);
// ---------------------------------------------------------------------------
// PostgresQueryBuilder
// ---------------------------------------------------------------------------
class PostgresQueryBuilder {
    getPool;
    schemaName;
    tableName;
    operation = null;
    selectColumns = '*';
    countMode = null;
    headOnly = false;
    returning = false;
    returningColumns = '*';
    insertData = null;
    updateData = null;
    upsertData = null;
    upsertConflict = null;
    upsertIgnoreDuplicates = false;
    conditions = [];
    params = [];
    orderClauses = [];
    limitCount = null;
    rangeFrom = null;
    rangeTo = null;
    singleRow = false;
    maybeSingleRow = false;
    constructor(poolFn, schema, table) {
        this.getPool = poolFn;
        this.schemaName = schema;
        this.tableName = table;
    }
    qualifiedTable() {
        return this.schemaName
            ? `"${this.schemaName}"."${this.tableName}"`
            : `"${this.tableName}"`;
    }
    nextParam(value) {
        this.params.push(value);
        return `$${this.params.length}`;
    }
    // ---- Data operations ----
    select(columns, options) {
        if (this.operation === null) {
            this.operation = 'select';
            this.selectColumns = columns ?? '*';
        }
        else {
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
    insert(data) {
        this.operation = 'insert';
        this.insertData = data;
        return this;
    }
    update(data) {
        this.operation = 'update';
        this.updateData = data;
        return this;
    }
    upsert(data, options) {
        this.operation = 'upsert';
        this.upsertData = data;
        this.upsertConflict = options?.onConflict ?? null;
        this.upsertIgnoreDuplicates = options?.ignoreDuplicates ?? false;
        return this;
    }
    delete(_options) {
        this.operation = 'delete';
        return this;
    }
    // ---- Filters ----
    eq(column, value) {
        if (value === null) {
            this.conditions.push(`"${column}" IS NULL`);
        }
        else {
            const p = this.nextParam(value);
            this.conditions.push(`"${column}" = ${p}`);
        }
        return this;
    }
    neq(column, value) {
        if (value === null) {
            this.conditions.push(`"${column}" IS NOT NULL`);
        }
        else {
            const p = this.nextParam(value);
            this.conditions.push(`"${column}" != ${p}`);
        }
        return this;
    }
    gt(column, value) {
        const p = this.nextParam(value);
        this.conditions.push(`"${column}" > ${p}`);
        return this;
    }
    gte(column, value) {
        const p = this.nextParam(value);
        this.conditions.push(`"${column}" >= ${p}`);
        return this;
    }
    lt(column, value) {
        const p = this.nextParam(value);
        this.conditions.push(`"${column}" < ${p}`);
        return this;
    }
    lte(column, value) {
        const p = this.nextParam(value);
        this.conditions.push(`"${column}" <= ${p}`);
        return this;
    }
    in(column, values) {
        if (values.length === 0) {
            this.conditions.push('1 = 0');
            return this;
        }
        const params = values.map((v) => this.nextParam(v));
        this.conditions.push(`"${column}" IN (${params.join(', ')})`);
        return this;
    }
    is(column, value) {
        if (value === null) {
            this.conditions.push(`"${column}" IS NULL`);
        }
        else {
            const p = this.nextParam(value);
            this.conditions.push(`"${column}" IS ${p}`);
        }
        return this;
    }
    not(column, operator, value) {
        switch (operator) {
            case 'is':
                if (value === null) {
                    this.conditions.push(`"${column}" IS NOT NULL`);
                }
                else {
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
                const vals = value;
                if (vals.length === 0)
                    break;
                const params = vals.map((v) => this.nextParam(v));
                this.conditions.push(`"${column}" NOT IN (${params.join(', ')})`);
                break;
            }
            default: {
                const p = this.nextParam(value);
                this.conditions.push(`NOT ("${column}" ${this.sqlOperator(operator)} ${p})`);
                break;
            }
        }
        return this;
    }
    contains(column, value) {
        if (Array.isArray(value)) {
            const p = this.nextParam(JSON.stringify(value));
            this.conditions.push(`"${column}" @> ${p}::jsonb`);
        }
        else if (typeof value === 'object' && value !== null) {
            const p = this.nextParam(JSON.stringify(value));
            this.conditions.push(`"${column}" @> ${p}::jsonb`);
        }
        else {
            const p = this.nextParam(value);
            this.conditions.push(`"${column}" = ${p}`);
        }
        return this;
    }
    overlaps(column, value) {
        const p = this.nextParam(JSON.stringify(value));
        this.conditions.push(`"${column}" && ${p}::jsonb`);
        return this;
    }
    ilike(column, pattern) {
        const p = this.nextParam(pattern);
        this.conditions.push(`"${column}" ILIKE ${p}`);
        return this;
    }
    like(column, pattern) {
        const p = this.nextParam(pattern);
        this.conditions.push(`"${column}" LIKE ${p}`);
        return this;
    }
    or(filters) {
        const clauses = filters.split(',');
        const orParts = [];
        for (const raw of clauses) {
            const parsed = parseFilterClause(raw.trim());
            if (!parsed)
                continue;
            const sql = this.filterClauseToSql(parsed);
            if (sql)
                orParts.push(sql);
        }
        if (orParts.length > 0) {
            this.conditions.push(`(${orParts.join(' OR ')})`);
        }
        return this;
    }
    filter(column, operator, value) {
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
                return this.like(column, value);
            case 'ilike':
                return this.ilike(column, value);
            case 'is':
                return this.is(column, value);
            case 'cs':
                return this.contains(column, value);
            default: {
                const p = this.nextParam(value);
                this.conditions.push(`"${column}" ${this.sqlOperator(operator)} ${p}`);
                return this;
            }
        }
    }
    match(query) {
        for (const [col, val] of Object.entries(query)) {
            this.eq(col, val);
        }
        return this;
    }
    textSearch(column, query, options) {
        const config = options?.config ?? 'english';
        const type = options?.type ?? 'plain';
        const p = this.nextParam(query);
        const tsFunction = type === 'websearch'
            ? 'websearch_to_tsquery'
            : type === 'phrase'
                ? 'phraseto_tsquery'
                : 'plainto_tsquery';
        this.conditions.push(`to_tsvector('${config}', "${column}") @@ ${tsFunction}('${config}', ${p})`);
        return this;
    }
    // ---- Modifiers ----
    order(column, options) {
        const dir = options?.ascending === false ? 'DESC' : 'ASC';
        this.orderClauses.push(`"${column}" ${dir}`);
        return this;
    }
    limit(count) {
        this.limitCount = count;
        return this;
    }
    range(from, to) {
        this.rangeFrom = from;
        this.rangeTo = to;
        return this;
    }
    single() {
        this.singleRow = true;
        return this;
    }
    maybeSingle() {
        this.maybeSingleRow = true;
        return this;
    }
    // ---- PromiseLike ----
    then(onfulfilled, onrejected) {
        return this.execute().then(onfulfilled, onrejected);
    }
    // ---- Private helpers ----
    filterClauseToSql(parsed) {
        const { column, operator, value } = parsed;
        switch (operator) {
            case 'eq':
                if (value === 'null')
                    return `"${column}" IS NULL`;
                if (value === 'true')
                    return `"${column}" IS TRUE`;
                if (value === 'false')
                    return `"${column}" IS FALSE`;
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
                if (value === 'null')
                    return `"${column}" IS NULL`;
                if (value === 'true')
                    return `"${column}" IS TRUE`;
                if (value === 'false')
                    return `"${column}" IS FALSE`;
                return null;
            case 'like':
                return `"${column}" LIKE ${this.nextParam(value)}`;
            case 'ilike':
                return `"${column}" ILIKE ${this.nextParam(value)}`;
            default:
                return null;
        }
    }
    sqlOperator(op) {
        const map = {
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
    whereClause() {
        if (this.conditions.length === 0)
            return '';
        return ` WHERE ${this.conditions.join(' AND ')}`;
    }
    buildSelect() {
        const table = this.qualifiedTable();
        const where = this.whereClause();
        const cols = this.selectColumns;
        if (this.headOnly) {
            return `SELECT COUNT(*) AS __count FROM ${table}${where}`;
        }
        const countCol = this.countMode ? ', COUNT(*) OVER() AS __total_count' : '';
        const orderBy = this.orderClauses.length > 0
            ? ` ORDER BY ${this.orderClauses.join(', ')}`
            : '';
        let pagination = '';
        if (this.rangeFrom !== null && this.rangeTo !== null) {
            pagination = ` OFFSET ${this.rangeFrom} LIMIT ${this.rangeTo - this.rangeFrom + 1}`;
        }
        else if (this.limitCount !== null) {
            pagination = ` LIMIT ${this.limitCount}`;
        }
        return `SELECT ${cols}${countCol} FROM ${table}${where}${orderBy}${pagination}`;
    }
    buildInsert() {
        const table = this.qualifiedTable();
        const rows = Array.isArray(this.insertData)
            ? this.insertData
            : [this.insertData];
        const columns = Object.keys(rows[0]);
        const colList = columns.map((c) => `"${c}"`).join(', ');
        const returning = this.returning
            ? ` RETURNING ${this.returningColumns}`
            : '';
        const valueRows = rows.map((row) => {
            const vals = columns.map((c) => {
                const v = row[c];
                return this.nextParam(typeof v === 'object' && v !== null && !(v instanceof Date)
                    ? JSON.stringify(v)
                    : v);
            });
            return `(${vals.join(', ')})`;
        });
        return `INSERT INTO ${table} (${colList}) VALUES ${valueRows.join(', ')}${returning}`;
    }
    buildUpdate() {
        const table = this.qualifiedTable();
        const where = this.whereClause();
        const returning = this.returning
            ? ` RETURNING ${this.returningColumns}`
            : '';
        const sets = Object.entries(this.updateData).map(([col, val]) => {
            const p = this.nextParam(typeof val === 'object' && val !== null && !(val instanceof Date)
                ? JSON.stringify(val)
                : val);
            return `"${col}" = ${p}`;
        });
        return `UPDATE ${table} SET ${sets.join(', ')}${where}${returning}`;
    }
    buildUpsert() {
        const table = this.qualifiedTable();
        const rows = Array.isArray(this.upsertData)
            ? this.upsertData
            : [this.upsertData];
        const columns = Object.keys(rows[0]);
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
                return this.nextParam(typeof v === 'object' && v !== null && !(v instanceof Date)
                    ? JSON.stringify(v)
                    : v);
            });
            return `(${vals.join(', ')})`;
        });
        const conflictTarget = `(${conflictCols.map((c) => `"${c}"`).join(', ')})`;
        if (this.upsertIgnoreDuplicates) {
            return (`INSERT INTO ${table} (${colList}) VALUES ${valueRows.join(', ')} ` +
                `ON CONFLICT ${conflictTarget} DO NOTHING${returning}`);
        }
        const nonConflictCols = columns.filter((c) => !conflictCols.includes(c));
        const updateSet = nonConflictCols
            .map((c) => `"${c}" = EXCLUDED."${c}"`)
            .join(', ');
        return (`INSERT INTO ${table} (${colList}) VALUES ${valueRows.join(', ')} ` +
            `ON CONFLICT ${conflictTarget} DO UPDATE SET ${updateSet}${returning}`);
    }
    buildDelete() {
        const table = this.qualifiedTable();
        const where = this.whereClause();
        const returning = this.returning
            ? ` RETURNING ${this.returningColumns}`
            : '';
        return `DELETE FROM ${table}${where}${returning}`;
    }
    buildSql() {
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
                throw new Error('No operation specified. Call select(), insert(), update(), upsert(), or delete() before executing.');
        }
    }
    async execute() {
        let client = null;
        try {
            const pool = await this.getPool();
            const sql = this.buildSql();
            client = await pool.connect();
            const result = await client.query(sql, this.params);
            const rows = result.rows;
            if (this.headOnly) {
                const countVal = rows[0]?.__count;
                return {
                    data: null,
                    error: null,
                    count: countVal !== undefined
                        ? parseInt(`${countVal}`, 10)
                        : null,
                };
            }
            let count = null;
            if (this.countMode && rows.length > 0) {
                const firstRow = rows[0];
                count =
                    firstRow?.__total_count !== undefined
                        ? parseInt(`${firstRow.__total_count}`, 10)
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
                return { data: rows[0], error: null, count };
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
                    data: rows.length === 1 ? rows[0] : null,
                    error: null,
                    count,
                };
            }
            return { data: rows, error: null, count };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { data: null, error: { message } };
        }
        finally {
            if (client)
                client.release();
        }
    }
}
function parseFilterClause(raw) {
    const firstDot = raw.indexOf('.');
    if (firstDot === -1)
        return null;
    const column = raw.substring(0, firstDot);
    const rest = raw.substring(firstDot + 1);
    const secondDot = rest.indexOf('.');
    if (secondDot === -1)
        return null;
    const operator = rest.substring(0, secondDot);
    const value = rest.substring(secondDot + 1);
    return { column, operator, value };
}
