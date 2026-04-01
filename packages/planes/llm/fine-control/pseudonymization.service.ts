import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import {
  PIIPatternService,
  PIIDataType,
  PIIPattern,
} from './pii-pattern.service';
import { createHash, randomBytes } from 'crypto';

export interface PseudonymResult {
  originalValue: string;
  pseudonym: string;
  dataType: PIIDataType;
  isNew: boolean;
  context?: string;
}

export interface PseudonymizationResult {
  originalText: string;
  pseudonymizedText: string;
  pseudonyms: PseudonymResult[];
  processingTime: number;
}

interface DictionaryEntry {
  original_value: string;
  pseudonym: string;
  data_type: string;
}

@Injectable()
export class PseudonymizationService {
  private readonly logger = new Logger(PseudonymizationService.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly piiPatternService: PIIPatternService,
  ) {
    this.logger.log(
      `PseudonymizationService initialized (production: ${this.isProduction})`,
    );
  }

  /**
   * Generate or retrieve a consistent pseudonym for a given value
   */
  async generatePseudonym(
    originalValue: string,
    dataType: PIIDataType,
    context?: string,
  ): Promise<PseudonymResult> {
    const startTime = Date.now();

    try {
      // Create hash of original value for consistent lookup
      const originalHash = this.hashValue(originalValue);

      // Check if pseudonym already exists
      const existingPseudonym =
        await this.lookupExistingPseudonym(originalHash);
      if (existingPseudonym) {
        // Update usage count
        await this.incrementPseudonymUsage(existingPseudonym.id);

        return {
          originalValue,
          pseudonym: existingPseudonym.pseudonym,
          dataType,
          isNew: false,
          context,
        };
      }

      // Generate new pseudonym
      const pseudonym = await this.createNewPseudonym(dataType, originalValue);

      // Store in database
      await this.storePseudonymMapping(
        originalHash,
        pseudonym,
        dataType,
        context,
      );

      // Log audit trail
      await this.logPseudonymOperation(
        'pseudonymize',
        dataType,
        Date.now() - startTime,
      );

      return {
        originalValue,
        pseudonym,
        dataType,
        isNew: true,
        context,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate pseudonym: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error((error as { message: string }).message);
    }
  }

  /**
   * Pseudonymize all PII in a text block
   */
  async pseudonymizeText(
    text: string,
    options?: {
      context?: string;
      dataTypes?: PIIDataType[];
    },
  ): Promise<PseudonymizationResult> {
    const startTime = Date.now();
    let processedText = text;
    const pseudonyms: PseudonymResult[] = [];

    try {
      // STEP 1: Check dictionary for known values (names, usernames, etc.)
      // Database query
      const { data: rawEntries } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .select('original_value, pseudonym, data_type')
        .eq('is_active', true)) as QueryResult<unknown>;
      const dictionaryEntries = (rawEntries || []) as DictionaryEntry[];

      if (dictionaryEntries.length > 0) {
        // Sort by length descending to match longer strings first (e.g., "Matt Weber" before "Matt")
        const sortedEntries = dictionaryEntries.sort(
          (a, b) =>
            (b.original_value?.length || 0) - (a.original_value?.length || 0),
        );

        for (const entry of sortedEntries) {
          if (
            entry.original_value &&
            processedText.includes(entry.original_value)
          ) {
            // Replace all occurrences (case-sensitive)
            const regex = new RegExp(
              entry.original_value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              'g',
            );
            processedText = processedText.replace(regex, entry.pseudonym);

            pseudonyms.push({
              originalValue: entry.original_value,
              pseudonym: entry.pseudonym,
              dataType: entry.data_type as PIIDataType,
              isNew: false,
              context: options?.context,
            });
          }
        }
      }

      // STEP 2: Use PIIPatternService to detect PII in text (SSN, Email, etc.)
      const detectionResult = await this.piiPatternService.detectPII(text, {
        dataTypes: options?.dataTypes,
        minConfidence: 0.8,
        maxMatches: 100,
      });

      // Process each detected PII match
      for (const match of detectionResult.matches) {
        try {
          // Generate pseudonym for this match
          const pseudonymResult = await this.generatePseudonym(
            match.value,
            match.dataType,
            options?.context,
          );

          pseudonyms.push(pseudonymResult);

          // Replace in text (use exact match to avoid partial replacements)
          processedText = processedText.replace(
            match.value,
            pseudonymResult.pseudonym,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to pseudonymize ${match.dataType}: ${match.value}`,
            error,
          );
        }
      }

      const processingTime = Date.now() - startTime;

      // Log audit trail for bulk operation
      if (pseudonyms.length > 0) {
        await this.logBulkPseudonymOperation(pseudonyms, processingTime);
      }

      return {
        originalText: text,
        pseudonymizedText: processedText,
        pseudonyms,
        processingTime,
      };
    } catch (error) {
      this.logger.error(
        `Failed to pseudonymize text: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error((error as { message: string }).message);
    }
  }

  /**
   * Lookup existing pseudonym by original value
   */
  async lookupPseudonym(
    originalValue: string,
    dataType: PIIDataType,
  ): Promise<string | null> {
    try {
      const originalHash = this.hashValue(originalValue);
      const existing = await this.lookupExistingPseudonym(originalHash);

      if (existing && existing.data_type === dataType) {
        return existing.pseudonym;
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Failed to lookup pseudonym: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Get available PII patterns (delegates to PIIPatternService)
   */
  getPIIPatterns(): PIIPattern[] {
    return this.piiPatternService.getAllPatterns();
  }

  /**
   * Get available PII patterns async (ensures patterns are loaded from DB)
   */
  async getPIIPatternsAsync(): Promise<PIIPattern[]> {
    return await this.piiPatternService.getAllPatternsAsync();
  }

  /**
   * Add custom PII pattern (delegates to PIIPatternService)
   */
  async addPIIPattern(pattern: Omit<PIIPattern, 'enabled'>): Promise<void> {
    await this.piiPatternService.addCustomPattern(pattern);
    this.logger.debug(`Added custom PII pattern: ${pattern.name}`);
  }

  /**
   * Update custom PII pattern (delegates to PIIPatternService)
   */
  async updatePIIPattern(
    id: string,
    updates: Partial<Omit<PIIPattern, 'enabled'>>,
  ): Promise<void> {
    await this.piiPatternService.updateCustomPattern(id, updates);
    this.logger.debug(`Updated custom PII pattern: ${id}`);
  }

  /**
   * Delete custom PII pattern (delegates to PIIPatternService)
   */
  async deletePIIPattern(id: string): Promise<void> {
    await this.piiPatternService.deleteCustomPattern(id);
    this.logger.debug(`Deleted custom PII pattern: ${id}`);
  }

  /**
   * Get service statistics
   */
  getStats(): Promise<{
    totalPIIPatterns: number;
    productionMode: boolean;
    showstopperPatterns: number;
    flaggerPatterns: number;
    patternServiceStats: Record<string, unknown>;
  }> {
    const patternServiceStats = this.piiPatternService.getStats();

    return Promise.resolve({
      totalPIIPatterns: patternServiceStats.totalPatterns,
      productionMode: this.isProduction,
      showstopperPatterns: patternServiceStats.showstopperPatterns,
      flaggerPatterns: patternServiceStats.flaggerPatterns,
      patternServiceStats,
    });
  }

  // =====================================
  // PRIVATE HELPER METHODS
  // =====================================

  /**
   * Create SHA-256 hash of a value for consistent pseudonym lookup
   */
  private hashValue(value: string): string {
    return createHash('sha256')
      .update(value.toLowerCase().trim())
      .digest('hex');
  }

  /**
   * Look up existing pseudonym mapping from database
   */
  private async lookupExistingPseudonym(
    originalHash: string,
  ): Promise<{ id: string; pseudonym: string; data_type: string } | null> {
    try {
      // Database query
      const { data, error } = (await this.db
        .from(null, 'pseudonym_mappings')
        .select('*')
        .eq('original_hash', originalHash)
        .single()) as { data: unknown; error: unknown };

      if (error && (error as Record<string, unknown>).code !== 'PGRST116') {
        // PGRST116 = no rows found
        throw new Error(String((error as Record<string, unknown>).message));
      }

      return data as {
        id: string;
        pseudonym: string;
        data_type: string;
      } | null;
    } catch (error) {
      this.logger.error(
        `Database lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Create a new pseudonym based on data type
   */
  private async createNewPseudonym(
    dataType: PIIDataType,
    originalValue: string,
  ): Promise<string> {
    switch (dataType) {
      case 'email':
        return await this.generateFakeEmail(originalValue);
      case 'phone':
        return this.generateFakePhone();
      case 'name':
        return await this.generateFakeName();
      case 'ip_address':
        return this.generateFakeIP();
      case 'username':
        return await this.generateFakeUsername(originalValue);
      case 'address':
        return await this.generateFakeAddress();
      default:
        return `[PSEUDONYM_${dataType.toUpperCase()}_${randomBytes(4).toString('hex')}]`;
    }
  }

  /**
   * Generate realistic fake email
   */
  private async generateFakeEmail(originalEmail: string): Promise<string> {
    try {
      // Get random first name, last name, and domain from dictionary
      // Database query

      const [firstNameResult, lastNameResult, domainResult] = await Promise.all(
        [
          this.db
            .from(null, 'pseudonym_dictionaries')
            .select('value')
            .eq('data_type', 'name')
            .eq('category', 'first_names')
            .order('frequency_weight', { ascending: false })
            .limit(10),
          this.db
            .from(null, 'pseudonym_dictionaries')
            .select('value')
            .eq('data_type', 'name')
            .eq('category', 'last_names')
            .order('frequency_weight', { ascending: false })
            .limit(10),
          this.db
            .from(null, 'pseudonym_dictionaries')
            .select('value')
            .eq('data_type', 'email')
            .eq('category', 'domains')
            .order('frequency_weight', { ascending: false })
            .limit(5),
        ],
      );

      const firstName =
        this.getRandomFromResult(
          firstNameResult.data as Array<Record<string, unknown>> | null,
        ) || 'john';
      const lastName =
        this.getRandomFromResult(
          lastNameResult.data as Array<Record<string, unknown>> | null,
        ) || 'doe';
      const domain =
        this.getRandomFromResult(
          domainResult.data as Array<Record<string, unknown>> | null,
        ) || 'example.com';

      // Create deterministic but realistic email
      const hash = this.hashValue(originalEmail);
      const suffix = hash.substring(0, 3);

      return `${firstName.toLowerCase()}.${lastName.toLowerCase()}${suffix}@${domain}`;
    } catch {
      // Fallback if database lookup fails
      const hash = this.hashValue(originalEmail);
      return `user${hash.substring(0, 6)}@example.com`;
    }
  }

  /**
   * Generate realistic fake phone number
   */
  private generateFakePhone(): string {
    // Generate realistic US phone number format
    const areaCode = Math.floor(Math.random() * 800) + 200; // 200-999
    const exchange = Math.floor(Math.random() * 800) + 200; // 200-999
    const number = Math.floor(Math.random() * 9000) + 1000; // 1000-9999

    return `(${areaCode}) ${exchange}-${number}`;
  }

  /**
   * Generate realistic fake name
   */
  private async generateFakeName(): Promise<string> {
    try {
      // Database query

      const [firstNameResult, lastNameResult] = await Promise.all([
        this.db
          .from(null, 'pseudonym_dictionaries')
          .select('value')
          .eq('data_type', 'name')
          .eq('category', 'first_names')
          .order('frequency_weight', { ascending: false })
          .limit(20),
        this.db
          .from(null, 'pseudonym_dictionaries')
          .select('value')
          .eq('data_type', 'name')
          .eq('category', 'last_names')
          .order('frequency_weight', { ascending: false })
          .limit(20),
      ]);

      const firstName =
        this.getRandomFromResult(
          firstNameResult.data as Array<Record<string, unknown>> | null,
        ) || 'John';
      const lastName =
        this.getRandomFromResult(
          lastNameResult.data as Array<Record<string, unknown>> | null,
        ) || 'Doe';

      return `${firstName} ${lastName}`;
    } catch {
      return 'John Doe';
    }
  }

  /**
   * Generate fake IP address
   */
  private generateFakeIP(): string {
    // Generate private IP ranges for safety
    const ranges = [
      [10, 0, 0, 0], // 10.x.x.x
      [172, 16, 0, 0], // 172.16.x.x
      [192, 168, 0, 0], // 192.168.x.x
    ];

    const range = ranges[Math.floor(Math.random() * ranges.length)];
    if (!range) {
      return '192.168.1.1'; // fallback
    }
    return `${range[0]}.${(range[1] || 0) + Math.floor(Math.random() * 16)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  }

  /**
   * Generate fake username
   */
  private async generateFakeUsername(
    originalUsername: string,
  ): Promise<string> {
    try {
      // Database query
      const { data } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .select('value')
        .eq('data_type', 'name')
        .eq('category', 'first_names')
        .limit(50)) as QueryResult<unknown>;

      const name =
        this.getRandomFromResult(
          data as Array<Record<string, unknown>> | null,
        ) || 'user';
      const hash = this.hashValue(originalUsername);
      const suffix = hash.substring(0, 4);

      return `@${name.toLowerCase()}${suffix}`;
    } catch {
      const hash = this.hashValue(originalUsername);
      return `@user${hash.substring(0, 6)}`;
    }
  }

  /**
   * Generate fake address
   */
  private async generateFakeAddress(): Promise<string> {
    try {
      // Database query
      const { data } = (await this.db
        .from(null, 'pseudonym_dictionaries')
        .select('value')
        .eq('data_type', 'address')
        .eq('category', 'street_names')
        .limit(20)) as QueryResult<unknown>;

      const streetName =
        this.getRandomFromResult(
          data as Array<Record<string, unknown>> | null,
        ) || 'Main';
      const streetNumber = Math.floor(Math.random() * 9999) + 1;
      const streetTypes = ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Rd'];
      const streetType =
        streetTypes[Math.floor(Math.random() * streetTypes.length)];

      return `${streetNumber} ${streetName} ${streetType}`;
    } catch {
      return '123 Main St';
    }
  }

  /**
   * Get random value from database result
   */
  private getRandomFromResult(
    data: Array<Record<string, unknown>> | null,
  ): string | null {
    if (!data || data.length === 0) return null;
    const randomItem = data[Math.floor(Math.random() * data.length)] as
      | { value?: string }
      | undefined;
    return randomItem?.value || null;
  }

  /**
   * Store pseudonym mapping in database
   */
  private async storePseudonymMapping(
    originalHash: string,
    pseudonym: string,
    dataType: PIIDataType,
    context?: string,
  ): Promise<string> {
    try {
      // Database query
      const { data, error } = (await this.db
        .from(null, 'pseudonym_mappings')
        .insert({
          original_hash: originalHash,
          pseudonym,
          data_type: dataType,
          context,
          usage_count: 1,
          last_used_at: new Date().toISOString(),
        })
        .select('id')
        .single()) as QueryResult<unknown>;

      if (error) throw new Error((error as { message: string }).message);
      const typedData = data as { id: string };
      return typedData.id;
    } catch (error) {
      this.logger.error(
        `Failed to store pseudonym mapping: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error((error as { message: string }).message);
    }
  }

  /**
   * Increment pseudonym usage count
   */
  private async incrementPseudonymUsage(mappingId: string): Promise<void> {
    try {
      // Database query
      // First get current usage count, then increment it
      const { data: mapping } = (await this.db
        .from(null, 'pseudonym_mappings')
        .select('usage_count')
        .eq('id', mappingId)
        .single()) as QueryResult<unknown>;

      const currentCount =
        (mapping as { usage_count?: number } | null)?.usage_count || 0;

      await this.db
        .from(null, 'pseudonym_mappings')
        .update({
          usage_count: currentCount + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', mappingId);
    } catch (error) {
      this.logger.warn(
        `Failed to increment pseudonym usage: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Log pseudonym operation to audit trail
   */
  private async logPseudonymOperation(
    operation: string,
    dataType: PIIDataType,
    processingTime: number,
    sessionId?: string,
    runId?: string,
  ): Promise<void> {
    try {
      // Database query
      await this.db.from(null, 'redaction_audit_log').insert({
        session_id: sessionId,
        run_id: runId,
        operation_type: operation,
        data_type: dataType,
        pseudonym_count: 1,
        processing_time_ms: processingTime,
        service_name: 'pseudonymization_service',
        metadata: {
          operation,
          dataType,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to log pseudonym operation: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Log bulk pseudonym operation to audit trail
   */
  private async logBulkPseudonymOperation(
    pseudonyms: PseudonymResult[],
    processingTime: number,
    sessionId?: string,
    runId?: string,
  ): Promise<void> {
    try {
      // Database query

      // Group by data type for separate log entries
      const groupedByType = pseudonyms.reduce(
        (acc, p) => {
          acc[p.dataType] = (acc[p.dataType] || 0) + 1;
          return acc;
        },
        {} as Record<PIIDataType, number>,
      );

      const logEntries = Object.entries(groupedByType).map(
        ([dataType, count]) => ({
          session_id: sessionId,
          run_id: runId,
          operation_type: 'bulk_pseudonymize',
          data_type: dataType as PIIDataType,
          pseudonym_count: count,
          processing_time_ms: processingTime,
          service_name: 'pseudonymization_service',
          metadata: {
            totalPseudonyms: pseudonyms.length,
            dataTypeBreakdown: groupedByType,
            timestamp: new Date().toISOString(),
          },
        }),
      );

      await this.db.from(null, 'redaction_audit_log').insert(logEntries);
    } catch (error) {
      this.logger.warn(
        `Failed to log bulk pseudonym operation: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Reverse pseudonymization - convert pseudonyms back to original values
   */
  reversePseudonymization(
    pseudonymizedText: string,
    pseudonymMappings: PseudonymResult[],
  ): Promise<{
    originalText: string;
    reversalCount: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    let reversedText = pseudonymizedText;
    let reversalCount = 0;

    // Sort by pseudonym length (longest first) to avoid partial replacements
    const sortedMappings = [...pseudonymMappings].sort(
      (a, b) => b.pseudonym.length - a.pseudonym.length,
    );

    for (const mapping of sortedMappings) {
      // Only reverse if the pseudonym appears in the text
      if (reversedText.includes(mapping.pseudonym)) {
        // Use word boundaries for exact matches to avoid partial replacements
        const regex = new RegExp(
          `\\b${this.escapeRegExp(mapping.pseudonym)}\\b`,
          'g',
        );
        const beforeLength = reversedText.length;
        reversedText = reversedText.replace(regex, mapping.originalValue);
        const afterLength = reversedText.length;

        // Count actual replacements made
        if (beforeLength !== afterLength) {
          reversalCount++;
        }
      }
    }

    const processingTime = Date.now() - startTime;

    return Promise.resolve({
      originalText: reversedText,
      reversalCount,
      processingTime,
    });
  }

  /**
   * Reverse pseudonymization using stored mappings (lookup from database)
   */
  async reversePseudonymizationFromDatabase(
    pseudonymizedText: string,
    context?: string,
  ): Promise<{
    originalText: string;
    reversalCount: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    const reversedText = pseudonymizedText;
    let reversalCount = 0;

    try {
      // Database query

      // Get all pseudonym mappings that might be in the text
      let query = this.db
        .from(null, 'pseudonym_mappings')
        .select('pseudonym, original_hash, data_type, context');

      if (context) {
        query = query.eq('context', context);
      }

      const { data: mappings } = (await query) as QueryResult<unknown>;

      const typedMappings = (mappings || []) as Array<{
        pseudonym: string;
        original_hash: string;
        data_type: string;
        context: string | null;
      }>;
      if (typedMappings.length > 0) {
        // For each mapping, check if the pseudonym appears in text and reverse it
        for (const mapping of typedMappings) {
          if (reversedText.includes(mapping.pseudonym)) {
            // We cannot reverse from hash alone - this method would need
            // access to the sensitive_data_vault for reversible pseudonyms
            // For now, we'll keep the pseudonym but mark it as [PSEUDONYM]
            const regex = new RegExp(
              `\\b${this.escapeRegExp(mapping.pseudonym)}\\b`,
              'g',
            );
            const matches = reversedText.match(regex);
            if (matches) {
              reversalCount += matches.length;
              // Note: Cannot reverse without original value - would need vault access
              this.logger.warn(
                `Found pseudonym ${mapping.pseudonym} but cannot reverse without original value`,
              );
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to reverse pseudonymization from database: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    const processingTime = Date.now() - startTime;

    return {
      originalText: reversedText,
      reversalCount,
      processingTime,
    };
  }

  /**
   * Create pseudonym mapping context for a request (to enable reversal)
   */
  async createReversiblePseudonymization(
    text: string,
    requestId: string,
    options?: { context?: string; dataTypes?: PIIDataType[] },
  ): Promise<{
    pseudonymizedText: string;
    reversalContext: PseudonymResult[];
    processingTime: number;
  }> {
    const result = await this.pseudonymizeText(text, {
      context: `${requestId}${options?.context ? `-${options.context}` : ''}`,
      dataTypes: options?.dataTypes,
    });

    return {
      pseudonymizedText: result.pseudonymizedText,
      reversalContext: result.pseudonyms,
      processingTime: result.processingTime,
    };
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
