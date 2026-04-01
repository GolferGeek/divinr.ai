import { Injectable, Logger } from '@nestjs/common';

export interface LogEntry {
  runId: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface RedactionPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  description: string;
}

export interface RedactionResult {
  originalLength: number;
  redactedLength: number;
  redactionCount: number;
  patternsMatched: string[];
}

@Injectable()
export class SecretRedactionService {
  private readonly logger = new Logger(SecretRedactionService.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';
  private readonly enableVerboseLogging =
    process.env.ENABLE_VERBOSE_LOGGING === 'true';

  // Predefined redaction patterns for common secrets
  // More specific patterns first to avoid generic API key pattern conflicts
  private readonly redactionPatterns: RedactionPattern[] = [
    {
      name: 'openai_key',
      pattern: /sk-[a-zA-Z0-9]{48}/g,
      replacement: 'sk-[REDACTED]',
      description: 'OpenAI API keys',
    },
    {
      name: 'anthropic_key',
      pattern: /sk-ant-api03-[a-zA-Z0-9_-]{95}/g,
      replacement: 'sk-ant-[REDACTED]',
      description: 'Anthropic API keys',
    },
    {
      name: 'anthropic_general_key',
      pattern: /\bsk-ant-[a-zA-Z0-9_-]+\b/gi,
      replacement: 'sk-ant-[REDACTED]',
      description: 'General Anthropic keys (any sk-ant- prefix)',
    },
    {
      name: 'sk_general_key',
      pattern: /\bSK-[a-zA-Z0-9]+\b/gi,
      replacement: 'SK-[REDACTED]',
      description: 'General SK- prefixed keys (case insensitive)',
    },
    {
      name: 'google_key',
      pattern: /AIza[a-zA-Z0-9_-]{35}/g,
      replacement: 'AIza[REDACTED]',
      description: 'Google API keys',
    },
    {
      name: 'google_general_key',
      pattern: /\bAIza[a-zA-Z0-9_-]+\b/gi,
      replacement: 'AIza[REDACTED]',
      description: 'General Google API keys (any AIza prefix)',
    },
    {
      name: 'xai_key',
      pattern: /\bxai-[a-zA-Z0-9_-]+\b/gi,
      replacement: 'xai-[REDACTED]',
      description: 'xAI API keys',
    },
    {
      name: 'mistral_key',
      pattern: /\b(?:mistral|mst)-[a-zA-Z0-9_-]+\b/gi,
      replacement: 'mistral-[REDACTED]',
      description: 'Mistral AI API keys',
    },
    {
      name: 'cohere_key',
      pattern: /\b(?:co|cohere)-[a-zA-Z0-9_-]+\b/gi,
      replacement: 'cohere-[REDACTED]',
      description: 'Cohere API keys',
    },
    {
      name: 'huggingface_key',
      pattern: /\bhf_[a-zA-Z0-9_-]+\b/gi,
      replacement: 'hf_[REDACTED]',
      description: 'Hugging Face API keys',
    },
    {
      name: 'replicate_key',
      pattern: /\br8_[a-zA-Z0-9_-]+\b/gi,
      replacement: 'r8_[REDACTED]',
      description: 'Replicate API keys',
    },
    {
      name: 'together_key',
      pattern: /\b(?:together|tg)-[a-zA-Z0-9_-]+\b/gi,
      replacement: 'together-[REDACTED]',
      description: 'Together AI API keys',
    },
    {
      name: 'aws_key',
      pattern: /AKIA[0-9A-Z]{16}/g,
      replacement: 'AKIA[REDACTED]',
      description: 'AWS access keys',
    },
    {
      name: 'jwt_token',
      pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*/g,
      replacement: 'eyJ[REDACTED]',
      description: 'JWT tokens',
    },
    {
      name: 'bearer_token',
      pattern:
        /(?:Authorization\s*:\s*Bearer\s+|bearer[\s:]+|Bearer[\s:]+|[a-zA-Z_-]*(?:access[_-]?token|auth[_-]?token|session[_-]?token|refresh[_-]?token|id[_-]?token)[_-]*\s+|[a-zA-Z_-]*(?:access[_-]?token|auth[_-]?token|session[_-]?token|refresh[_-]?token|id[_-]?token)[_-]*\s*[:=]\s*|token[\s:=]+)([a-zA-Z0-9_.]{20,})/gi,
      replacement: 'bearer [REDACTED]',
      description: 'Bearer tokens',
    },
    {
      name: 'password',
      pattern:
        /\b(?:[a-zA-Z_-]*(?:password|pwd|pass)[_-]*)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi,
      replacement: 'password=[REDACTED]',
      description: 'Passwords',
    },
    {
      name: 'database_url',
      pattern: /(?:postgresql|mysql|mongodb):\/\/[^:\s]+:[^@\s]+@[^\s]+/gi,
      replacement: 'database://[REDACTED]',
      description: 'Database connection strings',
    },
    {
      name: 'ssn',
      pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
      replacement: '[SSN_REDACTED]',
      description: 'Social Security Numbers',
    },
    {
      name: 'email',
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      replacement: '[EMAIL_REDACTED]',
      description: 'Email addresses',
    },
    {
      name: 'ipAddress',
      pattern:
        /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
      replacement: '[IP_ADDRESS_REDACTED]',
      description: 'IP addresses',
    },
    {
      name: 'internalUrl',
      pattern:
        /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|[a-zA-Z0-9-]+\.(?:local|internal|corp|test|dev))[^\s]*/g,
      replacement: '[INTERNAL_URL_REDACTED]',
      description: 'Internal URLs',
    },
    {
      name: 'phone',
      pattern: /\b(?:\(\d{3}\)\s?|\d{3}[-.]?)\d{3}[-.]?\d{4}\b/g,
      replacement: '[PHONE_REDACTED]',
      description: 'Phone numbers',
    },
    {
      name: 'credit_card',
      pattern:
        /\b(?:(?:\d{4}[-\s]?){3}\d{4}|\d{4}[-\s]?\d{6}[-\s]?\d{5}|\d{15,16})\b/g,
      replacement: '[CREDIT_CARD_REDACTED]',
      description: 'Credit card numbers',
    },
    {
      name: 'ssh_key',
      pattern:
        /-----BEGIN (?:[A-Z\s]*)?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z\s]*)?PRIVATE KEY-----/gi,
      replacement: '-----BEGIN [REDACTED] PRIVATE KEY-----',
      description: 'SSH private keys',
    },
    // Generic API key pattern last to avoid conflicts with specific patterns
    {
      name: 'api_key',
      pattern:
        /\b(?:[a-zA-Z_-]*(?:api[_-]?key|apikey|key|secret|token)[_-]*)\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
      replacement: 'api_key=[REDACTED]',
      description: 'API keys and similar tokens',
    },
  ];

  constructor() {
    this.logger.log(
      `SecretRedactionService initialized (production: ${this.isProduction})`,
    );
  }

  /**
   * Redact secrets from text using predefined patterns
   */
  redactSecrets(text: string): {
    redactedText: string;
    result: RedactionResult;
  } {
    if (!text) {
      return {
        redactedText: text,
        result: {
          originalLength: 0,
          redactedLength: 0,
          redactionCount: 0,
          patternsMatched: [],
        },
      };
    }

    let redactedText = text;
    let totalRedactionCount = 0;
    const patternsMatched: string[] = [];
    const originalLength = text.length;

    // Apply each redaction pattern
    for (const pattern of this.redactionPatterns) {
      const matches = redactedText.match(pattern.pattern);
      if (matches) {
        redactedText = redactedText.replace(
          pattern.pattern,
          pattern.replacement,
        );
        totalRedactionCount += matches.length;
        patternsMatched.push(pattern.name);
      }
    }

    const result: RedactionResult = {
      originalLength,
      redactedLength: redactedText.length,
      redactionCount: totalRedactionCount,
      patternsMatched,
    };

    return { redactedText, result };
  }

  /**
   * Safe logging method that automatically redacts secrets
   */
  safeLog(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    runId?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    // Skip verbose logging in production unless explicitly enabled
    if (this.isProduction && level === 'debug' && !this.enableVerboseLogging) {
      return;
    }

    // Redact secrets from the message
    const { redactedText } = this.redactSecrets(message);

    // Redact secrets from metadata if provided
    let redactedMetadata = metadata;
    if (metadata) {
      redactedMetadata = this.redactObjectSecrets(metadata) as Record<
        string,
        unknown
      >;
    }

    // Create structured log entry
    const logEntry: LogEntry = {
      runId: runId || 'system',
      timestamp: new Date().toISOString(),
      level,
      message: redactedText,
      context,
      metadata: redactedMetadata,
    };

    // Log using NestJS logger with appropriate level
    const logMessage = this.formatLogMessage(logEntry);

    switch (level) {
      case 'debug':
        this.logger.debug(logMessage);
        break;
      case 'info':
        this.logger.log(logMessage);
        break;
      case 'warn':
        this.logger.warn(logMessage);
        break;
      case 'error':
        this.logger.error(logMessage);
        break;
    }
  }

  /**
   * Redact secrets from an object (recursive)
   */
  private redactObjectSecrets(obj: Record<string, unknown>): unknown {
    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') {
        return this.redactSecrets(obj).redactedText;
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) =>
        this.redactObjectSecrets(item as Record<string, unknown>),
      );
    }

    const redactedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if the key itself suggests sensitive data
      const sensitiveKeys = [
        'password',
        'token',
        'key',
        'secret',
        'auth',
        'credential',
      ];
      const isSensitiveKey = sensitiveKeys.some((sensitiveKey) =>
        key.toLowerCase().includes(sensitiveKey),
      );

      if (isSensitiveKey && typeof value === 'string') {
        redactedObj[key] = '[REDACTED]';
      } else {
        redactedObj[key] = this.redactObjectSecrets(
          value as Record<string, unknown>,
        );
      }
    }

    return redactedObj;
  }

  /**
   * Format log message for structured logging
   */
  private formatLogMessage(logEntry: LogEntry): string {
    const parts = [`[${logEntry.runId}]`, logEntry.message];

    if (logEntry.context) {
      parts.push(`(${logEntry.context})`);
    }

    if (logEntry.metadata && Object.keys(logEntry.metadata).length > 0) {
      parts.push(JSON.stringify(logEntry.metadata));
    }

    return parts.join(' ');
  }

  /**
   * Add custom redaction pattern
   */
  addRedactionPattern(pattern: RedactionPattern): void {
    this.redactionPatterns.push(pattern);
    this.logger.debug(`Added custom redaction pattern: ${pattern.name}`);
  }

  /**
   * Remove redaction pattern by name
   */
  removeRedactionPattern(name: string): boolean {
    const index = this.redactionPatterns.findIndex((p) => p.name === name);
    if (index >= 0) {
      this.redactionPatterns.splice(index, 1);
      this.logger.debug(`Removed redaction pattern: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Get all available redaction patterns
   */
  getRedactionPatterns(): RedactionPattern[] {
    return [...this.redactionPatterns];
  }

  /**
   * Test redaction patterns against sample text
   */
  testRedaction(text: string): {
    redactedText: string;
    result: RedactionResult;
    patternDetails: Array<{
      name: string;
      matches: number;
      description: string;
    }>;
  } {
    const { redactedText, result } = this.redactSecrets(text);

    const patternDetails = this.redactionPatterns
      .map((pattern) => {
        const matches = text.match(pattern.pattern);
        return {
          name: pattern.name,
          matches: matches ? matches.length : 0,
          description: pattern.description,
        };
      })
      .filter((detail) => detail.matches > 0);

    return {
      redactedText,
      result,
      patternDetails,
    };
  }

  /**
   * Convenience methods for different log levels with runId correlation
   */
  debug(
    message: string,
    runId?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.safeLog('debug', message, runId, context, metadata);
  }

  info(
    message: string,
    runId?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.safeLog('info', message, runId, context, metadata);
  }

  warn(
    message: string,
    runId?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.safeLog('warn', message, runId, context, metadata);
  }

  error(
    message: string,
    runId?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.safeLog('error', message, runId, context, metadata);
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalPatterns: number;
    productionMode: boolean;
    verboseLogging: boolean;
    customPatterns: number;
  } {
    const defaultPatternCount = 11; // Number of predefined patterns
    const customPatterns = Math.max(
      0,
      this.redactionPatterns.length - defaultPatternCount,
    );

    return {
      totalPatterns: this.redactionPatterns.length,
      productionMode: this.isProduction,
      verboseLogging: this.enableVerboseLogging,
      customPatterns,
    };
  }
}
