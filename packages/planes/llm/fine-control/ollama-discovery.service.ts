import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface OllamaDiscoveryResult {
  connected: boolean;
  url: string;
  version?: string;
  attempts: number;
  error?: string;
}

interface OllamaVersionResponse {
  version?: string;
}

/**
 * Service for discovering and connecting to Ollama with retry logic.
 *
 * This is a pure utility service - it does NOT run discovery on startup.
 * The OllamaStartupService handles startup discovery and model sync.
 *
 * Features:
 * - Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
 * - Fallback URLs: tries configured URL, then localhost, then Docker network
 * - Caches working URL for subsequent requests
 * - Clear logging of connection status
 */
@Injectable()
export class OllamaDiscoveryService {
  private readonly logger = new Logger(OllamaDiscoveryService.name);

  // Ollama URL - just use the configured URL or localhost
  private readonly fallbackUrls = [
    process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ];

  // Retry configuration
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000; // 1 second

  // Cached discovery result
  private discoveredUrl: string | null = null;
  private lastDiscoveryAttempt: Date | null = null;
  private cacheExpiryMs = 60000; // 1 minute cache

  constructor(private readonly httpService: HttpService) {}

  /**
   * Get the current Ollama URL.
   * Returns cached URL if available and valid, otherwise performs discovery.
   */
  async getUrl(): Promise<string> {
    // Check cache
    if (this.discoveredUrl && this.lastDiscoveryAttempt) {
      const cacheAge = Date.now() - this.lastDiscoveryAttempt.getTime();
      if (cacheAge < this.cacheExpiryMs) {
        return this.discoveredUrl;
      }
    }

    // Perform discovery
    const result = await this.discover();
    return result.url;
  }

  /**
   * Discover a working Ollama endpoint with retry logic.
   */
  async discover(): Promise<OllamaDiscoveryResult> {
    const uniqueUrls = [...new Set(this.fallbackUrls)];
    let totalAttempts = 0;

    for (const url of uniqueUrls) {
      this.logger.debug(`Trying Ollama at ${url}...`);

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        totalAttempts++;

        try {
          const result = await this.tryConnect(url);
          if (result.connected) {
            this.discoveredUrl = url;
            this.lastDiscoveryAttempt = new Date();
            return {
              connected: true,
              url,
              version: result.version,
              attempts: totalAttempts,
            };
          }
        } catch {
          const delay = this.baseDelayMs * Math.pow(2, attempt - 1);
          this.logger.debug(
            `Attempt ${attempt}/${this.maxRetries} to ${url} failed, retrying in ${delay}ms...`,
          );

          if (attempt < this.maxRetries) {
            await this.sleep(delay);
          }
        }
      }
    }

    // All URLs failed
    return {
      connected: false,
      url: this.fallbackUrls[0] || 'http://localhost:11434',
      attempts: totalAttempts,
      error: 'Could not connect to Ollama at any configured URL',
    };
  }

  /**
   * Try to connect to a specific Ollama URL.
   */
  private async tryConnect(
    url: string,
  ): Promise<{ connected: boolean; version?: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<OllamaVersionResponse>(`${url}/api/version`, {
          timeout: 5000,
        }),
      );

      return {
        connected: true,
        version: response.data?.version,
      };
    } catch {
      return { connected: false };
    }
  }

  /**
   * Check if Ollama is currently available.
   */
  async isAvailable(): Promise<boolean> {
    const result = await this.discover();
    return result.connected;
  }

  /**
   * Force refresh the discovery cache.
   */
  async refresh(): Promise<OllamaDiscoveryResult> {
    this.discoveredUrl = null;
    this.lastDiscoveryAttempt = null;
    return this.discover();
  }

  /**
   * Get the currently discovered URL (may be null if not yet discovered).
   */
  getDiscoveredUrl(): string | null {
    return this.discoveredUrl;
  }

  /**
   * Sleep helper for retry delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
