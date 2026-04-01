import {
  Injectable,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService } from '@/database';
import {
  PIIPatternService,
  PIIMatch as PatternServicePIIMatch,
} from '../pii-pattern.service';
import {
  PIIProcessingMetadata,
  PIIMatch,
  DataTypeSummary,
  SeverityBreakdown,
  UserMessage,
  PIISeverity,
} from '../types/pii-metadata.types';

const dataTypeToHumanReadable: Record<string, string> = {
  email: 'Email Address',
  phone: 'Phone Number',
  ssn: 'Social Security Number',
  credit_card: 'Credit Card Number',
  name: 'Name',
  address: 'Address',
  ip_address: 'IP Address',
  url: 'URL',
  username: 'Username',
  custom: 'Custom PII',
};

// Legacy interfaces for backward compatibility
export interface PIIPolicyResult {
  allowed: boolean;
  sanitizedPrompt: string;
  sanitizationResult?: Record<string, unknown>;
  violations: string[];
  reasoningPath: string[];
}

export interface PIILLMSanitizationResult {
  sanitizedSystemPrompt: string;
  sanitizedUserMessage: string;
  reversalContext: unknown;
  sanitizationMetrics: unknown;
  shouldApplySanitization: boolean;
}

export interface PIIRestorationResult {
  restoredContent: string;
  success: boolean;
  error?: string;
}

/**
 * Refactored PII Service - Focus on Detection and Metadata Creation
 *
 * SECURITY CRITICAL: This service detects and classifies PII in user prompts
 * before they are sent to external LLM providers.
 *
 * This service is responsible for:
 * 1. Detecting PII in text using PIIPatternService
 * 2. Creating comprehensive metadata structures
 * 3. Making policy decisions (allow/block)
 * 4. Generating user-friendly messages
 *
 * This service does NOT:
 * - Apply actual pseudonymization (that's done by PseudonymizerService at LLM boundary)
 * - Handle sanitization workflows (that's orchestrated by CentralizedRoutingService)
 *
 * Security considerations:
 * - Showstopper PII (SSN, credit cards) immediately blocks requests
 * - Local providers (Ollama) bypass all PII processing
 * - External providers get PII detection and optional pseudonymization
 * - Error handling defaults to allowing requests (fail-open for availability)
 */
@Injectable()
export class PIIService {
  private readonly logger = new Logger(PIIService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly piiPatternService: PIIPatternService,
  ) {}

  /**
   * NEW ARCHITECTURE: Check PII policy and create comprehensive metadata
   *
   * This is the main entry point called by CentralizedRoutingService.
   * It detects PII, makes policy decisions, and creates metadata structure.
   *
   * CRITICAL: Implements showstopper early-exit pattern
   * CRITICAL: Skips ALL processing for local providers (Ollama) - returns "no issues"
   */
  async checkPolicy(
    prompt: string,
    options: Record<string, unknown> = {},
  ): Promise<{
    metadata: PIIProcessingMetadata;
    originalPrompt: string;
  }> {
    const startTime = Date.now();

    try {
      // STEP 0: Check if this is a local provider (Ollama) - skip ALL PII processing
      const isLocalProvider =
        (options.providerName as string | undefined)?.toLowerCase() ===
          'ollama' ||
        (options.provider as string | undefined)?.toLowerCase() === 'ollama';

      if (isLocalProvider) {
        this.logger.debug(
          `🏠 [PII-SERVICE] Local provider (Ollama) detected - SKIPPING ALL PII PROCESSING`,
        );

        // Return minimal "no issues" metadata for local providers
        const localMetadata: PIIProcessingMetadata = {
          piiDetected: false,
          showstopperDetected: false,
          detectionResults: {
            totalMatches: 0,
            flaggedMatches: [],
            dataTypesSummary: {},
            severityBreakdown: { showstopper: 0, warning: 0, info: 0 },
          },
          policyDecision: {
            allowed: true,
            blocked: false,
            violations: [],
            reasoningPath: [
              'Local provider (Ollama) - no PII processing needed',
            ],
            appliedFor: 'local',
          },
          userMessage: {
            summary: 'Local processing - no privacy concerns',
            details: ['Data processed locally with Ollama'],
            actionsTaken: ['No PII processing required'],
            isBlocked: false,
          },
          processingFlow: 'allowed-local',
          processingSteps: ['local-provider-check', 'no-processing-needed'],
          timestamps: {
            detectionStart: startTime,
            policyCheck: Date.now(),
          },
        };

        return {
          metadata: localMetadata,
          originalPrompt: prompt,
        };
      }

      this.logger.debug(
        `🔍 [PII-SERVICE] External provider - Starting PII policy check for prompt: "${prompt.substring(0, 100)}..."`,
      );

      // Step 1: Detect ALL PII first (External providers only)
      const detectionResult = await this.piiPatternService.detectPII(prompt, {
        minConfidence: 0.8,
        maxMatches: 100,
      });

      this.logger.debug(
        `🔍 [PII-SERVICE] Detection found ${detectionResult.matches.length} PII matches`,
      );

      // Step 2: Convert matches to our metadata format
      const convertedMatches = this.convertPIIMatches(detectionResult.matches);

      // Step 3: CRITICAL SHOWSTOPPER CHECK - Early Exit Point
      // SECURITY: Showstopper PII (SSN, credit cards) must block ALL requests
      // No pseudonymization is acceptable for this class of data
      const showstopperMatches = convertedMatches.filter(
        (match) => match.severity === 'showstopper',
      );

      if (showstopperMatches.length > 0) {
        this.logger.warn(
          `🛑 [PII-SERVICE] SHOWSTOPPER DETECTED - Immediate blocking`,
        );

        // 🔥 EARLY EXIT: Build showstopper metadata and return immediately
        const showstopperTypes = [
          ...new Set(showstopperMatches.map((m) => m.dataType)),
        ];

        const metadata: PIIProcessingMetadata = {
          piiDetected: true,
          showstopperDetected: true, // 🔥 Critical flag
          detectionResults: {
            totalMatches: convertedMatches.length,
            flaggedMatches: convertedMatches, // All matches for transparency
            showstopperMatches, // Specific showstoppers
            dataTypesSummary: this.buildDataTypeSummary(convertedMatches),
            severityBreakdown: this.buildSeverityBreakdown(convertedMatches),
          },
          policyDecision: {
            allowed: false,
            blocked: true,
            blockingReason: 'showstopper-pii',
            violations: [
              `Showstopper PII detected: ${showstopperTypes.join(', ')}`,
            ],
            reasoningPath: [
              'PII Detection: COMPLETED',
              `Showstopper PII found: ${showstopperTypes.join(', ')}`,
              'BLOCKING REQUEST - No further processing',
            ],
            appliedFor: 'policy-blocked',
            showstopperTypes,
          },
          // 🔥 NO pseudonymInstructions - not needed for blocked requests
          // 🔥 NO pseudonymResults - never populated for showstoppers
          userMessage: this.generateShowstopperMessage(showstopperMatches),
          processingFlow: 'showstopper-blocked',
          processingSteps: [
            'pii-detection',
            'showstopper-check',
            'request-blocked',
          ],
          timestamps: {
            detectionStart: startTime,
            showstopperCheck: Date.now(),
          },
        };

        this.logger.warn(
          `🛑 [PII-SERVICE] Request blocked due to ${showstopperTypes.join(', ')}`,
        );

        // 🔥 IMMEDIATE RETURN - No further processing
        return {
          metadata,
          originalPrompt: prompt,
        };
      }

      // Step 3: Only continue if NO showstoppers detected
      this.logger.debug(
        `✅ [PII-SERVICE] No showstoppers detected, continuing with policy evaluation`,
      );

      return this.continueNormalProcessing(
        convertedMatches,
        prompt,
        options,
        startTime,
      );
    } catch (error) {
      this.logger.error('🔥 [PII-SERVICE] Policy check failed', error);

      // SECURITY: Fail-closed in production - block requests when PII service is unavailable
      // This prevents data leakage when the PII detection system is compromised or down
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          '🛡️ [PII-SERVICE] Production fail-closed: blocking request due to PII service error',
        );
        throw new ServiceUnavailableException(
          'PII protection service temporarily unavailable. Please try again.',
        );
      }

      // In development/test, allow requests through with warning for debugging
      this.logger.warn(
        '⚠️ [PII-SERVICE] Development mode: allowing request despite PII service error',
      );

      const errorMetadata: PIIProcessingMetadata = {
        piiDetected: false,
        showstopperDetected: false,
        detectionResults: {
          totalMatches: 0,
          flaggedMatches: [],
          dataTypesSummary: {},
          severityBreakdown: { showstopper: 0, warning: 0, info: 0 },
        },
        policyDecision: {
          allowed: true,
          blocked: false,
          violations: ['PII policy check failed (dev mode - fail-open)'],
          reasoningPath: [
            'PII Detection: FAILED',
            'Development mode: allowing request for debugging',
          ],
          appliedFor: 'external',
        },
        userMessage: {
          summary: 'PII check temporarily unavailable (dev mode)',
          details: ['PII detection service encountered an error'],
          actionsTaken: ['Request processed without PII protection (dev only)'],
          isBlocked: false,
        },
        processingFlow: 'allowed-local',
        processingSteps: ['pii-detection-error', 'dev-fallback-allow'],
        timestamps: {
          detectionStart: startTime,
        },
      };

      return {
        metadata: errorMetadata,
        originalPrompt: prompt,
      };
    }
  }

  /**
   * Continue normal processing for non-showstopper cases
   */
  private continueNormalProcessing(
    convertedMatches: PIIMatch[],
    prompt: string,
    options: unknown,
    startTime: number,
  ): Promise<{ metadata: PIIProcessingMetadata; originalPrompt: string }> {
    // Check if this is a local provider (Ollama) - skip PII blocking for local providers
    const opts = options as { providerName?: string; provider?: string };
    const isLocalProvider =
      opts.providerName?.toLowerCase() === 'ollama' ||
      opts.provider?.toLowerCase() === 'ollama';

    if (isLocalProvider) {
      this.logger.debug(
        `🏠 [PII-SERVICE] Local provider detected - allowing without pseudonymization`,
      );

      const localMetadata: PIIProcessingMetadata = {
        piiDetected: convertedMatches.length > 0,
        showstopperDetected: false,
        detectionResults: {
          totalMatches: convertedMatches.length,
          flaggedMatches: convertedMatches,
          dataTypesSummary: this.buildDataTypeSummary(convertedMatches),
          severityBreakdown: this.buildSeverityBreakdown(convertedMatches),
        },
        policyDecision: {
          allowed: true,
          blocked: false,
          violations: [],
          reasoningPath: [
            'PII Policy: ALLOWED - Local provider (Ollama), data stays local',
          ],
          appliedFor: 'local',
        },
        userMessage: this.generateLocalProviderMessage(convertedMatches),
        processingFlow: 'allowed-local',
        processingSteps: [
          'pii-detection',
          'local-provider-check',
          'request-allowed',
        ],
        timestamps: {
          detectionStart: startTime,
          policyCheck: Date.now(),
        },
      };

      return Promise.resolve({
        metadata: localMetadata,
        originalPrompt: prompt,
      });
    }

    // External provider - create pseudonym instructions
    this.logger.debug(
      `🌐 [PII-SERVICE] External provider - creating pseudonym instructions`,
    );

    const pseudonymizerMatches: PIIMatch[] = []; // Never create pseudonym instructions from pattern matches

    const optsExt = options as Record<string, unknown>;
    const requestId = (optsExt.conversationId ||
      optsExt.requestId ||
      `pii-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`) as string;

    const externalMetadata: PIIProcessingMetadata = {
      piiDetected: convertedMatches.length > 0,
      showstopperDetected: false,
      detectionResults: {
        totalMatches: convertedMatches.length,
        flaggedMatches: convertedMatches,
        dataTypesSummary: this.buildDataTypeSummary(convertedMatches),
        severityBreakdown: this.buildSeverityBreakdown(convertedMatches),
      },
      policyDecision: {
        allowed: true,
        blocked: false,
        violations: [],
        reasoningPath: [
          'PII Detection: COMPLETED',
          `Found ${convertedMatches.length} PII matches`,
          'External provider - creating pseudonym instructions',
        ],
        appliedFor: 'external',
      },
      pseudonymInstructions: {
        shouldPseudonymize: pseudonymizerMatches.length > 0,
        targetMatches: pseudonymizerMatches,
        requestId,
        context: 'llm-boundary',
      },
      userMessage: this.generateExternalProviderMessage(
        convertedMatches,
        pseudonymizerMatches,
      ),
      processingFlow: 'pseudonymized',
      processingSteps: [
        'pii-detection',
        'external-provider-check',
        'pseudonym-instructions-created',
      ],
      timestamps: {
        detectionStart: startTime,
        policyCheck: Date.now(),
      },
    };

    return Promise.resolve({
      metadata: externalMetadata,
      originalPrompt: prompt,
    });
  }

  /**
   * Helper Methods for Metadata Creation
   */

  /**
   * Convert PIIPatternService PIIMatch to our metadata PIIMatch
   */
  private convertPIIMatches(
    patternMatches: PatternServicePIIMatch[],
  ): PIIMatch[] {
    return patternMatches.map((match) => ({
      value: match.value,
      dataType: match.dataType,
      severity: this.convertSeverity(match.severity),
      confidence: match.confidence,
      startIndex: match.startIndex,
      endIndex: match.endIndex,
      pattern: match.patternName,
      // pseudonym will be populated later during processing
    }));
  }

  /**
   * Convert PIIPatternService severity to our metadata severity
   */
  private convertSeverity(severity?: string): PIISeverity {
    switch (severity) {
      case 'showstopper':
        return 'showstopper';
      case 'flagger':
        return 'info';
      default:
        return 'info';
    }
  }

  private buildDataTypeSummary(
    matches: PIIMatch[],
  ): Record<string, DataTypeSummary> {
    const summary: Record<string, DataTypeSummary> = {};

    matches.forEach((match) => {
      if (!summary[match.dataType]) {
        summary[match.dataType] = {
          count: 0,
          severity: match.severity,
          examples: [],
        };
      }

      const dataTypeSummary = summary[match.dataType];
      if (dataTypeSummary) {
        dataTypeSummary.count++;

        // Add truncated example for UI display (first 3 chars + "...")
        if (dataTypeSummary.examples.length < 3) {
          const example =
            match.value.length > 6
              ? match.value.substring(0, 3) + '...'
              : '***';
          dataTypeSummary.examples.push(example);
        }
      }
    });

    return summary;
  }

  private buildSeverityBreakdown(matches: PIIMatch[]): SeverityBreakdown {
    return {
      showstopper: matches.filter((m) => m.severity === 'showstopper').length,
      warning: 0,
      info: matches.filter((m) => m.severity === 'info').length,
    };
  }

  private generateShowstopperMessage(
    showstopperMatches: PIIMatch[],
  ): UserMessage {
    const showstopperTypes = [
      ...new Set(showstopperMatches.map((m) => m.dataType)),
    ];
    const count = showstopperMatches.length;
    const humanReadableTypes = showstopperTypes.map(
      (t) => dataTypeToHumanReadable[t] || t,
    );

    return {
      summary: `Request blocked: ${count} item${count > 1 ? 's' : ''} of highly sensitive information detected`,
      details: [
        `Detected: ${humanReadableTypes.join(', ')}`,
        'This type of information cannot be processed for security and privacy reasons.',
        'Your request was not sent to any AI model.',
      ],
      actionsTaken: [
        'Request immediately blocked',
        'No data sent to external services',
        'Information kept completely private',
      ],
      isBlocked: true,
      blockingDetails: {
        showstopperTypes,
        affectedCount: count,
        recommendation:
          'Please remove or rephrase sensitive information and try again.',
      },
    };
  }

  private generateLocalProviderMessage(matches: PIIMatch[]): UserMessage {
    if (matches.length === 0) {
      return {
        summary: 'No personal information detected',
        details: [],
        actionsTaken: ['Request processed with local AI model'],
        isBlocked: false,
      };
    }

    const dataTypes = [...new Set(matches.map((m) => m.dataType))];
    const humanReadableTypes = dataTypes.map(
      (t) => dataTypeToHumanReadable[t] || t,
    );
    return {
      summary: `${matches.length} piece${matches.length > 1 ? 's' : ''} of personal information detected`,
      details: [
        `Detected: ${humanReadableTypes.join(', ')}`,
        'Using local AI model - your data stays completely private',
      ],
      actionsTaken: [
        'Processed with local AI model (Ollama)',
        'No data sent to external services',
      ],
      isBlocked: false,
    };
  }

  private generateExternalProviderMessage(
    allMatches: PIIMatch[],
    pseudonymizerMatches: PIIMatch[],
  ): UserMessage {
    if (allMatches.length === 0) {
      return {
        summary: 'No personal information detected',
        details: [],
        actionsTaken: ['Request sent to AI model without modifications'],
        isBlocked: false,
      };
    }

    const dataTypes = [...new Set(allMatches.map((m) => m.dataType))];
    const humanReadableTypes = dataTypes.map(
      (t) => dataTypeToHumanReadable[t] || t,
    );
    const pseudonymizedTypes = [
      ...new Set(pseudonymizerMatches.map((m) => m.dataType)),
    ];
    const humanReadablePseudonymizedTypes = pseudonymizedTypes.map(
      (t) => dataTypeToHumanReadable[t] || t,
    );

    if (pseudonymizerMatches.length === 0) {
      return {
        summary: `${allMatches.length} piece${allMatches.length > 1 ? 's' : ''} of personal information detected`,
        details: [
          `Detected: ${humanReadableTypes.join(', ')}`,
          'Information flagged for monitoring but not modified',
        ],
        actionsTaken: [
          'Request sent to AI model with monitoring',
          'No modifications made to your content',
        ],
        isBlocked: false,
      };
    }

    return {
      summary: `Privacy protected: ${pseudonymizerMatches.length} piece${pseudonymizerMatches.length > 1 ? 's' : ''} of personal information will be anonymized`,
      details: [
        `Will be anonymized: ${humanReadablePseudonymizedTypes.join(', ')}`,
        'Temporary identifiers will be used when sending to AI',
        'Original values will be restored in the response',
      ],
      actionsTaken: [
        'Personal information will be temporarily replaced',
        'AI will receive anonymized version',
        'Response will contain your original information',
      ],
      isBlocked: false,
    };
  }
}
