import { Injectable, Inject, Logger } from '@nestjs/common';
import { PIIPatternService } from '../pii-pattern.service';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';

export interface PatternRedactionMapping {
  originalValue: string;
  redactedValue: string;
  dataType: string;
  startIndex: number;
  endIndex: number;
  patternName: string;
}

export interface PatternRedactionResult {
  originalText: string;
  redactedText: string;
  mappings: PatternRedactionMapping[];
  processingTimeMs: number;
  redactionCount: number;
}

export interface PatternReversalResult {
  originalText: string;
  reversalCount: number;
  processingTimeMs: number;
}

/**
 * Pattern-Based Redaction Service with Reversibility
 *
 * SECURITY: Implements reversible pattern-based PII redaction.
 * Applies pattern-based redactions (from redaction_patterns table) to text,
 * storing mappings for later reversal. Works alongside dictionary pseudonymization.
 *
 * Flow:
 * 1. Detect PII patterns using PIIPatternService
 * 2. Apply redactions using replacement values from database or [TYPE_REDACTED] format
 * 3. Store mappings for reversal
 * 4. Reverse redactions after LLM response (before pseudonym reversal)
 *
 * Security considerations:
 * - Can exclude showstopper PII from redaction (they should block instead)
 * - Creates unique placeholders for multiple instances to enable accurate reversal
 * - Regex special characters are properly escaped
 * - Reversal mappings must be stored securely by caller
 */
@Injectable()
export class PatternRedactionService {
  private readonly logger = new Logger(PatternRedactionService.name);

  constructor(
    private readonly piiPatternService: PIIPatternService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {
    this.logger.log(
      '🔒 PatternRedactionService initialized - pattern-based redaction with reversibility',
    );
  }

  /**
   * Redact patterns from text, storing mappings for reversal
   */
  async redactPatterns(
    text: string,
    options?: {
      minConfidence?: number;
      maxMatches?: number;
      excludeShowstoppers?: boolean; // Don't redact showstoppers (they should block)
    },
  ): Promise<PatternRedactionResult> {
    const startTime = Date.now();
    let processedText = text;
    const mappings: PatternRedactionMapping[] = [];

    try {
      // Detect PII patterns
      const detectionResult = await this.piiPatternService.detectPII(text, {
        minConfidence: options?.minConfidence ?? 0.8,
        maxMatches: options?.maxMatches ?? 100,
      });

      // Filter out showstoppers if requested (they should block, not redact)
      const matchesToRedact = options?.excludeShowstoppers
        ? detectionResult.matches.filter((m) => m.severity !== 'showstopper')
        : detectionResult.matches;

      if (matchesToRedact.length === 0) {
        return {
          originalText: text,
          redactedText: text,
          mappings: [],
          processingTimeMs: Date.now() - startTime,
          redactionCount: 0,
        };
      }

      // Load replacement values from database
      const replacementMap = await this.loadReplacementMap();

      // Track counts per data type for unique placeholders
      const typeCounts: Record<string, number> = {};

      // Sort matches by position in reverse order to avoid index shifting issues
      const sortedMatches = [...matchesToRedact].sort(
        (a, b) => b.startIndex - a.startIndex,
      );

      // Apply redactions from end to beginning
      for (const match of sortedMatches) {
        // Initialize count for this data type if needed
        const dataType = match.dataType;
        if (!typeCounts[dataType]) {
          typeCounts[dataType] = 0;
        }
        typeCounts[dataType] = (typeCounts[dataType] || 0) + 1;
        const instanceNumber = typeCounts[dataType];

        // Create unique placeholder for each instance to enable accurate reversal
        // Format: [TYPE_REDACTED_N] where N is the instance number
        const baseReplacement =
          replacementMap[dataType] || `[${dataType.toUpperCase()}_REDACTED]`;

        // If there are multiple instances of the same type, add index
        const replacement =
          instanceNumber > 1
            ? `${baseReplacement}_${instanceNumber}`
            : baseReplacement;

        // Store mapping for reversal
        mappings.push({
          originalValue: match.value,
          redactedValue: replacement,
          dataType: match.dataType,
          startIndex: match.startIndex,
          endIndex: match.endIndex,
          patternName: match.patternName,
        });

        // Replace in text
        processedText =
          processedText.substring(0, match.startIndex) +
          replacement +
          processedText.substring(match.endIndex);

        this.logger.debug(
          `🔒 Redacted ${dataType} (instance ${instanceNumber})`,
        );
      }

      // Reverse mappings array to match original order
      mappings.reverse();

      const processingTimeMs = Date.now() - startTime;

      return {
        originalText: text,
        redactedText: processedText,
        mappings,
        processingTimeMs,
        redactionCount: mappings.length,
      };
    } catch (error) {
      this.logger.error('Pattern redaction failed:', error);
      throw error;
    }
  }

  /**
   * Reverse pattern redactions back to original values
   */
  reverseRedactions(
    text: string,
    mappings: PatternRedactionMapping[],
  ): Promise<PatternReversalResult> {
    const startTime = Date.now();
    let processedText = text;
    let reversalCount = 0;

    try {
      // Process mappings in reverse order (longest redacted values first)
      // to avoid partial replacements
      const sortedMappings = [...mappings].sort(
        (a, b) => b.redactedValue.length - a.redactedValue.length,
      );

      for (const mapping of sortedMappings) {
        // Escape special regex characters in redacted value
        const escapedRedacted = this.escapeRegex(mapping.redactedValue);
        // Use word boundaries or exact match to avoid partial replacements
        // Since we use unique placeholders (with _N suffix for multiple instances),
        // we can safely replace exact matches
        const regex = new RegExp(escapedRedacted, 'g');
        const matches = processedText.match(regex);

        if (matches && matches.length > 0) {
          // Replace exact occurrences with the original value
          // Since each placeholder is unique (or single instance), this is safe
          processedText = processedText.replace(regex, mapping.originalValue);
          reversalCount += matches.length;

          this.logger.debug(
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
      this.logger.error('Pattern reversal failed:', error);
      throw error;
    }
  }

  /**
   * Load replacement values from redaction_patterns table
   * Returns a map of dataType -> replacement value
   */
  private async loadReplacementMap(): Promise<Record<string, string>> {
    try {
      const { data, error } = (await this.db
        .from(null, 'redaction_patterns')
        .select('data_type, replacement')
        .eq('is_active', true)) as QueryResult<unknown>;

      if (error) {
        this.logger.warn(
          `Failed to load replacement map: ${error.message}. Using defaults.`,
        );
        return {};
      }

      const map: Record<string, string> = {};
      if (data) {
        const typedData = data as unknown as Array<{
          data_type: string;
          replacement: string;
        }>;
        for (const row of typedData) {
          if (row.data_type && row.replacement) {
            // Use the first replacement found for each data type
            if (!map[row.data_type]) {
              map[row.data_type] = row.replacement;
            }
          }
        }
      }

      return map;
    } catch {
      this.logger.warn('Failed to load replacement map. Using defaults.');
      return {};
    }
  }

  /**
   * Escape special regex characters in a string
   * SECURITY: Prevents regex injection by escaping all special characters
   */
  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
