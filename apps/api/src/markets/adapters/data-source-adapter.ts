/**
 * Data Source Adapter interface for the Analyst Intelligence Platform.
 *
 * Each adapter wraps an external data API (Twelve Data, FMP, FRED, etc.)
 * with rate limiting, caching, and error handling. The same interface
 * supports both free and paid tiers — upgrading is a config change.
 */

export interface DataSourceFetchParams {
  symbol: string;
  dataTypes: string[];
  /** ISO date string for the start of the data window */
  from?: string;
  /** ISO date string for the end of the data window */
  to?: string;
}

export interface DataSourceResult {
  /** Formatted text block ready for LLM prompt injection */
  data: string;
  /** Metadata about the fetch (source, timestamp, cache status) */
  metadata: {
    source: string;
    fetchedAt: string;
    cached: boolean;
    dataTypes: string[];
  };
}

export interface DataSourceAdapter {
  /** Unique identifier matching data_source_registry.id */
  id: string;
  /** Human-readable name */
  name: string;
  /** Provider key (e.g., 'twelve-data', 'fmp') */
  provider: string;
  /** Tier: 'free' or 'paid' */
  tier: string;
  /** Max requests per minute for this adapter */
  rateLimitPerMinute: number;

  /**
   * Fetch data for a given symbol and set of data types.
   * Returns formatted text suitable for injection into an LLM prompt.
   * Must handle rate limiting, caching, and graceful degradation internally.
   */
  fetchData(params: DataSourceFetchParams): Promise<DataSourceResult>;
}
