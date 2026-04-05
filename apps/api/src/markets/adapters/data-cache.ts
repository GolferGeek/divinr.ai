/**
 * In-memory cache with TTL eviction for data source results.
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class DataCache {
  private store = new Map<string, CacheEntry<string>>();

  static buildKey(provider: string, symbol: string, dataType: string): string {
    return `${provider}:${symbol}:${dataType}`;
  }

  get(key: string): string | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: string, ttlSeconds: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}
