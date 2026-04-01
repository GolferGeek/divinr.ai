/**
 * PII Processing Metadata Types
 *
 * This file defines the metadata structure that flows through the entire
 * pseudonymization system from detection to UI response.
 */

export type PIIDataType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'name'
  | 'address'
  | 'ip_address'
  | 'url'
  | 'username' // Added to match PIIPatternService
  | 'custom';

export type PIISeverity = 'showstopper' | 'warning' | 'info';

export interface PIIMatch {
  /** The actual PII value detected */
  value: string;
  /** Type of PII detected */
  dataType: PIIDataType;
  /** Severity level determining processing rules */
  severity: PIISeverity;
  /** Confidence score from detection (0.0 to 1.0) */
  confidence: number;
  /** Position in original text */
  startIndex: number;
  /** End position in original text */
  endIndex: number;
  /** Which pattern/rule matched */
  pattern: string;
  /** Generated pseudonym (populated during processing) */
  pseudonym?: string;
}

export interface DataTypeSummary {
  count: number;
  severity: PIISeverity;
  /** Truncated examples for UI display (e.g., "abc...", "***") */
  examples: string[];
}

export interface SeverityBreakdown {
  showstopper: number;
  warning: number;
  info: number;
}

export interface PolicyDecision {
  /** Whether the request is allowed to proceed */
  allowed: boolean;
  /** Whether the request was blocked */
  blocked: boolean;
  /** Reason for blocking if applicable */
  blockingReason?: 'showstopper-pii' | 'policy-violation';
  /** List of policy violations */
  violations: string[];
  /** Step-by-step reasoning for the decision */
  reasoningPath: string[];
  /** Context this policy was applied for */
  appliedFor: 'local' | 'external' | 'policy-blocked';
  /** Specific showstopper types that caused blocking */
  showstopperTypes?: string[];
}

export interface PseudonymInstructions {
  /** Whether pseudonymization should be applied */
  shouldPseudonymize: boolean;
  /** Specific matches to be pseudonymized */
  targetMatches: PIIMatch[];
  /** Unique request identifier for pseudonym mapping */
  requestId: string;
  /** Context for pseudonymization (e.g., 'llm-boundary') */
  context: string;
}

export interface PseudonymResults {
  /** Whether pseudonymization was actually applied */
  applied: boolean;
  /** Matches that were processed with pseudonyms */
  processedMatches: PIIMatch[];
  /** Number of pseudonym mappings created */
  mappingsCount: number;
  /** Time taken for pseudonymization in milliseconds */
  processingTimeMs: number;
  /** Whether reversal was successful (populated after reversal) */
  reversalSuccess?: boolean;
  /** Matches that were reversed (populated after reversal) */
  reversalMatches?: PIIMatch[];
}

export interface UserMessage {
  /** Brief summary for the user */
  summary: string;
  /** Detailed breakdown of what was detected/processed */
  details: string[];
  /** Actions taken by the system */
  actionsTaken: string[];
  /** Whether the request was blocked */
  isBlocked: boolean;
  /** Additional details for blocked requests */
  blockingDetails?: {
    showstopperTypes: string[];
    affectedCount: number;
    recommendation: string;
  };
}

export interface ProcessingTimestamps {
  /** When PII detection started */
  detectionStart: number;
  /** When showstopper check completed (if applicable) */
  showstopperCheck?: number;
  /** When policy check completed (only if no showstoppers) */
  policyCheck?: number;
  /** When pseudonymization was applied (only if applied) */
  pseudonymApplied?: number;
  /** When pseudonymization was reversed (only if reversed) */
  pseudonymReversed?: number;
}

export type ProcessingFlow =
  | 'showstopper-blocked' // Request blocked due to showstoppers
  | 'policy-blocked' // Request blocked due to other policy violations
  | 'pseudonymized' // Request processed with pseudonymization
  | 'allowed-local'; // Request allowed without pseudonymization (local provider)

/**
 * Complete PII Processing Metadata
 *
 * This structure flows through the entire system from PIIService detection
 * through to the frontend UI, providing complete transparency about PII processing.
 */
export interface PIIProcessingMetadata {
  // Detection Results
  /** Whether any PII was detected */
  piiDetected: boolean;
  /** Whether showstopper PII was detected (triggers early exit) */
  showstopperDetected: boolean;

  detectionResults: {
    /** Total number of PII matches found */
    totalMatches: number;
    /** Complete list of all flagged matches */
    flaggedMatches: PIIMatch[];
    /** Specific showstopper matches that caused blocking */
    showstopperMatches?: PIIMatch[];
    /** Summary by data type for UI display */
    dataTypesSummary: Record<string, DataTypeSummary>;
    /** Breakdown by severity level */
    severityBreakdown: SeverityBreakdown;
  };

  // Policy Decision
  policyDecision: PolicyDecision;

  // Pseudonymization Instructions (only if no showstoppers)
  pseudonymInstructions?: PseudonymInstructions;

  // Processing Results (populated at LLM boundary, never for showstoppers)
  pseudonymResults?: PseudonymResults;

  // Pattern Redaction (applied alongside pseudonymization)
  patternRedactionsApplied?: Array<{
    original: string;
    redacted: string;
    dataType: string;
  }>;
  patternRedactionMappings?: Array<{
    originalValue: string;
    redactedValue: string;
    dataType: string;
    startIndex: number;
    endIndex: number;
    patternName: string;
  }>;
  patternRedactionResults?: {
    applied: boolean;
    redactionCount: number;
    processingTimeMs: number;
    reversalSuccess?: boolean;
    reversalCount?: number;
  };

  // User-Facing Messages
  userMessage: UserMessage;

  // Processing Flow Tracking
  /** High-level processing flow indicator */
  processingFlow: ProcessingFlow;
  /** Detailed step-by-step processing log */
  processingSteps: string[];
  /** Timing information for performance monitoring */
  timestamps: ProcessingTimestamps;
  /** Flattened flaggings array for downstream analytics */
  flaggings?: unknown[];
  /** Applied pseudonyms for transparency/debugging */
  pseudonymsApplied?: Array<{
    original: string;
    pseudonym: string;
    type: string;
  }>;
  /** Sanitization level applied to the request */
  sanitizationLevel?: 'none' | 'basic' | 'standard' | 'strict';
}

/**
 * Extended routing decision that includes PII metadata
 */
export interface RoutingDecisionWithPII {
  // Standard routing fields
  provider: string;
  model: string;
  isLocal: boolean;
  modelTier?: string;
  fallbackUsed: boolean;
  complexityScore: number;
  reasoningPath: string[];

  // PII-specific fields
  /** Complete PII processing metadata */
  piiMetadata?: PIIProcessingMetadata;
  /** Original prompt before any processing */
  originalPrompt: string;
  /** Whether to route to agents or return immediately */
  routeToAgent: boolean;
  /** Reason for blocking if not routing to agents */
  blockingReason?: string;

  // Legacy fields for compatibility
  sovereignModeEnforced?: boolean;
  sovereignModeViolation?: boolean;
  sanitizationResult?: Record<string, unknown>;
  sanitizedPrompt?: string;
}
