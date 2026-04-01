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
var SqlServerDatabaseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqlServerDatabaseService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mssql = __importStar(require("mssql"));
/**
 * SQL Server implementation of DatabaseService.
 *
 * Translates the chainable QueryBuilder API into T-SQL queries
 * executed against a SQL Server instance via the mssql driver.
 *
 * Schema mapping: PostgreSQL schemas → SQL Server schemas.
 * JSON columns: PostgreSQL JSONB → SQL Server NVARCHAR(MAX) with JSON functions.
 */
let SqlServerDatabaseService = SqlServerDatabaseService_1 = class SqlServerDatabaseService {
    configService;
    logger = new common_1.Logger(SqlServerDatabaseService_1.name);
    pool = null;
    constructor(configService) {
        this.configService = configService;
    }
    from(schema, table) {
        return new SqlServerQueryBuilder(() => this.getPool(), schema, table);
    }
    async rpc(functionName, args, schema) {
        const pool = await this.getPool();
        const request = pool.request();
        const qualifiedName = schema
            ? `[${schema}].[${functionName}]`
            : `[dbo].[${functionName}]`;
        if (args) {
            for (const [key, value] of Object.entries(args)) {
                if (value === null || value === undefined) {
                    request.input(key, null);
                }
                else if (typeof value === 'number') {
                    if (Number.isInteger(value)) {
                        request.input(key, mssql.BigInt, value);
                    }
                    else {
                        request.input(key, mssql.Float, value);
                    }
                }
                else if (typeof value === 'boolean') {
                    request.input(key, mssql.Bit, value);
                }
                else if (typeof value === 'string') {
                    request.input(key, mssql.NVarChar(mssql.MAX), value);
                }
                else if (value instanceof Date) {
                    request.input(key, mssql.DateTime2, value);
                }
                else {
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { data: null, error: { message } };
        }
    }
    async checkConnection() {
        try {
            const pool = await this.getPool();
            await pool.request().query('SELECT 1 AS ok');
            return { status: 'ok', message: 'SQL Server connection healthy' };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { status: 'error', message };
        }
    }
    async rawQuery(sql, params) {
        try {
            const pool = await this.getPool();
            const request = pool.request();
            if (params) {
                for (let i = 0; i < params.length; i++) {
                    const value = params[i];
                    if (value === null || value === undefined) {
                        request.input(`p${i}`, null);
                    }
                    else if (typeof value === 'number') {
                        if (Number.isInteger(value)) {
                            request.input(`p${i}`, mssql.BigInt, value);
                        }
                        else {
                            request.input(`p${i}`, mssql.Float, value);
                        }
                    }
                    else if (typeof value === 'boolean') {
                        request.input(`p${i}`, mssql.Bit, value);
                    }
                    else if (typeof value === 'string') {
                        request.input(`p${i}`, mssql.NVarChar(mssql.MAX), value);
                    }
                    else if (value instanceof Date) {
                        request.input(`p${i}`, mssql.DateTime2, value);
                    }
                    else {
                        request.input(`p${i}`, mssql.NVarChar(mssql.MAX), JSON.stringify(value));
                    }
                }
            }
            // Replace $1, $2, ... PostgreSQL-style params with @p0, @p1, ...
            const adaptedSql = sql.replace(/\$(\d+)/g, (_match, num) => `@p${parseInt(num, 10) - 1}`);
            const result = await request.query(adaptedSql);
            return {
                data: result.recordset ?? [],
                error: null,
                count: result.recordset?.length ?? null,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { data: null, error: { message } };
        }
    }
    getConfig() {
        const host = this.configService.getOrThrow('SQLSERVER_HOST');
        const database = this.configService.getOrThrow('SQLSERVER_DATABASE');
        return {
            provider: 'sqlserver',
            url: `sqlserver://${host}/${database}`,
            schemas: ['dbo', 'authz', 'orch_flow', 'prediction', 'risk', 'crawler'],
            clientsAvailable: { service: true, anon: false },
        };
    }
    async getPool() {
        if (this.pool?.connected) {
            return this.pool;
        }
        const host = this.configService.getOrThrow('SQLSERVER_HOST');
        const port = parseInt(this.configService.getOrThrow('SQLSERVER_PORT'), 10);
        const database = this.configService.getOrThrow('SQLSERVER_DATABASE');
        const user = this.configService.getOrThrow('SQLSERVER_USER');
        const password = this.configService.getOrThrow('SQLSERVER_PASSWORD');
        const encrypt = this.configService.get('SQLSERVER_ENCRYPT', 'true') === 'true';
        const trustServerCertificate = this.configService.get('SQLSERVER_TRUST_SERVER_CERT', 'false') ===
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
};
exports.SqlServerDatabaseService = SqlServerDatabaseService;
exports.SqlServerDatabaseService = SqlServerDatabaseService = SqlServerDatabaseService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SqlServerDatabaseService);
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
// ---------------------------------------------------------------------------
// SqlServerQueryBuilder
// ---------------------------------------------------------------------------
class SqlServerQueryBuilder {
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
    upsertCountMode = null;
    deleteCountMode = null;
    conditions = [];
    paramMap = new Map();
    paramCounter = 0;
    orderClauses = [];
    limitCount = null;
    rangeFrom = null;
    rangeTo = null;
    singleRow = false;
    maybeSingleRow = false;
    constructor(poolFn, schema, table) {
        this.getPool = poolFn;
        this.schemaName = schema ?? 'dbo';
        this.tableName = table;
    }
    qualifiedTable() {
        return `[${this.schemaName}].[${this.tableName}]`;
    }
    nextParam(value) {
        const name = `p${this.paramCounter++}`;
        this.paramMap.set(name, value);
        return `@${name}`;
    }
    // ---- Data operations ----
    select(columns, options) {
        if (this.operation === null) {
            this.operation = 'select';
            this.selectColumns = columns ?? '*';
        }
        else {
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
        this.upsertCountMode = options?.count ?? null;
        return this;
    }
    delete(options) {
        this.operation = 'delete';
        this.deleteCountMode = options?.count ?? null;
        return this;
    }
    // ---- Filters ----
    eq(column, value) {
        if (value === null) {
            this.conditions.push(`[${column}] IS NULL`);
        }
        else {
            const p = this.nextParam(value);
            this.conditions.push(`[${column}] = ${p}`);
        }
        return this;
    }
    neq(column, value) {
        if (value === null) {
            this.conditions.push(`[${column}] IS NOT NULL`);
        }
        else {
            const p = this.nextParam(value);
            this.conditions.push(`[${column}] <> ${p}`);
        }
        return this;
    }
    gt(column, value) {
        const p = this.nextParam(value);
        this.conditions.push(`[${column}] > ${p}`);
        return this;
    }
    gte(column, value) {
        const p = this.nextParam(value);
        this.conditions.push(`[${column}] >= ${p}`);
        return this;
    }
    lt(column, value) {
        const p = this.nextParam(value);
        this.conditions.push(`[${column}] < ${p}`);
        return this;
    }
    lte(column, value) {
        const p = this.nextParam(value);
        this.conditions.push(`[${column}] <= ${p}`);
        return this;
    }
    in(column, values) {
        if (values.length === 0) {
            this.conditions.push('1 = 0'); // Empty IN → always false
            return this;
        }
        const params = values.map((v) => this.nextParam(v));
        this.conditions.push(`[${column}] IN (${params.join(', ')})`);
        return this;
    }
    is(column, value) {
        if (value === null) {
            this.conditions.push(`[${column}] IS NULL`);
        }
        else {
            this.conditions.push(`[${column}] = ${value ? 1 : 0}`);
        }
        return this;
    }
    not(column, operator, value) {
        switch (operator) {
            case 'is':
                if (value === null) {
                    this.conditions.push(`[${column}] IS NOT NULL`);
                }
                else {
                    this.conditions.push(`[${column}] <> ${value ? 1 : 0}`);
                }
                break;
            case 'eq': {
                const p = this.nextParam(value);
                this.conditions.push(`NOT ([${column}] = ${p})`);
                break;
            }
            case 'in': {
                const vals = value;
                if (vals.length === 0)
                    break;
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
                this.conditions.push(`NOT ([${column}] ${this.sqlOperator(operator)} ${p})`);
                break;
            }
        }
        return this;
    }
    contains(column, value) {
        const cond = this.buildContainsCondition(column, value);
        this.conditions.push(cond);
        return this;
    }
    overlaps(column, value) {
        // Array overlap: check if any element in column's JSON array matches any in value
        const p = this.nextParam(JSON.stringify(value));
        this.conditions.push(`EXISTS (SELECT 1 FROM OPENJSON([${column}]) AS a ` +
            `INNER JOIN OPENJSON(${p}) AS b ON a.[value] = b.[value])`);
        return this;
    }
    ilike(column, pattern) {
        // SQL Server LIKE is case-insensitive with most collations
        const p = this.nextParam(pattern);
        this.conditions.push(`[${column}] LIKE ${p}`);
        return this;
    }
    like(column, pattern) {
        const p = this.nextParam(pattern);
        this.conditions.push(`[${column}] LIKE ${p}`);
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
            case 'cd': {
                // containedBy — value contains column's data
                const p = this.nextParam(typeof value === 'string' ? value : JSON.stringify(value));
                this.conditions.push(`EXISTS (SELECT 1 FROM OPENJSON([${column}]) AS a ` +
                    `WHERE a.[value] IN (SELECT [value] FROM OPENJSON(${p})))`);
                return this;
            }
            default: {
                const p = this.nextParam(value);
                this.conditions.push(`[${column}] ${this.sqlOperator(operator)} ${p}`);
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
        const p = this.nextParam(query);
        if (options?.type === 'phrase') {
            this.conditions.push(`CONTAINS([${column}], ${p})`);
        }
        else {
            this.conditions.push(`FREETEXT([${column}], ${p})`);
        }
        return this;
    }
    // ---- Modifiers ----
    order(column, options) {
        const dir = options?.ascending === false ? 'DESC' : 'ASC';
        this.orderClauses.push(`[${column}] ${dir}`);
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
    // ---- Internal helpers ----
    buildContainsCondition(column, value) {
        if (Array.isArray(value)) {
            // Array containment: check each element exists in the JSON array column
            if (value.length === 0)
                return '1 = 1';
            const parts = value.map((item) => {
                const p = this.nextParam(typeof item === 'object' ? JSON.stringify(item) : String(item));
                return `EXISTS (SELECT 1 FROM OPENJSON([${column}]) WHERE [value] = ${p})`;
            });
            return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
        }
        if (typeof value === 'object' && value !== null) {
            // Object containment: check each key-value pair
            const entries = Object.entries(value);
            const parts = entries.map(([key, val]) => {
                const p = this.nextParam(typeof val === 'object' && val !== null
                    ? JSON.stringify(val)
                    : val === true
                        ? 'true'
                        : val === false
                            ? 'false'
                            : String(val));
                return `JSON_VALUE([${column}], '$.${key}') = ${p}`;
            });
            return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`;
        }
        // Scalar containment
        const p = this.nextParam(String(value));
        return `[${column}] = ${p}`;
    }
    filterClauseToSql(parsed) {
        const { column, operator, value } = parsed;
        switch (operator) {
            case 'eq':
                if (value === 'true')
                    return `[${column}] = 1`;
                if (value === 'false')
                    return `[${column}] = 0`;
                if (value === 'null')
                    return `[${column}] IS NULL`;
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
                if (value === 'null')
                    return `[${column}] IS NULL`;
                if (value === 'true')
                    return `[${column}] = 1`;
                if (value === 'false')
                    return `[${column}] = 0`;
                return null;
            case 'like':
                return `[${column}] LIKE ${this.nextParam(value)}`;
            case 'ilike':
                return `[${column}] LIKE ${this.nextParam(value)}`;
            default:
                return null;
        }
    }
    sqlOperator(op) {
        const map = {
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
            const offset = this.rangeFrom;
            const fetch = this.rangeTo - this.rangeFrom + 1;
            return (`SELECT ${cols}${countCol} FROM ${table}${where}` +
                `${orderBy} OFFSET ${offset} ROWS FETCH NEXT ${fetch} ROWS ONLY`);
        }
        if (hasLimit && hasOrder) {
            const orderBy = ` ORDER BY ${this.orderClauses.join(', ')}`;
            return (`SELECT ${cols}${countCol} FROM ${table}${where}` +
                `${orderBy} OFFSET 0 ROWS FETCH NEXT ${this.limitCount} ROWS ONLY`);
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
    buildInsert() {
        const table = this.qualifiedTable();
        const rows = Array.isArray(this.insertData)
            ? this.insertData
            : [this.insertData];
        const columns = Object.keys(rows[0]);
        const colList = columns.map((c) => `[${c}]`).join(', ');
        const output = this.returning ? ' OUTPUT inserted.*' : '';
        const valueRows = rows.map((row) => {
            const vals = columns.map((c) => {
                const v = row[c];
                return this.nextParam(typeof v === 'object' && v !== null && !(v instanceof Date)
                    ? JSON.stringify(v)
                    : v);
            });
            return `(${vals.join(', ')})`;
        });
        return `INSERT INTO ${table} (${colList})${output} VALUES ${valueRows.join(', ')}`;
    }
    buildUpdate() {
        const table = this.qualifiedTable();
        const where = this.whereClause();
        const output = this.returning ? ' OUTPUT inserted.*' : '';
        const sets = Object.entries(this.updateData).map(([col, val]) => {
            const p = this.nextParam(typeof val === 'object' && val !== null && !(val instanceof Date)
                ? JSON.stringify(val)
                : val);
            return `[${col}] = ${p}`;
        });
        return `UPDATE ${table} SET ${sets.join(', ')}${output}${where}`;
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
        const output = this.returning ? ' OUTPUT inserted.*' : '';
        const statements = [];
        for (const row of rows) {
            const sourceSelect = columns
                .map((c) => {
                const v = row[c];
                const p = this.nextParam(typeof v === 'object' && v !== null && !(v instanceof Date)
                    ? JSON.stringify(v)
                    : v);
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
    buildDelete() {
        const table = this.qualifiedTable();
        const where = this.whereClause();
        const output = this.returning ? ' OUTPUT deleted.*' : '';
        return `DELETE FROM ${table}${output}${where}`;
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
        try {
            const pool = await this.getPool();
            const request = pool.request();
            // Build SQL first — buildSql() populates paramMap via nextParam()
            const sql = this.buildSql();
            // Bind parameters after SQL generation so all params are registered
            for (const [name, value] of this.paramMap) {
                if (value === null || value === undefined) {
                    request.input(name, null);
                }
                else if (typeof value === 'number') {
                    if (Number.isInteger(value)) {
                        request.input(name, mssql.BigInt, value);
                    }
                    else {
                        request.input(name, mssql.Float, value);
                    }
                }
                else if (typeof value === 'boolean') {
                    request.input(name, mssql.Bit, value);
                }
                else if (typeof value === 'string') {
                    request.input(name, mssql.NVarChar(mssql.MAX), value);
                }
                else if (value instanceof Date) {
                    request.input(name, mssql.DateTime2, value);
                }
                else {
                    // Objects/arrays → JSON string
                    request.input(name, mssql.NVarChar(mssql.MAX), JSON.stringify(value));
                }
            }
            const result = await request.query(sql);
            const recordset = result.recordset ?? [];
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
                            }
                            catch {
                                // Not valid JSON — leave as string
                            }
                        }
                    }
                }
            }
            // Handle head-only (count) queries
            if (this.headOnly) {
                const countVal = recordset[0]
                    ?.__count;
                return {
                    data: null,
                    error: null,
                    count: typeof countVal === 'number' ? countVal : null,
                };
            }
            // Extract __total_count if present
            let count = null;
            if (this.countMode && recordset.length > 0) {
                const firstRow = recordset[0];
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
                return { data: recordset[0], error: null, count };
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
                    data: recordset.length === 1 ? recordset[0] : null,
                    error: null,
                    count,
                };
            }
            // Default: return the full result set
            return {
                data: recordset,
                error: null,
                count,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { data: null, error: { message } };
        }
    }
}
