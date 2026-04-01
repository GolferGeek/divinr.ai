import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';

export type PIIDataType =
  | 'email'
  | 'phone'
  | 'name'
  | 'address'
  | 'ip_address'
  | 'username'
  | 'credit_card'
  | 'ssn'
  | 'custom';

export interface PIIPattern {
  id?: string;
  name: string;
  dataType: PIIDataType;
  pattern: RegExp;
  validator?: (match: string) => boolean;
  description: string;
  category?: string; // 'pii_builtin' or 'pii_custom'
  priority?: number; // Lower number = higher priority
  enabled?: boolean;
  severity?: 'showstopper' | 'flagger'; // Severity level for policy decisions
  createdAt?: string;
  updatedAt?: string;
}

export interface PIIMatch {
  value: string;
  dataType: PIIDataType;
  patternName: string;
  startIndex: number;
  endIndex: number;
  confidence: number; // 0-1 score based on validator
  severity?: 'showstopper' | 'flagger'; // Severity level from pattern
}

export interface PIIDetectionResult {
  matches: PIIMatch[];
  processingTime: number;
  patternsChecked: number;
}

interface RedactionPatternRow {
  id: string;
  name: string;
  data_type: string;
  pattern_regex: string;
  description: string | null;
  category: string | null;
  priority: number | null;
  severity: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

@Injectable()
export class PIIPatternService {
  private readonly logger = new Logger(PIIPatternService.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  // All patterns loaded from database - no hardcoded patterns
  private databasePatterns: PIIPattern[] = [];
  private patternsLoaded = false;

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {
    this.logger.log(
      `PIIPatternService initialized - all patterns loaded from database`,
    );
    this.logger.log(`DatabaseService injected: ${!!this.db}`);
  }

  /**
   * Detect PII in text using all enabled patterns
   */
  async detectPII(
    text: string,
    options: {
      dataTypes?: PIIDataType[];
      minConfidence?: number;
      maxMatches?: number;
    } = {},
  ): Promise<PIIDetectionResult> {
    const startTime = Date.now();
    const { dataTypes, minConfidence = 0.7, maxMatches = 100 } = options;

    // Load patterns from database on first use
    await this.ensurePatternsLoaded();

    // Get all enabled patterns from database
    const allPatterns = this.databasePatterns
      .filter((pattern) => pattern.enabled !== false)
      .filter((pattern) => !dataTypes || dataTypes.includes(pattern.dataType))
      .sort((a, b) => (a.priority || 50) - (b.priority || 50));

    const matches: PIIMatch[] = [];
    let patternsChecked = 0;

    for (const pattern of allPatterns) {
      if (matches.length >= maxMatches) break;

      patternsChecked++;

      // Reset regex to avoid issues with global flag
      pattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while (
        (match = pattern.pattern.exec(text)) !== null &&
        matches.length < maxMatches
      ) {
        const value = match[0];

        // Apply validator if present
        let confidence = 1.0;
        if (pattern.validator) {
          const isValid = pattern.validator(value);
          confidence = isValid ? 1.0 : 0.3;
        }

        // Skip matches below confidence threshold
        if (confidence < minConfidence) {
          continue;
        }

        // Check for overlapping matches (keep higher priority)
        const hasOverlap = matches.some((existingMatch) => {
          if (!match) return false;
          const start1 = match.index;
          const end1 = match.index + value.length;
          const start2 = existingMatch.startIndex;
          const end2 = existingMatch.endIndex;

          return start1 < end2 && end1 > start2;
        });

        if (!hasOverlap && match) {
          matches.push({
            value,
            dataType: pattern.dataType,
            patternName: pattern.name,
            startIndex: match.index,
            endIndex: match.index + value.length,
            confidence,
            severity: pattern.severity, // Use severity from the pattern itself
          });
        }
      }
    }

    // Sort matches by position in text
    matches.sort((a, b) => a.startIndex - b.startIndex);

    const processingTime = Date.now() - startTime;

    return {
      matches,
      processingTime,
      patternsChecked,
    };
  }

  /**
   * Add custom PII pattern
   */
  async addCustomPattern(pattern: Omit<PIIPattern, 'enabled'>): Promise<void> {
    try {
      // Validate pattern
      if (
        !pattern.name ||
        !pattern.pattern ||
        !pattern.dataType ||
        !pattern.severity
      ) {
        throw new Error(
          'Invalid pattern: name, pattern, dataType, and severity are required',
        );
      }

      // Test pattern compilation
      new RegExp(pattern.pattern.source, pattern.pattern.flags);

      // Save to database
      await this.db.from(null, 'redaction_patterns').insert({
        name: pattern.name,
        pattern_regex: pattern.pattern.source,
        replacement: `[${pattern.dataType.toUpperCase()}_REDACTED]`,
        description: pattern.description,
        category: 'pii_custom',
        priority: pattern.priority || 50,
        severity: pattern.severity,
        data_type: pattern.dataType,
      });

      // Reload patterns from database to include the new one
      await this.loadPatternsFromDatabase();

      this.logger.log(`Added custom PII pattern: ${pattern.name}`);
    } catch (error) {
      this.logger.error(
        `Failed to add custom pattern: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error((error as { message: string }).message);
    }
  }

  /**
   * Update custom PII pattern
   */
  async updateCustomPattern(
    id: string,
    updates: Partial<Omit<PIIPattern, 'enabled'>>,
  ): Promise<void> {
    try {
      // Build update object
      const updateData: Record<string, unknown> = {};

      if (updates.name !== undefined) {
        updateData.name = updates.name;
      }
      if (updates.pattern !== undefined) {
        // Test pattern compilation
        new RegExp(updates.pattern.source, updates.pattern.flags);
        updateData.pattern_regex = updates.pattern.source;
      }
      if (updates.description !== undefined) {
        updateData.description = updates.description;
      }
      if (updates.priority !== undefined) {
        updateData.priority = updates.priority;
      }
      if (updates.severity !== undefined) {
        updateData.severity = updates.severity;
      }
      if (updates.dataType !== undefined) {
        updateData.data_type = updates.dataType;
        updateData.replacement = `[${updates.dataType.toUpperCase()}_REDACTED]`;
      }
      if (updates.category !== undefined) {
        updateData.category = updates.category;
      }

      // Update in database - check if id is a UUID or a name
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        );
      const { error } = (await this.db
        .from(null, 'redaction_patterns')
        .update(updateData)
        .eq(isUUID ? 'id' : 'name', id)) as QueryResult<unknown>;

      if (error) {
        throw new Error((error as { message: string }).message);
      }

      // Reload patterns from database to include the updated one
      await this.loadPatternsFromDatabase();

      this.logger.log(`Updated custom PII pattern: ${id}`);
    } catch (error) {
      this.logger.error(
        `Failed to update custom pattern: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error((error as { message: string }).message);
    }
  }

  /**
   * Delete custom PII pattern
   */
  async deleteCustomPattern(id: string): Promise<void> {
    try {
      // Delete from database - check if id is a UUID or a name
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        );
      const { error } = (await this.db
        .from(null, 'redaction_patterns')
        .delete()
        .eq(isUUID ? 'id' : 'name', id)) as QueryResult<unknown>;

      if (error) {
        throw new Error((error as { message: string }).message);
      }

      // Reload patterns from database
      await this.loadPatternsFromDatabase();

      this.logger.log(`Deleted custom PII pattern: ${id}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete custom pattern: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error((error as { message: string }).message);
    }
  }

  /**
   * Get all available patterns (sync - may be empty if not loaded yet)
   */
  getAllPatterns(): PIIPattern[] {
    return [...this.databasePatterns];
  }

  /**
   * Get all available patterns (async - ensures patterns are loaded from DB)
   */
  async getAllPatternsAsync(): Promise<PIIPattern[]> {
    await this.ensurePatternsLoaded();
    return [...this.databasePatterns];
  }

  /**
   * Get patterns by data type
   */
  getPatternsByDataType(dataType: PIIDataType): PIIPattern[] {
    return this.getAllPatterns().filter(
      (pattern) => pattern.dataType === dataType,
    );
  }

  /**
   * Test a pattern against sample text
   */
  testPattern(
    pattern: PIIPattern,
    testText: string,
  ): {
    matches: string[];
    validMatches: string[];
    performance: number;
  } {
    const startTime = Date.now();

    pattern.pattern.lastIndex = 0;
    const matches: string[] = [];
    const validMatches: string[] = [];

    let match;
    while ((match = pattern.pattern.exec(testText)) !== null) {
      const value = match[0];
      matches.push(value);

      if (!pattern.validator || pattern.validator(value)) {
        validMatches.push(value);
      }
    }

    const performance = Date.now() - startTime;

    return { matches, validMatches, performance };
  }

  /**
   * Ensure patterns are loaded from database (only loads once)
   */
  private async ensurePatternsLoaded(): Promise<void> {
    if (this.patternsLoaded) {
      return;
    }

    await this.loadPatternsFromDatabase();
  }

  /**
   * Load all patterns from database (called when patterns are modified)
   */
  private async loadPatternsFromDatabase(): Promise<void> {
    try {
      const { data, error } = (await this.db
        .from(null, 'redaction_patterns')
        .select('*')
        .eq('is_active', true)) as QueryResult<unknown>;

      if (error) {
        throw new Error((error as { message: string }).message);
      }

      if (data) {
        // Load ALL patterns from database (built-in and custom)
        this.databasePatterns = (data as RedactionPatternRow[]).map((row) => ({
          id: row.id,
          name: row.name,
          dataType: row.data_type as PIIDataType,
          pattern: new RegExp(row.pattern_regex, 'g'),
          description: row.description || '',
          category: row.category || 'pii_custom',
          priority: row.priority || 50,
          enabled: true,
          severity: row.severity as 'showstopper' | 'flagger',
          createdAt: row.created_at || undefined,
          updatedAt: row.updated_at || undefined,
          validator: undefined, // No hardcoded validators - rely on regex patterns only
        }));

        this.patternsLoaded = true;
        this.logger.debug(
          `Loaded ${this.databasePatterns.length} PII patterns from database`,
        );

        // Log pattern breakdown by severity
        const bySeverity = this.databasePatterns.reduce(
          (acc, p) => {
            acc[p.severity || 'unknown'] =
              (acc[p.severity || 'unknown'] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

        this.logger.debug(`Pattern breakdown: ${JSON.stringify(bySeverity)}`);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to load patterns from database: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Force reload of patterns from database (used when patterns are modified externally)
   */
  async forceReload(): Promise<void> {
    await this.loadPatternsFromDatabase();
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalPatterns: number;
    enabledPatterns: number;
    showstopperPatterns: number;
    flaggerPatterns: number;
    patternsLoaded: boolean;
  } {
    const allPatterns = this.getAllPatterns();

    return {
      totalPatterns: allPatterns.length,
      enabledPatterns: allPatterns.filter((p) => p.enabled !== false).length,
      showstopperPatterns: allPatterns.filter(
        (p) => p.severity === 'showstopper',
      ).length,
      flaggerPatterns: allPatterns.filter((p) => p.severity === 'flagger')
        .length,
      patternsLoaded: this.patternsLoaded,
    };
  }
}
