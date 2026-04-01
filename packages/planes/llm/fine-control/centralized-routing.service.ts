import { Injectable, Inject, Logger } from '@nestjs/common';
import { LocalModelStatusService } from './local-model-status.service';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import { SovereignPolicyService } from './config/sovereign-policy.service';
import {
  FeatureFlagService,
  FeatureFlagContext,
} from '@/config/feature-flag.service';
import { PIIService } from './pii/pii.service';
import { DictionaryPseudonymizerService } from './pii/dictionary-pseudonymizer.service';
import { PatternRedactionService } from './pii/pattern-redaction.service';
import { PIIProcessingMetadata } from './types/pii-metadata.types';
import { DictionaryPseudonymMapping } from './pii/dictionary-pseudonymizer.service';
import type { PatternRedactionMapping } from './pii/pattern-redaction.service';
import { RunMetadataService } from './run-metadata.service';
import { createHash } from 'crypto';

interface RoutingAuditLog {
  timestamp: string;
  userId?: string;
  organizationId?: string;
  requestId?: string;
  prompt: {
    length: number;
    wordCount: number;
    hash: string; // For privacy - don't log actual content
  };
  sovereignMode: {
    enabled: boolean;
    enforced: boolean;
    defaultMode: string;
    auditLevel: string;
  };
  featureFlags: {
    sovereignRoutingEnabled: boolean;
  };
  routing: {
    complexityScore: number;
    tier: string;
    preferLocal: boolean;
    localModelsAvailable: boolean;
    selectedProvider: string;
    selectedModel: string;
    isLocal: boolean;
    fallbackUsed: boolean;
    reasoningPath: string[];
  };
  policy: {
    violations: string[];
    warnings: string[];
  };
  performance: {
    routingDurationMs: number;
  };
}

// Legacy interface for backward compatibility
export interface RoutingDecision {
  provider: string;
  model: string;
  isLocal: boolean;
  modelTier?: string;
  fallbackUsed: boolean;
  complexityScore: number;
  reasoningPath: string[];
  sovereignModeEnforced?: boolean;
  sovereignModeViolation?: boolean;
  // New fields for metadata-based architecture
  piiMetadata?: PIIProcessingMetadata;
  originalPrompt?: string;
  routeToAgent?: boolean;
  blockingReason?: string;
}

export interface LLMRequest {
  prompt: string;
  options?: {
    provider?: string;
    model?: string;
    preferLocal?: boolean;
    maxComplexity?: 'simple' | 'medium' | 'complex';
    userId?: string;
    organizationId?: string;
    userSovereignMode?: boolean;
    [key: string]: unknown;
  };
}

export type ComplexityLevel = 'simple' | 'medium' | 'complex';

@Injectable()
export class CentralizedRoutingService {
  private readonly logger = new Logger(CentralizedRoutingService.name);

  constructor(
    private readonly localModelStatusService: LocalModelStatusService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly sovereignPolicyService: SovereignPolicyService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly piiService: PIIService,
    private readonly dictionaryPseudonymizerService: DictionaryPseudonymizerService,
    private readonly patternRedactionService: PatternRedactionService,
    private readonly runMetadataService: RunMetadataService,
  ) {
    this.logger.log('CentralizedRoutingService initialized');
  }

  /**
   * NEW ARCHITECTURE: Process agent response with PII metadata
   *
   * This method is called by agents after they receive LLM responses.
   * It handles pseudonym reversal and updates metadata for the response.
   */
  async processAgentResponse(
    agentResponse: string,
    piiMetadata: PIIProcessingMetadata,
    _options: {
      conversationId?: string;
      requestId?: string;
      userId?: string;
      organizationId?: string;
    } = {},
  ): Promise<{
    processedResponse: string;
    updatedMetadata: PIIProcessingMetadata;
    success: boolean;
    error?: string;
  }> {
    this.logger.debug(
      `🔄 [CENTRALIZED-ROUTING] Processing agent response with PII metadata`,
    );

    try {
      let processedResponse = agentResponse;
      let pseudonymReversalCount = 0;
      let patternReversalCount = 0;

      // Step 1: Reverse pattern redactions first (to restore original values)
      if (
        piiMetadata.patternRedactionMappings &&
        piiMetadata.patternRedactionMappings.length > 0
      ) {
        try {
          const patternReverseResult =
            await this.patternRedactionService.reverseRedactions(
              processedResponse,
              piiMetadata.patternRedactionMappings as PatternRedactionMapping[],
            );

          processedResponse = patternReverseResult.originalText;
          patternReversalCount = patternReverseResult.reversalCount || 0;

          this.logger.debug(
            `🔄 [CENTRALIZED-ROUTING] Successfully reversed ${patternReversalCount} pattern redactions`,
          );
        } catch (error) {
          this.logger.warn(
            `🔄 [CENTRALIZED-ROUTING] Pattern reversal failed - continuing: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      // Step 2: Reverse dictionary pseudonyms (to restore dictionary values)
      if (
        piiMetadata.pseudonymInstructions &&
        piiMetadata.pseudonymInstructions.targetMatches.length > 0
      ) {
        // Extract mappings from pseudonymInstructions or use provided mappings
        const mappings: DictionaryPseudonymMapping[] =
          piiMetadata.pseudonymInstructions.targetMatches
            .filter((m) => m.pseudonym)
            .map((m) => ({
              originalValue: m.value,
              pseudonym: m.pseudonym!,
              dataType: m.dataType,
              category: 'dictionary',
            }));

        if (mappings.length > 0) {
          try {
            const pseudonymReverseResult =
              await this.dictionaryPseudonymizerService.reversePseudonyms(
                processedResponse,
                mappings,
              );

            processedResponse = pseudonymReverseResult.originalText;
            pseudonymReversalCount = pseudonymReverseResult.reversalCount || 0;

            this.logger.debug(
              `🔄 [CENTRALIZED-ROUTING] Successfully reversed ${pseudonymReversalCount} pseudonyms`,
            );
          } catch (error) {
            this.logger.warn(
              `🔄 [CENTRALIZED-ROUTING] Pseudonym reversal failed - returning original response: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          }
        }
      }

      // Update metadata with processing results
      const totalReversals = pseudonymReversalCount + patternReversalCount;
      const updatedMetadata: PIIProcessingMetadata = {
        ...piiMetadata,
        processingFlow: piiMetadata.processingFlow, // Keep original flow status
        pseudonymResults: piiMetadata.pseudonymResults
          ? {
              ...piiMetadata.pseudonymResults,
              reversalSuccess: pseudonymReversalCount > 0,
              reversalMatches:
                piiMetadata.pseudonymInstructions?.targetMatches || [],
            }
          : undefined,
        patternRedactionResults: piiMetadata.patternRedactionResults
          ? {
              ...piiMetadata.patternRedactionResults,
              reversalSuccess: patternReversalCount > 0,
              reversalCount: patternReversalCount,
            }
          : undefined,
        userMessage: {
          ...piiMetadata.userMessage,
          summary:
            piiMetadata.userMessage.summary +
            (totalReversals > 0 ? ` (${totalReversals} items restored)` : ''),
          actionsTaken: [
            ...piiMetadata.userMessage.actionsTaken,
            ...(patternReversalCount > 0
              ? [`Restored ${patternReversalCount} pattern redactions`]
              : []),
            ...(pseudonymReversalCount > 0
              ? [`Restored ${pseudonymReversalCount} pseudonyms`]
              : []),
          ],
        },
      };

      return {
        processedResponse,
        updatedMetadata,
        success: true,
      };
    } catch (error) {
      this.logger.error(
        `🔄 [CENTRALIZED-ROUTING] Agent response processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      return {
        processedResponse: agentResponse, // Return original on error
        updatedMetadata: piiMetadata,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * NEW ARCHITECTURE: Main routing method with PII metadata orchestration
   *
   * This is the primary orchestrator that:
   * 1. Calls PIIService for detection and metadata creation
   * 2. Makes routing decisions based on PII metadata
   * 3. Returns immediately for showstoppers or routes to agents
   */
  async determineRoute(
    prompt: string,
    options: {
      conversationId?: string;
      userId?: string;
      requestId?: string;
      providerName?: string;
      provider?: string;
      organizationId?: string;
      userSovereignMode?: boolean;
      model?: string;
      modelName?: string;
      dataType?: string;
      preferLocal?: boolean;
    } = {},
  ): Promise<RoutingDecision> {
    this.logger.debug(
      `🚀 [CENTRALIZED-ROUTING] determineRoute called with prompt: "${prompt.substring(0, 100)}..."`,
    );

    const startTime = Date.now();
    const request: LLMRequest = { prompt, options };
    const reasoningPath: string[] = [];
    const violations: string[] = [];
    const warnings: string[] = [];

    try {
      // Step 1: Check feature flag for sovereign routing
      const featureFlagContext: FeatureFlagContext = {
        userId: options.userId,
        organizationId: options.organizationId,
      };
      const sovereignRoutingEnabled =
        this.featureFlagService.isSovereignRoutingEnabled(featureFlagContext);

      let sovereignModeActive = false;
      let sovereignPolicy = null;

      if (sovereignRoutingEnabled) {
        reasoningPath.push('Sovereign routing feature flag: ENABLED');

        // Check sovereign mode policy
        sovereignPolicy = this.sovereignPolicyService.getPolicy();
        const userSovereignMode = options.userSovereignMode || false;
        sovereignModeActive = sovereignPolicy.enforced || userSovereignMode;

        if (sovereignModeActive) {
          reasoningPath.push(
            `Sovereign mode active (enforced: ${sovereignPolicy.enforced}, user: ${userSovereignMode})`,
          );
          reasoningPath.push(`Allowed providers: ollama only`);
        }
      } else {
        reasoningPath.push(
          'Sovereign routing feature flag: DISABLED - using legacy routing',
        );
        // Legacy behavior: no sovereign mode restrictions
      }

      // Step 1.5: NEW ARCHITECTURE - PII Policy Check with Metadata
      this.logger.debug(
        `🔍 [CENTRALIZED-ROUTING] Starting PII policy check with metadata creation`,
      );
      const piiResult = await this.piiService.checkPolicy(prompt, {
        conversationId: options.conversationId,
        userId: options.userId,
        requestId: options.requestId,
        providerName: options.providerName || options.provider,
      });

      this.logger.debug(`🔍 [CENTRALIZED-ROUTING] PII metadata created:`, {
        piiDetected: piiResult.metadata.piiDetected,
        showstopperDetected: piiResult.metadata.showstopperDetected,
        processingFlow: piiResult.metadata.processingFlow,
        totalMatches: piiResult.metadata.detectionResults?.totalMatches,
      });

      // Add PII policy reasoning to our routing path
      reasoningPath.push(...piiResult.metadata.policyDecision.reasoningPath);
      violations.push(...piiResult.metadata.policyDecision.violations);

      // Step 2: CRITICAL DECISION POINT - Check for showstoppers
      if (piiResult.metadata.showstopperDetected) {
        this.logger.warn(`🛑 [CENTRALIZED-ROUTING] SHOWSTOPPER DETECTED`);

        // If sovereign mode forces local or explicit provider is local, bypass blocking
        const explicitProvider = options.provider || options.providerName;
        const explicitLocal =
          explicitProvider &&
          String(explicitProvider).toLowerCase() === 'ollama';
        const explicitExternal =
          explicitProvider &&
          String(explicitProvider).toLowerCase() !== 'ollama' &&
          explicitProvider.toLowerCase() !== 'local';

        // If external provider is explicitly requested, block showstoppers (don't route to local)
        if (explicitExternal) {
          this.logger.warn(
            `🛑 [CENTRALIZED-ROUTING] External provider explicitly requested with showstopper - BLOCKING`,
          );
          // Fall through to blocking logic below
        } else {
          // Analyze complexity/tier to check local availability when not explicitly external
          const complexity = this.analyzeComplexity({ prompt, options });
          const tier = this.selectTierForComplexity(complexity);
          const localModelAvailable =
            await this.checkLocalModelAvailability(tier);

          if (explicitLocal || sovereignModeActive || localModelAvailable) {
            reasoningPath.push(
              'Showstopper detected, but routing to local model (bypass enforcement)',
            );
            const localModel = explicitLocal
              ? options.model ||
                options.modelName ||
                (await this.selectBestLocalModel(tier))
              : await this.selectBestLocalModel(tier);

            // Create minimal local PII metadata (no-op) for consistency
            const localPii = await this.piiService.checkPolicy(prompt, {
              conversationId: options.conversationId,
              userId: options.userId,
              requestId: options.requestId,
              providerName: 'ollama',
            });

            const localDecision: RoutingDecision = {
              provider: 'ollama',
              model: String(localModel),
              isLocal: true,
              modelTier: tier,
              fallbackUsed: false,
              complexityScore: this.getComplexityScore(complexity),
              reasoningPath,
              sovereignModeEnforced: sovereignModeActive,
              sovereignModeViolation: false,
              piiMetadata: localPii.metadata,
              originalPrompt: prompt,
              routeToAgent: true,
            };

            this.logRoutingDecision(
              request,
              localDecision,
              sovereignPolicy,
              sovereignModeActive,
              sovereignRoutingEnabled,
              violations,
              warnings,
              startTime,
            );

            return localDecision;
          }
        }

        // Block showstoppers when:
        // 1. External provider explicitly requested, OR
        // 2. No local model available and not in sovereign mode
        try {
          await this.runMetadataService.insertCompletedUsage({
            provider: 'policy',
            model: 'showstopper-pii',
            isLocal: true,
            userId: options.userId,
            callerType: 'agent',
            callerName: 'centralized-routing',
            conversationId: options.conversationId,
            inputTokens: 0,
            outputTokens: 0,
            totalCost: 0,
            startTime: startTime,
            endTime: Date.now(),
            status: 'blocked',
            enhancedMetrics: {
              dataSanitizationApplied: false,
              sanitizationLevel: 'none',
              piiDetected: true,
              showstopperDetected: true, // Critical: Mark showstopper as detected
              piiTypes: Object.keys(
                piiResult.metadata.detectionResults?.dataTypesSummary || {},
              ),
              pseudonymsUsed: 0,
              pseudonymTypes: [],
              redactionsApplied: (
                piiResult.metadata.detectionResults?.showstopperMatches || []
              ).length,
              redactionTypes: (
                piiResult.metadata.detectionResults?.showstopperMatches || []
              ).map((m: unknown) =>
                typeof m === 'object' && m !== null && 'dataType' in m
                  ? ((m as Record<string, unknown>).dataType as string)
                  : 'unknown',
              ),
            },
          });
        } catch {
          // Continue if logging fails
        }

        return {
          provider: 'policy-blocked',
          model: 'showstopper-pii',
          isLocal: true,
          fallbackUsed: false,
          complexityScore: 0,
          reasoningPath,
          piiMetadata: piiResult.metadata,
          originalPrompt: prompt,
          routeToAgent: false,
          blockingReason: 'showstopper-pii',
        };
      }

      // Step 3: No showstoppers - continue with routing logic
      this.logger.debug(
        `✅ [CENTRALIZED-ROUTING] No showstoppers detected, continuing with routing`,
      );

      // Use original prompt for complexity analysis (PII metadata will be passed to agents)
      const routingPrompt = prompt;

      // Step 4: Honor explicit provider/model requests (with sovereign mode validation)
      // Support both legacy fields (provider/model) and UI fields (providerName/modelName)
      const explicitProvider = options.provider || options.providerName;
      const explicitModel = options.model || options.modelName;
      if (explicitProvider && explicitModel) {
        reasoningPath.push(
          `Explicit provider/model requested: ${explicitProvider}/${explicitModel}`,
        );

        // Validate against sovereign mode if active and feature flag is enabled
        if (
          sovereignRoutingEnabled &&
          sovereignModeActive &&
          sovereignPolicy &&
          !this.sovereignPolicyService.isProviderAllowed(explicitProvider)
        ) {
          reasoningPath.push(
            `SOVEREIGN MODE VIOLATION: Provider ${explicitProvider} not allowed`,
          );
          this.logger.warn(
            `Sovereign mode violation: Provider ${explicitProvider} not allowed (only ollama permitted)`,
          );
          violations.push(
            `Explicit provider ${explicitProvider} blocked by sovereign mode policy`,
          );

          // Fall through to sovereign-compliant routing
        } else {
          const explicitDecision: RoutingDecision = {
            provider: explicitProvider,
            model: explicitModel,
            isLocal: explicitProvider.toLowerCase() === 'ollama',
            fallbackUsed: false,
            complexityScore: 0,
            reasoningPath,
            sovereignModeEnforced: sovereignModeActive,
            sovereignModeViolation: false,
            // NEW ARCHITECTURE: Include PII metadata
            piiMetadata: piiResult.metadata,
            originalPrompt: prompt,
            routeToAgent: true, // 🔥 KEY: Route to agents
          };

          // Log the explicit override decision
          this.logRoutingDecision(
            request,
            explicitDecision,
            sovereignPolicy,
            sovereignModeActive,
            sovereignRoutingEnabled,
            violations,
            warnings,
            startTime,
          );

          return explicitDecision;
        }
      }

      // Step 5: Analyze request complexity using original prompt
      const routingRequest: LLMRequest = { prompt: routingPrompt, options };
      const complexity = this.analyzeComplexity(routingRequest);
      const complexityScore = this.getComplexityScore(complexity);
      reasoningPath.push(
        `Complexity analysis: ${complexity} (score: ${complexityScore})`,
      );

      // Step 4: Select appropriate tier based on complexity
      const tier = this.selectTierForComplexity(complexity);
      reasoningPath.push(`Selected tier: ${tier}`);

      // Step 5: Determine provider preference (sovereign mode overrides user preference)
      let preferLocal = options.preferLocal !== false; // Default to true

      if (sovereignRoutingEnabled && sovereignModeActive) {
        // In sovereign mode, only local providers are allowed
        preferLocal = true;
        reasoningPath.push(
          'Sovereign mode: forced local preference (local providers only)',
        );
      }
      if (preferLocal) {
        reasoningPath.push('Attempting local-first routing');

        // For now, simulate local model availability check
        const localModelAvailable =
          await this.checkLocalModelAvailability(tier);

        if (localModelAvailable) {
          const localModel = await this.selectBestLocalModel(tier);
          reasoningPath.push(`Selected local model: ${localModel}`);

          const localDecision: RoutingDecision = {
            provider: 'ollama',
            model: localModel,
            isLocal: true,
            modelTier: tier,
            fallbackUsed: false,
            complexityScore,
            reasoningPath,
            sovereignModeEnforced: sovereignModeActive,
            sovereignModeViolation: false,
            // NEW ARCHITECTURE: Include PII metadata
            piiMetadata: piiResult.metadata,
            originalPrompt: prompt,
            routeToAgent: true, // 🔥 KEY: Route to agents
          };

          // Log the local model selection decision
          this.logRoutingDecision(
            request,
            localDecision,
            sovereignPolicy,
            sovereignModeActive,
            sovereignRoutingEnabled,
            violations,
            warnings,
            startTime,
          );

          return localDecision;
        } else {
          reasoningPath.push(
            'No local models available, falling back to external',
          );
        }
      }

      // Step 6: Fall back to external provider (blocked in sovereign mode)
      if (sovereignRoutingEnabled && sovereignModeActive) {
        // In sovereign mode, no external providers are allowed
        reasoningPath.push(
          'SOVEREIGN MODE: No external providers allowed, no local models available',
        );
        this.logger.error(
          'Sovereign mode violation: No local models available - check Ollama setup',
        );

        // Return error - this indicates a configuration issue that needs to be fixed
        violations.push(
          'No local models available in sovereign mode - configuration issue',
        );

        const sovereignErrorDecision: RoutingDecision = {
          provider: 'error',
          model: 'no_local_models_available',
          isLocal: false,
          modelTier: tier,
          fallbackUsed: true,
          complexityScore,
          reasoningPath,
          sovereignModeEnforced: true,
          sovereignModeViolation: false, // This is a setup issue, not a policy violation
          // NEW ARCHITECTURE: Include PII metadata even for errors
          piiMetadata: piiResult.metadata,
          originalPrompt: prompt,
          routeToAgent: false, // Don't route to agents for errors
          blockingReason: 'no-local-models-available',
          // Legacy fields for backward compatibility
        };

        // Log the sovereign mode error decision
        this.logRoutingDecision(
          request,
          sovereignErrorDecision,
          sovereignPolicy,
          sovereignModeActive,
          sovereignRoutingEnabled,
          violations,
          warnings,
          startTime,
        );

        return sovereignErrorDecision;
      }

      // No external fallback - throw error if no local models available
      reasoningPath.push(
        'No local models available and no external fallback configured',
      );
      violations.push(
        'No suitable LLM providers available - local models unavailable and external providers disabled',
      );

      throw new Error(
        `No suitable LLM providers available for tier '${tier}'. ` +
          `Local models are unavailable and external providers are disabled. ` +
          `Please ensure Ollama is running with appropriate models.`,
      );
    } catch (error) {
      this.logger.error('Error in routing decision', error);
      reasoningPath.push(
        `Error occurred: ${error instanceof Error ? error.message : 'Unknown error'}, no fallback available`,
      );
      violations.push(
        'Routing error occurred, no emergency fallback configured',
      );

      // No emergency fallback - let the error propagate
      throw new Error(
        `Routing failed: ${error instanceof Error ? error.message : 'Unknown error'}. No fallback provider configured.`,
      );
    }
  }

  /**
   * Analyze the complexity of a request using various heuristics
   */
  private analyzeComplexity(request: LLMRequest): ComplexityLevel {
    const { prompt } = request;

    // Basic metrics
    const wordCount = prompt.split(/\s+/).length;
    const sentenceCount = prompt
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 0).length;
    const avgWordsPerSentence =
      sentenceCount > 0 ? wordCount / sentenceCount : wordCount;

    // Advanced heuristics
    const hasCodeBlocks = /```[\s\S]*```|`[^`]+`/.test(prompt);
    const hasComplexQuestions =
      /\b(how|why|what|when|where|analyze|compare|evaluate|explain|describe)\b/gi.test(
        prompt,
      );
    const hasMultipleRequests =
      /\b(and|also|additionally|furthermore|moreover|then|next)\b/gi.test(
        prompt,
      );
    const hasTechnicalTerms =
      /\b(algorithm|database|api|function|class|method|variable|parameter|framework|library|deployment|architecture)\b/gi.test(
        prompt,
      );

    // Calculate complexity score
    let score = 0;

    // Word count scoring
    if (wordCount < 20) score += 1;
    else if (wordCount < 100) score += 3;
    else if (wordCount < 300) score += 5;
    else score += 7;

    // Sentence complexity
    if (avgWordsPerSentence > 15) score += 2;
    if (sentenceCount > 5) score += 2;

    // Content complexity
    if (hasCodeBlocks) score += 3;
    if (hasComplexQuestions) score += 2;
    if (hasMultipleRequests) score += 2;
    if (hasTechnicalTerms) score += 1;

    // Map score to complexity level
    if (score <= 4) return 'simple';
    if (score <= 8) return 'medium';
    return 'complex';
  }

  /**
   * Get numeric complexity score for tracking
   */
  private getComplexityScore(complexity: ComplexityLevel): number {
    switch (complexity) {
      case 'simple':
        return 3;
      case 'medium':
        return 6;
      case 'complex':
        return 9;
    }
  }

  /**
   * Select appropriate tier based on complexity
   */
  private selectTierForComplexity(complexity: ComplexityLevel): string {
    switch (complexity) {
      case 'simple':
        return 'ultra-fast';
      case 'medium':
        return 'general';
      case 'complex':
        return 'fast-thinking';
    }
  }

  /**
   * Check if local models are available for the given tier
   */
  private async checkLocalModelAvailability(tier: string): Promise<boolean> {
    try {
      const models = await this.localModelStatusService.getModelsByTier(tier);
      return (
        models.length > 0 && models.some((model) => model.status === 'loaded')
      );
    } catch (error) {
      this.logger.error(
        `Failed to check local model availability for tier ${tier}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Select the best local model for the given tier
   */
  private async selectBestLocalModel(tier: string): Promise<string> {
    try {
      const models = await this.localModelStatusService.getModelsByTier(tier);
      const availableModels = models.filter(
        (model) => model.status === 'loaded',
      );

      // If sovereign mode is active, we could add additional filtering here
      // For now, all local models are considered compliant with sovereign mode
      // since they're from the 'ollama' provider which should be in allowedProviders

      if (availableModels.length > 0) {
        // Return the first available model (they're already sorted by priority)
        return availableModels[0]?.name || 'qwen3:8b';
      }

      // Fallback to any model in the tier
      if (models.length > 0) {
        return models[0]?.name || 'qwen3:8b';
      }

      // Final fallback - query database for any model in this tier
      const fallbackModel = await this.getFallbackModelFromDatabase(tier);
      if (fallbackModel) {
        return fallbackModel;
      }

      // Ultimate emergency fallback
      return 'qwen3:8b';
    } catch (error) {
      this.logger.error(
        `Failed to select best local model for tier ${tier}:`,
        error,
      );

      // Emergency fallback - try database query even in error case
      try {
        const fallbackModel = await this.getFallbackModelFromDatabase(tier);
        if (fallbackModel) {
          return fallbackModel;
        }
      } catch (_fallbackError) {
        this.logger.error(`Database fallback also failed:`, _fallbackError);
      }

      // Ultimate emergency fallback
      return 'qwen3:8b';
    }
  }

  /**
   * Get fallback model from database for the given tier
   */
  private async getFallbackModelFromDatabase(
    tier: string,
  ): Promise<string | null> {
    try {
      const { data: models, error } = (await this.db
        .from(null, 'llm_models')
        .select('model_name')
        .eq('is_local', true)
        .eq('model_tier', tier)
        .eq('is_active', true)
        .order('loading_priority', { ascending: false })
        .limit(1)) as QueryResult<unknown>;

      if (error) {
        this.logger.error(
          `Failed to query fallback model for tier ${tier}:`,
          error,
        );
        return null;
      }

      const typedModels = models as Array<{ model_name: string }> | null;
      return typedModels?.[0]?.model_name || null;
    } catch (error) {
      this.logger.error(`Database query failed for fallback model:`, error);
      return null;
    }
  }

  /**
   * Create and log comprehensive audit information for routing decisions
   */
  private logRoutingDecision(
    request: LLMRequest,
    decision: RoutingDecision,
    sovereignPolicy: {
      auditLevel?: string;
      enforced?: boolean;
      defaultMode?: string;
    } | null,
    sovereignModeActive: boolean,
    sovereignRoutingEnabled: boolean,
    violations: string[],
    warnings: string[],
    startTime: number,
  ): void {
    const auditLevel = sovereignPolicy?.auditLevel || 'none';

    // Only log if audit level is not 'none'
    if (auditLevel === 'none') {
      return;
    }

    const endTime = Date.now();
    const promptHash = createHash('sha256')
      .update(request.prompt)
      .digest('hex')
      .substring(0, 16);

    const auditLog: RoutingAuditLog = {
      timestamp: new Date().toISOString(),
      userId: request.options?.userId,
      organizationId: request.options?.organizationId,
      requestId: request.options?.requestId as string | undefined,
      prompt: {
        length: request.prompt.length,
        wordCount: request.prompt.split(/\s+/).length,
        hash: promptHash,
      },
      sovereignMode: {
        enabled: sovereignModeActive,
        enforced: sovereignPolicy?.enforced || false,
        defaultMode: sovereignPolicy?.defaultMode || 'relaxed',
        auditLevel: auditLevel,
      },
      featureFlags: {
        sovereignRoutingEnabled: sovereignRoutingEnabled,
      },
      routing: {
        complexityScore: decision.complexityScore || 0,
        tier: decision.modelTier || 'unknown',
        preferLocal: sovereignModeActive,
        localModelsAvailable: decision.provider !== 'error',
        selectedProvider: decision.provider,
        selectedModel: decision.model,
        isLocal: decision.isLocal,
        fallbackUsed: decision.fallbackUsed || false,
        reasoningPath: decision.reasoningPath || [],
      },
      policy: {
        violations: violations,
        warnings: warnings,
      },
      performance: {
        routingDurationMs: endTime - startTime,
      },
    };

    // Log based on audit level
    if (auditLevel === 'basic') {
      this.logger.log(
        `ROUTING_AUDIT: ${decision.provider}/${decision.model} | User: ${auditLog.userId} | Org: ${auditLog.organizationId} | Sovereign: ${sovereignModeActive} | Duration: ${auditLog.performance.routingDurationMs}ms`,
      );
    } else if (auditLevel === 'full') {
      this.logger.log(`ROUTING_AUDIT_FULL: ${JSON.stringify(auditLog)}`);
    }

    // Always log violations and warnings
    if (violations.length > 0) {
      this.logger.warn(
        `SOVEREIGN_VIOLATIONS: ${violations.join(', ')} | User: ${auditLog.userId} | Provider: ${decision.provider}`,
      );
    }

    if (warnings.length > 0) {
      this.logger.warn(
        `SOVEREIGN_WARNINGS: ${warnings.join(', ')} | User: ${auditLog.userId} | Provider: ${decision.provider}`,
      );
    }
  }

  /**
   * Get external provider fallback for the given tier
   */
  private getExternalFallback(
    tier: string,
  ): Omit<
    RoutingDecision,
    'complexityScore' | 'reasoningPath' | 'fallbackUsed'
  > {
    // Define tier-based provider preferences (in order of preference)
    const tierProviderMap: Record<
      string,
      Array<{ provider: string; model: string; modelTier: string }>
    > = {
      'fast-thinking': [
        { provider: 'openai', model: 'gpt-4', modelTier: 'external-advanced' },
        {
          provider: 'anthropic',
          model: 'claude-3-opus',
          modelTier: 'external-advanced',
        },
        {
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          modelTier: 'external-standard',
        },
      ],
      general: [
        {
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          modelTier: 'external-standard',
        },
        {
          provider: 'anthropic',
          model: 'claude-3-haiku',
          modelTier: 'external-standard',
        },
        { provider: 'openai', model: 'gpt-4', modelTier: 'external-advanced' },
      ],
      'ultra-fast': [
        {
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          modelTier: 'external-fast',
        },
        {
          provider: 'anthropic',
          model: 'claude-3-haiku',
          modelTier: 'external-fast',
        },
      ],
    };

    const candidates = tierProviderMap[tier] || tierProviderMap['general'];

    // Use first available external provider (sovereign mode is handled by caller)
    if (candidates && candidates.length > 0) {
      const selected = candidates[0]!; // We know it exists because we checked length > 0
      return {
        provider: selected.provider,
        model: selected.model,
        isLocal: false,
        modelTier: selected.modelTier,
      };
    }

    // No fallback - throw error if no candidates available
    throw new Error(
      'No suitable LLM providers available for the requested tier. Please configure at least one provider.',
    );
  }

  /**
   * Get routing statistics for monitoring
   */
  getRoutingStats(): {
    totalRequests: number;
    localRoutes: number;
    externalRoutes: number;
    fallbackRoutes: number;
    avgComplexityScore: number;
  } {
    // TODO: Implement actual statistics tracking
    return {
      totalRequests: 0,
      localRoutes: 0,
      externalRoutes: 0,
      fallbackRoutes: 0,
      avgComplexityScore: 0,
    };
  }
}
