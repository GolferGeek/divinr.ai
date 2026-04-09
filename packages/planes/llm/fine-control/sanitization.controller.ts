import {
  Controller,
  Inject,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Logger,
} from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService } from '@/database';
import { PseudonymizationService } from './pseudonymization.service';
import {
  PIIPatternService,
  PIIDataType,
  PIIDetectionResult,
} from './pii-pattern.service';

// Interface for pattern service stats
interface PatternServiceStats {
  totalPatterns: number;
  enabledPatterns: number;
  showstopperPatterns: number;
  flaggerPatterns: number;
  patternsLoaded: boolean;
  builtInPatterns?: number;
  customPatterns?: number;
}

// Interface for dictionary entries from database
interface DictionaryEntry {
  original_value: string | null;
  pseudonym: string | null;
  data_type: string | null;
  category: string | null;
}

// Interface for database insert results
interface DatabaseInsertResult {
  id: string;
  category?: string;
  data_type?: string;
}

// Interface for pseudonym mapping rows from database
interface PseudonymMappingRow {
  id: string;
  original_value: string | null;
  original_hash: string;
  pseudonym: string;
  data_type: string;
  context: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

@Controller('llm/sanitization')
export class SanitizationController {
  private readonly logger = new Logger(SanitizationController.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(PseudonymizationService) private readonly pseudonymizationService: PseudonymizationService,
    @Inject(PIIPatternService) private readonly piiPatternService: PIIPatternService,
  ) {}

  /**
   * Basic stats endpoint consumed by the web admin dashboard
   */
  @Get('stats')
  async getStats() {
    try {
      const patternStats = await this.pseudonymizationService.getStats();
      const stats =
        patternStats.patternServiceStats as unknown as PatternServiceStats;

      // Database query
      const { count: dictCount } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .select('id', { count: 'exact', head: true })) as {
        data: Record<string, unknown> | Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
        count: number | null;
      };

      return {
        sanitizationStats: {
          productionMode: patternStats.productionMode,
          pseudonymizationStats: {
            patternServiceStats: {
              totalPatterns: stats.totalPatterns || 0,
              builtInPatterns: stats.builtInPatterns || 0,
              customPatterns: stats.customPatterns || 0,
              enabledPatterns: stats.enabledPatterns || 0,
              lastRefresh: new Date().toISOString(),
            },
          },
          redactionStats: {
            totalPatterns: stats.totalPatterns || 0,
            customPatterns: stats.customPatterns || 0,
          },
          verboseLogging: false,
        },
        databaseStats: {
          totalOperations: 0,
          dictionaries: dictCount || 0,
        },
        cacheStats: {
          size: 0,
        },
      };
    } catch (error) {
      this.logger.error(
        'Failed to get sanitization stats',
        error instanceof Error ? error : String(error),
      );
      // Provide minimal safe structure
      return {
        sanitizationStats: {
          productionMode: false,
          pseudonymizationStats: {
            patternServiceStats: {
              totalPatterns: 0,
              builtInPatterns: 0,
              customPatterns: 0,
              enabledPatterns: 0,
              lastRefresh: new Date().toISOString(),
            },
          },
          redactionStats: { totalPatterns: 0, customPatterns: 0 },
          verboseLogging: false,
        },
        databaseStats: { totalOperations: 0, dictionaries: 0 },
        cacheStats: { size: 0 },
      };
    }
  }

  /**
   * Return effective PII patterns (built-in + any custom)
   */
  @Get('pii/patterns')
  async getPIIPatterns() {
    const patterns = await this.pseudonymizationService.getPIIPatternsAsync();
    // Convert RegExp patterns to strings for JSON serialization
    const serializedPatterns = patterns.map((p) => ({
      id: p.id || p.name, // Use ID if available, fallback to name
      name: p.name,
      pattern: p.pattern.source, // Convert RegExp to string
      dataType: p.dataType,
      description: p.description,
      priority: p.priority,
      enabled: p.enabled,
      severity: p.severity,
      category: p.category,
      isBuiltIn: p.category === 'pii_builtin',
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
    return { patterns: serializedPatterns };
  }

  /**
   * Create a new custom PII pattern
   */
  @Post('pii/patterns')
  async createPIIPattern(
    @Body()
    body: {
      name: string;
      pattern: string;
      regex?: string;
      dataType: string;
      description: string;
      priority?: number | string;
      category?: string;
      severity?: 'showstopper' | 'flagger';
      enabled?: boolean;
    },
  ) {
    try {
      // Handle both 'pattern' and 'regex' field names from frontend
      const patternString = body.pattern || body.regex;
      if (!patternString) {
        return {
          success: false,
          error: 'Pattern or regex field is required',
        };
      }

      // Convert priority string to number if needed
      let priority: number | undefined;
      if (body.priority) {
        if (typeof body.priority === 'string') {
          const priorityMap: Record<string, number> = {
            high: 10,
            medium: 50,
            low: 90,
          };
          priority = priorityMap[body.priority] || 50;
        } else {
          priority = body.priority;
        }
      }

      const pattern = {
        name: body.name,
        pattern: new RegExp(patternString, 'g'),
        dataType: body.dataType as PIIDataType,
        description: body.description,
        priority,
        severity: body.severity,
      };

      await this.pseudonymizationService.addPIIPattern(pattern);

      // Return the created pattern
      const updatedPatterns = this.pseudonymizationService.getPIIPatterns();
      const createdPattern = updatedPatterns.find((p) => p.name === body.name);

      return {
        success: true,
        pattern: createdPattern
          ? {
              id: body.name, // Use name as ID for now
              name: createdPattern.name,
              pattern: patternString,
              dataType: createdPattern.dataType,
              description: createdPattern.description,
              priority: createdPattern.priority,
              enabled: createdPattern.enabled,
              category: body.category,
              severity: createdPattern.severity,
            }
          : null,
      };
    } catch (error) {
      this.logger.error(
        'Failed to create PII pattern',
        error instanceof Error ? error : String(error),
      );
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to create pattern',
      };
    }
  }

  /**
   * Update an existing PII pattern
   */
  @Put('pii/patterns/:id')
  async updatePIIPattern(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      pattern?: string;
      regex?: string;
      dataType?: string;
      description?: string;
      priority?: number | string;
      category?: string;
      severity?: 'showstopper' | 'flagger';
      enabled?: boolean;
    },
  ) {
    try {
      const updates: Record<string, unknown> = {};

      if (body.name !== undefined) {
        updates.name = body.name;
      }
      if (body.pattern || body.regex) {
        const patternString = body.pattern || body.regex;
        updates.pattern = new RegExp(patternString!, 'g');
      }
      if (body.dataType !== undefined) {
        updates.dataType = body.dataType;
      }
      if (body.description !== undefined) {
        updates.description = body.description;
      }
      if (body.priority !== undefined) {
        if (typeof body.priority === 'string') {
          const priorityMap: Record<string, number> = {
            high: 10,
            medium: 50,
            low: 90,
          };
          updates.priority = priorityMap[body.priority] || 50;
        } else {
          updates.priority = body.priority;
        }
      }
      if (body.severity !== undefined) {
        updates.severity = body.severity;
      }
      if (body.category !== undefined) {
        updates.category = body.category;
      }

      await this.pseudonymizationService.updatePIIPattern(id, updates);

      // Return the updated pattern (reload from DB to ensure freshness)
      const updatedPatterns =
        await this.pseudonymizationService.getPIIPatternsAsync();
      const updatedPattern = updatedPatterns.find(
        (p) => p.id === id || p.name === id || p.name === body.name,
      );

      return {
        success: true,
        pattern: updatedPattern
          ? {
              id: updatedPattern.id || updatedPattern.name,
              name: updatedPattern.name,
              pattern: updatedPattern.pattern.source,
              dataType: updatedPattern.dataType,
              description: updatedPattern.description,
              priority: updatedPattern.priority,
              enabled: updatedPattern.enabled,
              category: updatedPattern.category,
              severity: updatedPattern.severity,
              createdAt: updatedPattern.createdAt,
              updatedAt: updatedPattern.updatedAt,
            }
          : null,
      };
    } catch (error) {
      this.logger.error(
        'Failed to update PII pattern',
        error instanceof Error ? error : String(error),
      );
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to update pattern',
      };
    }
  }

  /**
   * Delete a PII pattern
   */
  @Delete('pii/patterns/:id')
  async deletePIIPattern(@Param('id') id: string) {
    try {
      await this.pseudonymizationService.deletePIIPattern(id);

      return {
        success: true,
        message: `Pattern ${id} deleted successfully`,
      };
    } catch (error) {
      this.logger.error(
        'Failed to delete PII pattern',
        error instanceof Error ? error : String(error),
      );
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to delete pattern',
      };
    }
  }

  /**
   * Sanitize text (full sanitization with detection, redaction, and/or pseudonymization)
   */
  @Post('sanitize')
  async sanitizeText(
    @Body()
    body: {
      text: string;
      enableRedaction?: boolean;
      enablePseudonymization?: boolean;
      context?: string;
    },
  ) {
    try {
      const startTime = Date.now();

      // Get PII pattern service to detect PII
      const detectionResult: PIIDetectionResult =
        await this.piiPatternService.detectPII(body.text, {
          minConfidence: 0.8,
          maxMatches: 100,
        });

      // Also check dictionary for known values (names, usernames, etc.)
      // Database query
      const { data: dictionaryEntries } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .select('original_value, pseudonym, data_type, category')
        .eq('is_active', true)) as {
        data: unknown;
        error: { message: string; code?: string } | null;
      };

      const typedDictionaryEntries = (dictionaryEntries ||
        []) as unknown as DictionaryEntry[];

      if (typedDictionaryEntries.length > 0) {
        for (const entry of typedDictionaryEntries) {
          if (
            entry.original_value &&
            body.text.includes(entry.original_value)
          ) {
            const startIndex = body.text.indexOf(entry.original_value);
            // Add dictionary match to detection results
            detectionResult.matches.push({
              value: entry.original_value,
              dataType: (entry.data_type as PIIDataType) || 'custom',
              patternName: `${entry.category || 'Dictionary'} - ${entry.data_type || 'Custom'}`,
              startIndex,
              endIndex: startIndex + entry.original_value.length,
              confidence: 1.0,
              severity: 'flagger', // Dictionary items are flaggers, not showstoppers
            });
          }
        }
      }

      // Apply redaction if requested (simple replacement with [REDACTED])
      let sanitizedText = body.text;
      let redactionApplied = false;

      if (body.enableRedaction && detectionResult.matches.length > 0) {
        sanitizedText = body.text;
        // Sort matches by position in reverse to avoid index issues
        const sortedMatches = [...detectionResult.matches].sort(
          (a, b) => b.startIndex - a.startIndex,
        );

        for (const match of sortedMatches) {
          const replacement = `[${match.dataType.toUpperCase()}_REDACTED]`;
          sanitizedText =
            sanitizedText.substring(0, match.startIndex) +
            replacement +
            sanitizedText.substring(match.endIndex);
        }
        redactionApplied = true;
      }

      // Apply pseudonymization if requested (only if redaction wasn't applied - they're mutually exclusive)
      let pseudonymizationApplied = false;
      if (
        body.enablePseudonymization &&
        !redactionApplied &&
        detectionResult.matches.length > 0
      ) {
        const pseudonymResult =
          await this.pseudonymizationService.pseudonymizeText(body.text, {
            context: body.context,
          });
        sanitizedText = pseudonymResult.pseudonymizedText;
        pseudonymizationApplied = true;
      }

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        sanitizedText,
        originalLength: body.text.length,
        sanitizedLength: sanitizedText.length,
        processingTime,
        redactionApplied,
        pseudonymizationApplied,
        detectionResult: {
          matches: detectionResult.matches,
          processingTime: detectionResult.processingTime,
          patternsChecked: detectionResult.patternsChecked,
          sanitizedText,
          originalText: body.text,
        },
      };
    } catch (error) {
      this.logger.error(
        'Failed to sanitize text',
        error instanceof Error ? error : String(error),
      );
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to sanitize text',
      };
    }
  }

  /**
   * Test PII detection on provided text
   */
  @Post('pii/test')
  async testPIIDetection(
    @Body()
    body: {
      text: string;
      enableRedaction?: boolean;
      enablePseudonymization?: boolean;
      context?: string;
    },
  ) {
    try {
      const startTime = Date.now();

      // Get PII pattern service to detect PII
      const detectionResult: PIIDetectionResult =
        await this.piiPatternService.detectPII(body.text, {
          minConfidence: 0.8,
          maxMatches: 100,
        });

      // Also check dictionary for known values (names, usernames, etc.)
      // Database query
      const { data: dictionaryEntries } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .select('original_value, pseudonym, data_type, category')
        .eq('is_active', true)) as {
        data: unknown;
        error: { message: string; code?: string } | null;
      };

      const typedDictionaryEntries = (dictionaryEntries ||
        []) as unknown as DictionaryEntry[];

      if (typedDictionaryEntries.length > 0) {
        for (const entry of typedDictionaryEntries) {
          if (
            entry.original_value &&
            body.text.includes(entry.original_value)
          ) {
            const startIndex = body.text.indexOf(entry.original_value);
            // Add dictionary match to detection results
            detectionResult.matches.push({
              value: entry.original_value,
              dataType: (entry.data_type as PIIDataType) || 'custom',
              patternName: `${entry.category || 'Dictionary'} - ${entry.data_type || 'Custom'}`,
              startIndex,
              endIndex: startIndex + entry.original_value.length,
              confidence: 1.0,
              severity: 'flagger', // Dictionary items are flaggers, not showstoppers
            });
          }
        }
      }

      // Apply redaction if requested (simple replacement with [REDACTED])
      let sanitizedText = body.text;
      let redactionApplied = false;

      if (body.enableRedaction && detectionResult.matches.length > 0) {
        sanitizedText = body.text;
        // Sort matches by position in reverse to avoid index issues
        const sortedMatches = [...detectionResult.matches].sort(
          (a, b) => b.startIndex - a.startIndex,
        );

        for (const match of sortedMatches) {
          const replacement = `[${match.dataType.toUpperCase()}_REDACTED]`;
          sanitizedText =
            sanitizedText.substring(0, match.startIndex) +
            replacement +
            sanitizedText.substring(match.endIndex);
        }
        redactionApplied = true;
      }

      // Apply pseudonymization if requested (only if redaction wasn't applied - they're mutually exclusive)
      let pseudonymizationApplied = false;
      if (
        body.enablePseudonymization &&
        !redactionApplied &&
        detectionResult.matches.length > 0
      ) {
        const pseudonymResult =
          await this.pseudonymizationService.pseudonymizeText(body.text, {
            context: body.context,
          });
        sanitizedText = pseudonymResult.pseudonymizedText;
        pseudonymizationApplied = true;
      }

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        sanitizedText,
        originalLength: body.text.length,
        sanitizedLength: sanitizedText.length,
        processingTime,
        redactionApplied,
        pseudonymizationApplied,
        detectionResult: {
          matches: detectionResult.matches,
          processingTime: detectionResult.processingTime,
          patternsChecked: detectionResult.patternsChecked,
          sanitizedText,
          originalText: body.text,
        },
      };
    } catch (error) {
      this.logger.error(
        'Failed to test PII detection',
        error instanceof Error ? error : String(error),
      );
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to test PII detection',
      };
    }
  }

  /**
   * Get filtered and paginated pseudonym mappings
   */
  @Get('pseudonym/mappings')
  async getPseudonymMappings(
    @Query('dataType') dataType?: string,
    @Query('context') context?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    try {
      // Database query
      let query = this.db
        .from(null, 'pseudonym_mappings')
        .select('*', { count: 'exact' });

      // Apply filters
      if (dataType && dataType !== 'all') {
        query = query.eq('data_type', dataType);
      }

      if (context) {
        query = query.ilike('context', `%${context}%`);
      }

      // Apply pagination
      const limit = limitStr ? parseInt(limitStr, 10) : 50;
      const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

      // Validate pagination params
      const safeLimit = isNaN(limit) || limit < 1 ? 50 : Math.min(limit, 100);
      const safeOffset = isNaN(offset) || offset < 0 ? 0 : offset;

      query = query
        .range(safeOffset, safeOffset + safeLimit - 1)
        .order('usage_count', { ascending: false });

      const { data, count, error } = (await query) as {
        data: unknown;
        count: number | null;
        error: { message: string; code?: string } | null;
      };

      if (error) {
        throw new Error(error.message);
      }

      // Map snake_case database fields to camelCase response objects
      const mappings = ((data as PseudonymMappingRow[]) || []).map((row) => ({
        id: row.id,
        originalValue: row.original_value, // Note: usually this is hashed/redacted in DB, but mapping requires it for strict typing
        originalHash: row.original_hash,
        pseudonym: row.pseudonym,
        dataType: row.data_type,
        context: row.context,
        usageCount: row.usage_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastUsedAt: row.last_used_at,
      }));

      return {
        success: true,
        mappings,
        total: count || 0,
      };
    } catch (error) {
      this.logger.error(
        'Failed to get pseudonym mappings',
        error instanceof Error ? error : String(error),
      );
      return {
        success: false,
        mappings: [],
        total: 0,
        error:
          error instanceof Error ? error.message : 'Failed to fetch mappings',
      };
    }
  }

  /**
   * Get pseudonym mapping statistics
   */
  @Get('pseudonym/stats')
  async getPseudonymStats() {
    try {
      // Database query

      // Get total mappings count
      const { count: totalMappings } = (await this.db
        .from(null, 'pseudonym_mappings')
        .select('id', { count: 'exact', head: true })) as {
        data: Record<string, unknown> | Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
        count: number | null;
      };

      // Get mappings grouped by data type
      const { data: mappingsByTypeData } = (await this.db
        .from(null, 'pseudonym_mappings')
        .select('data_type')) as {
        data: Record<string, unknown> | Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
      };

      // Count mappings by type
      const mappingsByType: Record<string, number> = {};
      const typedMappingsByTypeData = (mappingsByTypeData || []) as Array<{
        data_type: string;
      }>;
      if (typedMappingsByTypeData.length > 0) {
        for (const row of typedMappingsByTypeData) {
          const dataType = row.data_type || 'custom';
          mappingsByType[dataType] = (mappingsByType[dataType] || 0) + 1;
        }
      }

      // Get total usage count
      const { data: usageData } = (await this.db
        .from(null, 'pseudonym_mappings')
        .select('usage_count')) as {
        data: Record<string, unknown> | Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
      };

      let totalUsage = 0;
      const typedUsageData = (usageData || []) as Array<{
        usage_count: number;
      }>;
      if (typedUsageData.length > 0) {
        totalUsage = typedUsageData.reduce(
          (sum: number, row: { usage_count: number }) =>
            sum + (row.usage_count || 0),
          0,
        );
      }

      // Calculate average usage per mapping
      const averageUsagePerMapping =
        totalMappings && totalMappings > 0 ? totalUsage / totalMappings : 0;

      // Get recent activity (last 24h, 7d, 30d)
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const { count: last24hCount } = (await this.db
        .from(null, 'pseudonym_mappings')
        .select('id', { count: 'exact', head: true })
        .gte('last_used_at', last24h.toISOString())) as {
        data: Record<string, unknown> | Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
        count: number | null;
      };

      const { count: last7dCount } = (await this.db
        .from(null, 'pseudonym_mappings')
        .select('id', { count: 'exact', head: true })
        .gte('last_used_at', last7d.toISOString())) as {
        data: Record<string, unknown> | Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
        count: number | null;
      };

      const { count: last30dCount } = (await this.db
        .from(null, 'pseudonym_mappings')
        .select('id', { count: 'exact', head: true })
        .gte('last_used_at', last30d.toISOString())) as {
        data: Record<string, unknown> | Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
        count: number | null;
      };

      return {
        success: true,
        stats: {
          totalMappings: totalMappings || 0,
          mappingsByType,
          totalUsage,
          averageUsagePerMapping:
            Math.round(averageUsagePerMapping * 100) / 100,
          recentActivity: {
            last24h: last24hCount || 0,
            last7d: last7dCount || 0,
            last30d: last30dCount || 0,
          },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        'Failed to get pseudonym stats',
        error instanceof Error ? error : String(error),
      );
      // Return minimal safe structure
      return {
        success: false,
        stats: {
          totalMappings: 0,
          mappingsByType: {},
          totalUsage: 0,
          averageUsagePerMapping: 0,
          recentActivity: {
            last24h: 0,
            last7d: 0,
            last30d: 0,
          },
        },
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Failed to get stats',
      };
    }
  }

  /**
   * Return pseudonym dictionaries grouped for the UI
   */
  @Get('pseudonym/dictionaries')
  async getPseudonymDictionaries() {
    // Database query
    const { data, error } = (await this.db
      .from(null, 'pseudonym_dictionaries')
      .select(
        'id, category, data_type, original_value, pseudonym, is_active, created_at',
      )) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error('Failed to load pseudonym dictionaries', error);
      return { dictionaries: [] };
    }

    // Group rows by category + data_type to fit frontend PseudonymDictionaryEntry shape
    const groups: Record<
      string,
      {
        id: string;
        category: string;
        dataType: string;
        isActive: boolean;
        words: string[];
        createdAt?: string;
      }
    > = {};
    const typedData = (data || []) as Array<{
      id: string;
      category: string | null;
      data_type: string | null;
      original_value: string | null;
      pseudonym: string | null;
      is_active: boolean | null;
      created_at: string | null;
    }>;
    for (const typedRow of typedData) {
      const key = `${typedRow.category || 'uncategorized'}::${typedRow.data_type || 'custom'}::${typedRow.is_active ? '1' : '0'}`;
      if (!groups[key]) {
        groups[key] = {
          id: typedRow.id,
          category: typedRow.category || 'uncategorized',
          dataType: typedRow.data_type || 'custom',
          isActive: !!typedRow.is_active,
          words: [],
          createdAt: typedRow.created_at || undefined,
        };
      }
      // Show both original value and pseudonym
      if (typedRow.original_value && typedRow.pseudonym && groups[key]) {
        groups[key].words.push(
          `${typedRow.original_value} → ${typedRow.pseudonym}`,
        );
      } else if (typedRow.original_value && groups[key]) {
        groups[key].words.push(typedRow.original_value);
      } else if (typedRow.pseudonym && groups[key]) {
        groups[key].words.push(typedRow.pseudonym);
      }
    }

    const dictionaries = Object.values(groups);
    return { dictionaries };
  }

  /**
   * Get raw dictionary data (for export)
   */
  private async getRawDictionaries() {
    // Database query
    const { data, error } = (await this.db
      .from(null, 'pseudonym_dictionaries')
      .select(
        'id, category, data_type, original_value, pseudonym, is_active, created_at',
      )) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error('Failed to load pseudonym dictionaries', error);
      return [];
    }

    // Group by category + data_type, keep both original values and pseudonyms
    const groups: Record<
      string,
      {
        category: string;
        dataType: string;
        isActive: boolean;
        entries: Array<{ originalValue: string; pseudonym: string }>;
      }
    > = {};

    const typedRawData = (data || []) as Array<{
      id: string;
      category: string | null;
      data_type: string | null;
      original_value: string | null;
      pseudonym: string | null;
      is_active: boolean | null;
      created_at: string | null;
    }>;
    for (const typedRow of typedRawData) {
      const key = `${typedRow.category || 'uncategorized'}::${typedRow.data_type || 'custom'}::${typedRow.is_active ? '1' : '0'}`;

      if (!groups[key]) {
        groups[key] = {
          category: typedRow.category || 'uncategorized',
          dataType: typedRow.data_type || 'custom',
          isActive: !!typedRow.is_active,
          entries: [],
        };
      }

      // Include both original value and pseudonym
      if (typedRow.original_value && typedRow.pseudonym && groups[key]) {
        groups[key].entries.push({
          originalValue: typedRow.original_value,
          pseudonym: typedRow.pseudonym,
        });
      }
    }

    return Object.values(groups);
  }

  /**
   * Create a new pseudonym dictionary entry
   */
  @Post('pseudonym/dictionaries')
  async createPseudonymDictionary(
    @Body()
    body: {
      category: string;
      dataType: string;
      words?: string[]; // Old format - for backward compatibility
      entries?: Array<{ originalValue: string; pseudonym?: string }>; // New format
      description?: string;
      isActive?: boolean;
    },
  ) {
    // Database query

    // Support both old format (words) and new format (entries)
    let entriesToInsert;

    if (body.entries) {
      // New format: entries with optional pseudonyms
      entriesToInsert = body.entries.map((entry) => ({
        category: body.category,
        data_type: body.dataType,
        original_value: entry.originalValue,
        pseudonym:
          entry.pseudonym ||
          this.generatePseudonym(body.category, entry.originalValue),
        is_active: body.isActive ?? true,
      }));
    } else if (body.words) {
      // Old format: just words, auto-generate pseudonyms
      entriesToInsert = body.words.map((word) => ({
        category: body.category,
        data_type: body.dataType,
        original_value: word,
        pseudonym: this.generatePseudonym(body.category, word),
        is_active: body.isActive ?? true,
      }));
    } else {
      throw new Error('Either words or entries must be provided');
    }

    const { data, error } = (await this.db
      .from(null, 'pseudonym_dictionaries')
      .insert(entriesToInsert)
      .select()) as {
      data: unknown;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error('Failed to create pseudonym dictionary', error);
      throw new Error(`Failed to create dictionary: ${error.message}`);
    }

    const typedData = (data || []) as unknown as DatabaseInsertResult[];

    return {
      success: true,
      dictionary: {
        id: typedData[0]?.id || '',
        category: body.category,
        dataType: body.dataType,
        entries:
          body.entries ||
          body.words?.map((w) => ({
            originalValue: w,
            pseudonym: this.generatePseudonym(body.category, w),
          })),
        isActive: body.isActive ?? true,
      },
    };
  }

  /**
   * Update a pseudonym dictionary entry
   */
  @Put('pseudonym/dictionaries/:id')
  async updatePseudonymDictionary(
    @Param('id') id: string,
    @Body()
    body: {
      category?: string;
      dataType?: string;
      words?: string[]; // Old format
      entries?: Array<{ originalValue: string; pseudonym?: string }>; // New format
      isActive?: boolean;
    },
  ) {
    // Database query

    // If words/entries are being updated, we need to delete old entries and create new ones
    if (body.words || body.entries) {
      // Get the current entry to know its category/data_type
      const { data: existing } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .select('category, data_type')
        .eq('id', id)
        .single()) as {
        data: Record<string, unknown> | Record<string, unknown>[] | null;
        error: { message: string; code?: string } | null;
      };

      const typedExisting = existing as {
        category: string;
        data_type: string;
      } | null;

      if (!typedExisting) {
        throw new Error('Dictionary not found');
      }

      const category = body.category || typedExisting.category;
      const dataType = body.dataType || typedExisting.data_type;

      // Delete all entries with same category and data_type
      await this.db
        .from(null, 'pseudonym_dictionaries')
        .delete()
        .eq('category', typedExisting.category)
        .eq('data_type', typedExisting.data_type);

      // Insert new entries
      let entriesToInsert;

      if (body.entries) {
        // New format: entries with optional pseudonyms
        entriesToInsert = body.entries.map((entry) => ({
          category,
          data_type: dataType,
          original_value: entry.originalValue,
          pseudonym:
            entry.pseudonym ||
            this.generatePseudonym(category, entry.originalValue),
          is_active: body.isActive ?? true,
        }));
      } else if (body.words) {
        // Old format: just words, auto-generate pseudonyms
        entriesToInsert = body.words.map((word) => ({
          category,
          data_type: dataType,
          original_value: word,
          pseudonym: this.generatePseudonym(category, word),
          is_active: body.isActive ?? true,
        }));
      } else {
        throw new Error('Either words or entries must be provided');
      }

      const { data, error } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .insert(entriesToInsert)
        .select()) as {
        data: unknown;
        error: { message: string; code?: string } | null;
      };

      if (error) {
        this.logger.error('Failed to update pseudonym dictionary', error);
        throw new Error(`Failed to update dictionary: ${error.message}`);
      }

      const typedData = (data || []) as unknown as DatabaseInsertResult[];

      return {
        success: true,
        dictionary: {
          id: typedData[0]?.id || '',
          category,
          dataType,
          entries:
            body.entries ||
            body.words?.map((w) => ({
              originalValue: w,
              pseudonym: this.generatePseudonym(category, w),
            })),
          isActive: body.isActive ?? true,
        },
      };
    } else {
      // Just update isActive status
      const result = await this.db
        .from(null, 'pseudonym_dictionaries')
        .update({ is_active: body.isActive })
        .eq('id', id)
        .select()
        .single();

      if (result.error) {
        this.logger.error(
          'Failed to update pseudonym dictionary',
          result.error,
        );
        throw new Error(`Failed to update dictionary: ${result.error.message}`);
      }

      const typedData = result.data as DatabaseInsertResult | null;

      return { success: true, dictionary: typedData };
    }
  }

  /**
   * Delete a pseudonym dictionary entry
   */
  @Delete('pseudonym/dictionaries/:id')
  async deletePseudonymDictionary(@Param('id') id: string) {
    // Database query

    // Get the entry to know its category/data_type
    const { data: existing } = (await this.db
      .from(null, 'pseudonym_dictionaries')
      .select('category, data_type')
      .eq('id', id)
      .single()) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    const typedExisting = existing as {
      category: string;
      data_type: string;
    } | null;

    if (!typedExisting) {
      throw new Error('Dictionary not found');
    }

    // Delete all entries with same category and data_type
    const { error } = (await this.db
      .from(null, 'pseudonym_dictionaries')
      .delete()
      .eq('category', typedExisting.category)
      .eq('data_type', typedExisting.data_type)) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error('Failed to delete pseudonym dictionary', error);
      throw new Error(`Failed to delete dictionary: ${error.message}`);
    }

    return { success: true };
  }

  /**
   * Import pseudonym dictionaries from JSON
   */
  @Post('pseudonym/dictionaries/import')
  async importPseudonymDictionaries(
    @Body()
    body: {
      dictionaries: Array<{
        category: string;
        dataType: string;
        words?: string[]; // Old format
        entries?: Array<{ originalValue: string; pseudonym?: string }>; // New format
        description?: string;
        isActive?: boolean;
      }>;
    },
  ) {
    // Database query
    const errors: string[] = [];
    let imported = 0;

    for (const dict of body.dictionaries) {
      try {
        let entriesToInsert;

        if (dict.entries) {
          // New format: entries with optional pseudonyms
          entriesToInsert = dict.entries.map((entry) => ({
            category: dict.category,
            data_type: dict.dataType,
            original_value: entry.originalValue,
            pseudonym:
              entry.pseudonym ||
              this.generatePseudonym(dict.category, entry.originalValue),
            is_active: dict.isActive ?? true,
          }));
        } else if (dict.words) {
          // Old format: just words, auto-generate pseudonyms
          entriesToInsert = dict.words.map((word) => ({
            category: dict.category,
            data_type: dict.dataType,
            original_value: word,
            pseudonym: this.generatePseudonym(dict.category, word),
            is_active: dict.isActive ?? true,
          }));
        } else {
          errors.push(
            `${dict.category}: Either words or entries must be provided`,
          );
          continue;
        }

        const { error } = (await this.db
          .from(null, 'pseudonym_dictionaries')
          .insert(entriesToInsert)) as {
          data: Record<string, unknown> | Record<string, unknown>[] | null;
          error: { message: string; code?: string } | null;
        };

        if (error) {
          errors.push(`${dict.category}: ${error.message}`);
        } else {
          imported++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`${dict.category}: ${message}`);
      }
    }

    return {
      success: errors.length === 0,
      imported,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Export all pseudonym dictionaries to JSON (importable format)
   */
  @Get('pseudonym/dictionaries/export')
  async exportPseudonymDictionaries() {
    const dictionaries = await this.getRawDictionaries();
    return {
      dictionaries,
      exportedAt: new Date().toISOString(),
      version: '1.0',
    };
  }

  /**
   * Generate a pseudonym for a value
   */
  private generatePseudonym(category: string, value: string): string {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const prefix =
      category === 'person'
        ? 'person'
        : category === 'business'
          ? 'company'
          : category.toLowerCase();
    return `@${prefix}_${sanitized}`;
  }
}
