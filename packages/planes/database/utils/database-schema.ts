import { createClient } from '@supabase/supabase-js';

interface SupabaseClientWithRpc {
  rpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  referencedTable?: string;
  referencedColumn?: string;
}

export interface TableInfo {
  name: string;
  columns: TableColumn[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  businessDomain?: string;
  description?: string;
}

export interface ForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface BusinessDomain {
  name: string;
  description: string;
  tables: string[];
  commonQueries?: string[];
}

export interface SchemaRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  relationshipType:
    | 'one-to-many'
    | 'many-to-one'
    | 'one-to-one'
    | 'many-to-many';
}

// Global state
let schemaCache: {
  tablesInfo: Map<string, TableInfo>;
  relationships: SchemaRelationship[];
  businessDomains: Map<string, BusinessDomain>;
  initialized: boolean;
} | null = null;

let supabaseClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize Supabase client if not already done
 */
function getSupabaseClient() {
  if (!supabaseClient) {
    const supabaseUrl =
      process.env.SUPABASE_URL || 'https://jcmkjecmdugfzvdijodg.supabase.co';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY environment variable is required',
      );
    }

    supabaseClient = createClient(supabaseUrl, serviceKey);
  }
  return supabaseClient;
}

/**
 * Discover complete database schema including tables, columns, and relationships
 */
async function discoverFullSchema(): Promise<void> {
  const client = getSupabaseClient();

  // Get all table information
  const { data: tableInfoData, error: tableInfoError } =
    await client.rpc('get_table_info');
  if (tableInfoError) {
    throw new Error(`Failed to get table info: ${tableInfoError.message}`);
  }

  // Group by table
  const tableMap = new Map<string, unknown[]>();
  const tableData = (tableInfoData || []) as unknown[];
  tableData.forEach((row: unknown) => {
    const r = row as { table_name: string };
    if (!tableMap.has(r.table_name)) {
      tableMap.set(r.table_name, []);
    }
    tableMap.get(r.table_name)!.push(row);
  });

  // Discover foreign key relationships
  const relationships = await discoverRelationships();

  // Initialize cache
  schemaCache = {
    tablesInfo: new Map(),
    relationships,
    businessDomains: new Map(),
    initialized: false,
  };

  // Process each table
  for (const [tableName, columns] of tableMap) {
    const tableInfo: TableInfo = {
      name: tableName,
      columns: columns.map((col) => processColumn(col, relationships)),
      primaryKeys: await discoverPrimaryKeys(tableName),
      foreignKeys: relationships
        .filter((rel) => rel.fromTable === tableName)
        .map((rel) => ({
          column: rel.fromColumn,
          referencedTable: rel.toTable,
          referencedColumn: rel.toColumn,
        })),
    };

    schemaCache.tablesInfo.set(tableName, tableInfo);
  }

  // Add business domain categorization
  categorizeBusinessDomains();

  schemaCache.initialized = true;
}

/**
 * Discover foreign key relationships using PostgreSQL system tables
 */
async function discoverRelationships(): Promise<SchemaRelationship[]> {
  const client = getSupabaseClient();

  try {
    const { data, error } = await (
      client as unknown as SupabaseClientWithRpc
    ).rpc('exec_sql', {
      query: `
        SELECT
          tc.table_name as from_table,
          kcu.column_name as from_column,
          ccu.table_name as to_table,
          ccu.column_name as to_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
        ORDER BY tc.table_name, kcu.column_name
      `,
    });

    if (error) {
      return inferRelationshipsFromNaming();
    }

    const relationshipData = (data || []) as unknown[];
    const relationships: SchemaRelationship[] = relationshipData.map(
      (row: unknown) => {
        const r = row as {
          from_table: string;
          from_column: string;
          to_table: string;
          to_column: string;
        };
        return {
          fromTable: r.from_table,
          fromColumn: r.from_column,
          toTable: r.to_table,
          toColumn: r.to_column,
          relationshipType: 'many-to-one' as const,
        };
      },
    );

    return relationships;
  } catch {
    return inferRelationshipsFromNaming();
  }
}

/**
 * Infer relationships from column naming conventions (fallback)
 */
function inferRelationshipsFromNaming(): SchemaRelationship[] {
  const relationships: SchemaRelationship[] = [];

  // This will be called after tables are processed, so we need to implement this later
  // For now, return empty array and we'll implement this after the main schema is loaded

  return relationships;
}

/**
 * Discover primary keys for a table
 */
async function discoverPrimaryKeys(tableName: string): Promise<string[]> {
  const client = getSupabaseClient();

  try {
    const { data, error } = await (
      client as unknown as SupabaseClientWithRpc
    ).rpc('exec_sql', {
      query: `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_name = '${tableName}'
          AND tc.table_schema = 'public'
        ORDER BY kcu.ordinal_position
      `,
    });

    const pkData = (data || []) as unknown[];
    if (error || !pkData.length) {
      return ['id']; // Common default
    }

    return pkData.map(
      (row: unknown) => (row as { column_name: string }).column_name,
    );
  } catch {
    return ['id']; // Fallback
  }
}

/**
 * Process column information and add relationship context
 */
function processColumn(
  columnData: unknown,
  relationships: SchemaRelationship[],
): TableColumn {
  const col = columnData as {
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  };
  const fkRelation = relationships.find(
    (rel) =>
      rel.fromTable === col.table_name && rel.fromColumn === col.column_name,
  );

  return {
    name: col.column_name,
    type: col.data_type,
    nullable: col.is_nullable === 'YES',
    default: col.column_default ?? undefined,
    isPrimaryKey: col.column_name === 'id', // Common convention
    isForeignKey: !!fkRelation,
    referencedTable: fkRelation?.toTable,
    referencedColumn: fkRelation?.toColumn,
  };
}

/**
 * Categorize tables into business domains
 */
function categorizeBusinessDomains(): void {
  if (!schemaCache) return;

  const domains: BusinessDomain[] = [
    {
      name: 'KPI & Analytics',
      description:
        'Key Performance Indicators, metrics, and business analytics',
      tables: [
        'companies',
        'departments',
        'kpi_data',
        'kpi_metrics',
        'kpi_goals',
      ],
      commonQueries: [
        'Revenue analysis by company and time period',
        'KPI performance tracking',
        'Goal achievement analysis',
      ],
    },
    {
      name: 'User Management',
      description: 'User accounts, authentication, and user-related data',
      tables: [
        'users',
        'user_sessions',
        'user_preferences',
        'user_interactions',
        'user_usage_stats',
        'user_context',
        'user_routing_patterns',
        'user_privacy_settings',
        'admin_users',
        'user_audit_log',
        'user_roles_summary',
      ],
      commonQueries: [
        'User activity analysis',
        'Session tracking',
        'User behavior patterns',
      ],
    },
    {
      name: 'Agent System',
      description: 'AI agents, their interactions, and performance metrics',
      tables: [
        'agents',
        'agent_conversations',
        'agent_interactions',
        'agent_relationships',
        'agent_health_status',
        'agent_hierarchy',
        'organizational_agent_stats',
        'agent_conversations_with_stats',
        'agent_relationships_with_details',
      ],
      commonQueries: [
        'Agent performance analysis',
        'Conversation quality metrics',
        'Agent utilization rates',
      ],
    },
    {
      name: 'Task Management',
      description: 'Tasks, workflows, and task-related communications',
      tables: [
        'tasks',
        'task_messages',
        'tasks_with_message_stats',
        'human_inputs',
        'human_inputs_with_task_context',
      ],
      commonQueries: [
        'Task completion rates',
        'Workflow efficiency analysis',
        'Human input requirements',
      ],
    },
    {
      name: 'LLM & Providers',
      description: 'Language model providers, usage, and performance',
      tables: [
        'providers',
        'llm_providers',
        'llm_models',
        'llm_usage',
        'models',
      ],
      commonQueries: [
        'LLM cost analysis',
        'Provider performance comparison',
        'Model usage patterns',
      ],
    },
    {
      name: 'System Operations',
      description: 'System monitoring, sessions, and operational data',
      tables: [
        'sessions',
        'messages',
        'evaluation_monitor_users',
        'role_audit_log',
      ],
      commonQueries: [
        'System health monitoring',
        'Message flow analysis',
        'Audit trail tracking',
      ],
    },
    {
      name: 'MCP & Tools',
      description: 'Model Context Protocol executions and tool usage',
      tables: [
        'mcp_executions',
        'mcp_execution_summary',
        'mcp_tool_usage',
        'mcp_usage_analytics',
        'mcp_failures',
        'mcp_feedback',
      ],
      commonQueries: [
        'Tool usage analytics',
        'MCP execution success rates',
        'Integration performance metrics',
      ],
    },
    {
      name: 'Commands & Controls',
      description: 'User commands and system controls',
      tables: [
        'cidafm_commands',
        'cidafm_commands_by_type',
        'user_cidafm_commands',
      ],
      commonQueries: ['Command usage patterns', 'User interaction analysis'],
    },
  ];

  domains.forEach((domain) => {
    schemaCache!.businessDomains.set(domain.name, domain);

    // Add business domain to table info
    domain.tables.forEach((tableName) => {
      const tableInfo = schemaCache!.tablesInfo.get(tableName);
      if (tableInfo) {
        tableInfo.businessDomain = domain.name;
        tableInfo.description = generateTableDescription(
          tableName,
          domain.name,
        );
      }
    });
  });
}

/**
 * Generate table description based on business domain
 */
function generateTableDescription(tableName: string, domain: string): string {
  const descriptions: { [key: string]: string } = {
    // KPI & Analytics
    companies: 'Business entities with departments and KPI tracking',
    departments: 'Organizational units within companies',
    kpi_data: 'Time-series data for key performance indicators',
    kpi_metrics: 'Definitions and metadata for KPI measurements',
    kpi_goals: 'Target values and goals for KPI metrics',

    // User Management
    users: 'User account information and profiles',
    user_sessions: 'User login sessions and activity tracking',
    user_preferences: 'User-specific settings and preferences',
    user_interactions: 'User interaction logs and behavior data',

    // Agent System
    agents: 'AI agent definitions and configurations',
    agent_conversations: 'Conversations and interactions between agents',
    agent_interactions: 'Agent interaction logs and performance data',

    // Task Management
    tasks: 'Work items and task definitions',
    task_messages: 'Communications related to specific tasks',

    // LLM & Providers
    providers: 'LLM service providers and configurations',
    llm_usage: 'Language model usage tracking and costs',

    // Default
    [tableName]: `${domain} table: ${tableName}`,
  };

  return (
    descriptions[tableName] ||
    descriptions[tableName] ||
    `Table in ${domain} domain`
  );
}

/**
 * Initialize database schema (lazy initialization)
 */
export async function initializeDatabaseSchema(): Promise<void> {
  if (!schemaCache || !schemaCache.initialized) {
    await discoverFullSchema();
  }
}

/**
 * Get schema information for specific tables
 */
export async function getTablesInfo(
  tableNames?: string[],
): Promise<TableInfo[]> {
  await initializeDatabaseSchema();

  if (!tableNames) {
    return Array.from(schemaCache!.tablesInfo.values());
  }

  return tableNames
    .map((name) => schemaCache!.tablesInfo.get(name))
    .filter((table): table is TableInfo => table !== undefined);
}

/**
 * Get all business domains
 */
export async function getBusinessDomains(): Promise<BusinessDomain[]> {
  await initializeDatabaseSchema();
  return Array.from(schemaCache!.businessDomains.values());
}

/**
 * Get tables for a specific business domain
 */
export async function getTablesByDomain(
  domainName: string,
): Promise<TableInfo[]> {
  await initializeDatabaseSchema();

  const domain = schemaCache!.businessDomains.get(domainName);
  if (!domain) {
    return [];
  }

  return await getTablesInfo(domain.tables);
}

/**
 * Get relationships involving specific tables
 */
export async function getRelationships(
  tableNames?: string[],
): Promise<SchemaRelationship[]> {
  await initializeDatabaseSchema();

  if (!tableNames) {
    return schemaCache!.relationships;
  }

  return schemaCache!.relationships.filter(
    (rel) =>
      tableNames.includes(rel.fromTable) || tableNames.includes(rel.toTable),
  );
}

/**
 * Generate formatted schema context for LangChain (agent-specific)
 */
export async function getSchemaContext(options?: {
  tableNames?: string[];
  includeDomains?: string[];
  includeRelationships?: boolean;
  includeBusinessContext?: boolean;
}): Promise<string> {
  const opts = {
    includeRelationships: true,
    includeBusinessContext: true,
    ...options,
  };

  let tables: TableInfo[] = [];

  if (opts.includeDomains) {
    for (const domain of opts.includeDomains) {
      const domainTables = await getTablesByDomain(domain);
      tables.push(...domainTables);
    }
  } else if (opts.tableNames) {
    tables = await getTablesInfo(opts.tableNames);
  } else {
    tables = await getTablesInfo();
  }

  let context = '';

  // Add table structure
  tables.forEach((table) => {
    context += `Table: ${table.name}\n`;
    if (table.description) {
      context += `  Description: ${table.description}\n`;
    }

    table.columns.forEach((col) => {
      const annotations = [];
      if (col.isPrimaryKey) annotations.push('PRIMARY KEY');
      if (col.isForeignKey)
        annotations.push(
          `FK -> ${col.referencedTable}.${col.referencedColumn}`,
        );
      if (!col.nullable) annotations.push('NOT NULL');

      const annotationStr =
        annotations.length > 0 ? ` (${annotations.join(', ')})` : '';
      context += `  - ${col.name} (${col.type}${annotationStr})\n`;
    });
    context += '\n';
  });

  // Add relationships
  if (opts.includeRelationships) {
    const relevantRelationships = await getRelationships(
      tables.map((t) => t.name),
    );
    if (relevantRelationships.length > 0) {
      context += 'Relationships:\n';
      relevantRelationships.forEach((rel) => {
        context += `- ${rel.fromTable}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn} (${rel.relationshipType})\n`;
      });
      context += '\n';
    }
  }

  // Add business context
  if (opts.includeBusinessContext) {
    const domains = new Set(
      tables.map((t) => t.businessDomain).filter(Boolean),
    );
    const allDomains = await getBusinessDomains();

    domains.forEach((domainName) => {
      const domain = allDomains.find((d) => d.name === domainName);
      if (domain) {
        context += `Business Domain: ${domain.name}\n`;
        context += `  ${domain.description}\n`;
        if (domain.commonQueries) {
          context += `  Common queries: ${domain.commonQueries.join(', ')}\n`;
        }
        context += '\n';
      }
    });
  }

  return context;
}

/**
 * Get all table names
 */
export async function getAllTableNames(): Promise<string[]> {
  await initializeDatabaseSchema();
  return Array.from(schemaCache!.tablesInfo.keys());
}

/**
 * Check if schema is initialized
 */
export function isSchemaInitialized(): boolean {
  return schemaCache?.initialized || false;
}
