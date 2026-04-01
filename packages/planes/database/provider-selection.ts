export type DatabaseProvider = 'supabase' | 'supabase_pg' | 'sqlserver' | 'postgresql';

export function resolveDatabaseProvider(value?: string): DatabaseProvider {
  const provider = value || 'supabase';
  switch (provider) {
    case 'supabase':
    case 'supabase_pg':
    case 'sqlserver':
    case 'postgresql':
      return provider;
    default:
      throw new Error(
        `Unsupported DB_PROVIDER '${provider}'. Expected: supabase, supabase_pg, sqlserver, postgresql`,
      );
  }
}
