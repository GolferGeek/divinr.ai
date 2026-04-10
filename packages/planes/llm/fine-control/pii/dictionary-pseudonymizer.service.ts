import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DATABASE_SERVICE,
  DatabaseService,
  QueryResult,
} from '../../../database';

export interface DictionaryPseudonymMapping {
  originalValue: string;
  pseudonym: string;
  dataType: string;
  category: string;
}

export interface DictionaryPseudonymizationResult {
  originalText: string;
  pseudonymizedText: string;
  mappings: DictionaryPseudonymMapping[];
  processingTimeMs: number;
}

export interface DictionaryReversalResult {
  originalText: string;
  reversalCount: number;
  processingTimeMs: number;
}

/**
 * Dictionary-Based Pseudonymizer Service
 *
 * SECURITY: Implements reversible pseudonymization for PII protection.
 * Simple, fast pseudonymization using a predefined dictionary.
 * No hashing, no complex pattern matching - just direct string replacement.
 *
 * Flow:
 * 1. Load dictionary entries from database
 * 2. Case-insensitive search and replace original_value → pseudonym
 * 3. Track what was replaced for reversal
 * 4. Reverse pseudonym → original_value after LLM response
 *
 * Security considerations:
 * - Dictionary entries are cached for performance (5-minute TTL)
 * - Supports scoped dictionaries (agent > org > global)
 * - Regex special characters are properly escaped
 * - Reversal mappings must be stored securely by caller
 */
@Injectable()
export class DictionaryPseudonymizerService {
  private readonly logger = new Logger(DictionaryPseudonymizerService.name);

  // Cache dictionary entries to avoid repeated DB calls
  private dictionaryCache: DictionaryPseudonymMapping[] | null = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {
    this.logger.log(
      '🎯 DictionaryPseudonymizerService initialized - simple dictionary-based pseudonymization',
    );
  }

  /**
   * Load active dictionary entries from database, scoped by organization/agent when provided
   */
  private async loadDictionary(options?: {
    agentSlug?: string | null;
  }): Promise<DictionaryPseudonymMapping[]> {
    const now = Date.now();

    // Return cached entries if still valid
    if (this.dictionaryCache && now < this.cacheExpiry) {
      return this.dictionaryCache;
    }

    try {
      const { agentSlug = null } = options || {};

      // Prefer agent-scoped -> global
      const resultSets: unknown[][] = [];

      if (agentSlug) {
        const { data } = (await this.db
          .from(null, 'pseudonym_dictionaries')
          .select('original_value, pseudonym, data_type, category')
          .eq('is_active', true)
          .is('organization_slug', null)
          .eq('agent_slug', agentSlug)
          .not('original_value', 'is', null)
          .not('pseudonym', 'is', null)) as QueryResult<unknown>;
        if (data) resultSets.push(data as unknown[]);
      }

      const { data: globalData, error } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .select('original_value, pseudonym, data_type, category')
        .eq('is_active', true)
        .is('organization_slug', null)
        .is('agent_slug', null)
        .not('original_value', 'is', null)
        .not('pseudonym', 'is', null)) as QueryResult<unknown>;

      if (error) {
        this.logger.error('Failed to load pseudonym dictionary:', error);
        throw new Error('Failed to load pseudonym dictionary');
      }

      if (globalData) resultSets.push(globalData as unknown[]);

      // Merge with priority: agent > global, detect overrides/conflicts
      const merged = ([] as unknown[]).concat(...resultSets);
      const byOriginal: Record<
        string,
        {
          pseudonym: string;
          src: 'agent' | 'global';
          row: Record<string, unknown>;
        }
      > = {};
      for (const row of merged) {
        const r = row as Record<string, unknown>;
        const src: 'agent' | 'global' = r.agent_slug
          ? 'agent'
          : 'global';
        const key = `${String((r.original_value as string | null | undefined) || '').toLowerCase()}::${String(r.data_type) || 'unknown'}`;
        if (!key.trim()) continue;
        const existing = byOriginal[key];
        if (!existing) {
          byOriginal[key] = {
            pseudonym: r.pseudonym as string,
            src,
            row: row as Record<string, unknown>,
          };
          continue;
        }
        // Only override when new source has higher priority
        const rank = (s: 'agent' | 'global') =>
          s === 'agent' ? 2 : 1;
        if (rank(src) > rank(existing.src)) {
          if (existing.pseudonym !== r.pseudonym) {
            this.logger.warn(
              `📚 [PSEUDONYM-DICT] Override: ${key} (${existing.src} -> ${src}) '${existing.pseudonym}' -> '${String(r.pseudonym)}'`,
            );
          }
          byOriginal[key] = {
            pseudonym: r.pseudonym as string,
            src,
            row: row as Record<string, unknown>,
          };
        }
      }

      const unique = Object.values(byOriginal).map((e) => e.row as unknown);

      const dictionary: DictionaryPseudonymMapping[] = (unique || []).map(
        (row: unknown) => {
          const r = row as Record<string, unknown>;
          return {
            originalValue: r.original_value as string,
            pseudonym: r.pseudonym as string,
            dataType: r.data_type as string,
            category: r.category as string,
          };
        },
      );

      // Cache the results
      this.dictionaryCache = dictionary;
      this.cacheExpiry = now + this.CACHE_TTL_MS;

      this.logger.log(`📚 Loaded ${dictionary.length} dictionary entries`);
      return dictionary;
    } catch (error) {
      this.logger.error('Failed to load dictionary:', error);
      throw error;
    }
  }

  /**
   * Pseudonymize text using dictionary entries
   */
  async pseudonymizeText(
    text: string,
    options?: { agentSlug?: string | null },
  ): Promise<DictionaryPseudonymizationResult> {
    const startTime = Date.now();
    let processedText = text;
    const mappings: DictionaryPseudonymMapping[] = [];

    try {
      // Load dictionary entries
      const dictionary = await this.loadDictionary(options);

      // Process each dictionary entry
      for (const entry of dictionary) {
        // Case-insensitive search for the original value
        const regex = new RegExp(this.escapeRegex(entry.originalValue), 'gi');
        const matches = processedText.match(regex);

        if (matches && matches.length > 0) {
          // Replace all occurrences with the pseudonym
          processedText = processedText.replace(regex, entry.pseudonym);

          // Track this mapping for reversal
          mappings.push(entry);

          this.logger.log(
            `🎯 Replaced ${matches.length} occurrence(s) of ${entry.dataType}`,
          );
        }
      }

      const processingTimeMs = Date.now() - startTime;

      return {
        originalText: text,
        pseudonymizedText: processedText,
        mappings,
        processingTimeMs,
      };
    } catch (error) {
      this.logger.error('Pseudonymization failed:', error);
      throw error;
    }
  }

  /**
   * Reverse pseudonyms back to original values
   */
  reversePseudonyms(
    text: string,
    mappings: DictionaryPseudonymMapping[],
  ): Promise<DictionaryReversalResult> {
    const startTime = Date.now();
    let processedText = text;
    let reversalCount = 0;

    try {
      // Process each mapping in reverse
      for (const mapping of mappings) {
        // Case-insensitive search for the pseudonym
        const regex = new RegExp(this.escapeRegex(mapping.pseudonym), 'gi');
        const matches = processedText.match(regex);

        if (matches && matches.length > 0) {
          // Replace all occurrences with the original value
          processedText = processedText.replace(regex, mapping.originalValue);
          reversalCount += matches.length;

          this.logger.log(
            `🔄 Reversed ${matches.length} occurrence(s) of ${mapping.dataType}`,
          );
        }
      }

      const processingTimeMs = Date.now() - startTime;

      return Promise.resolve({
        originalText: processedText,
        reversalCount,
        processingTimeMs,
      });
    } catch (error) {
      this.logger.error('Reversal failed:', error);
      throw error;
    }
  }

  /**
   * Escape special regex characters in a string
   * SECURITY: Prevents regex injection by escaping all special characters
   */
  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Clear the dictionary cache (useful for testing or when dictionary is updated)
   */
  clearCache(): void {
    this.dictionaryCache = null;
    this.cacheExpiry = 0;
    this.logger.log('🗑️ Dictionary cache cleared');
  }

  /**
   * Get current dictionary entries (for debugging/testing)
   */
  async getDictionary(): Promise<DictionaryPseudonymMapping[]> {
    return this.loadDictionary();
  }
}
