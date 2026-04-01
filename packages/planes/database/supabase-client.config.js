"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTableName = getTableName;
exports.getSchemaForTable = getSchemaForTable;
const config_1 = require("@nestjs/config");
// Helper function to get schema-aware table name
function getTableName(tableName, _schema) {
    // Schema selection is handled via Supabase client's .schema() method
    return tableName;
}
// Helper function to get the appropriate schema for a table
function getSchemaForTable(tableName, explicitSchema) {
    // Use explicit schema if provided
    if (explicitSchema) {
        return explicitSchema;
    }
    // All tables are now in public schema after consolidation
    // Company tables (companies, departments, kpi_data, kpi_goals, kpi_metrics) are now in public
    return 'public';
}
// Lazy configuration loading - defer all environment access
exports.default = (0, config_1.registerAs)('supabase', () => {
    const getEnvValue = (key, defaultValue) => process.env[key] || defaultValue;
    return {
        url: getEnvValue('SUPABASE_URL', 'http://127.0.0.1:6010'),
        anonKey: getEnvValue('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'),
        serviceKey: getEnvValue('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'),
        jwtSecret: getEnvValue('SUPABASE_JWT_SECRET', 'super-secret-jwt-token-with-at-least-32-characters-long'),
        coreSchema: getEnvValue('SUPABASE_CORE_SCHEMA', 'public'),
        companySchema: getEnvValue('SUPABASE_COMPANY_SCHEMA', 'public'),
    };
});
