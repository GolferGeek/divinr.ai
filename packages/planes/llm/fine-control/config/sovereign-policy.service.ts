import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SovereignPolicy {
  enforced: boolean;
  defaultMode: 'strict' | 'relaxed';
  auditLevel: 'none' | 'basic' | 'full';
  realtimeUpdates: boolean;
}

@Injectable()
export class SovereignPolicyService {
  private readonly logger = new Logger(SovereignPolicyService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Get the current sovereign mode policy from environment variables
   */
  getPolicy(): SovereignPolicy {
    const enforced =
      this.configService.get('SOVEREIGN_MODE_ENFORCED', 'false') === 'true';
    const defaultModeStr: string = this.configService.get(
      'SOVEREIGN_MODE_DEFAULT',
      'relaxed',
    );
    const defaultMode =
      defaultModeStr === 'strict' || defaultModeStr === 'relaxed'
        ? defaultModeStr
        : 'relaxed';
    const auditLevelStr: string = this.configService.get(
      'SOVEREIGN_MODE_AUDIT_LEVEL',
      'basic',
    );
    const auditLevel =
      auditLevelStr === 'none' ||
      auditLevelStr === 'basic' ||
      auditLevelStr === 'full'
        ? auditLevelStr
        : 'basic';
    const realtimeUpdates =
      this.configService.get('SOVEREIGN_MODE_REALTIME_UPDATES', 'true') ===
      'true';

    return {
      enforced,
      defaultMode,
      auditLevel,
      realtimeUpdates,
    };
  }

  /**
   * Check if sovereign mode is enforced organization-wide
   */
  isEnforced(): boolean {
    return this.getPolicy().enforced;
  }

  /**
   * Get the default sovereign mode for new users
   */
  getDefaultMode(): 'strict' | 'relaxed' {
    return this.getPolicy().defaultMode;
  }

  /**
   * Get audit logging level
   */
  getAuditLevel(): 'none' | 'basic' | 'full' {
    return this.getPolicy().auditLevel;
  }

  /**
   * Check if a provider is allowed in sovereign mode
   * In sovereign mode, only ollama is allowed
   */
  isProviderAllowed(provider: string): boolean {
    return provider.toLowerCase() === 'ollama';
  }

  /**
   * Validate current policy configuration and return warnings
   */
  validatePolicy(): { valid: boolean; warnings: string[] } {
    const policy = this.getPolicy();
    const warnings: string[] = [];

    // If enforced is true, default should probably be strict
    if (policy.enforced && policy.defaultMode === 'relaxed') {
      warnings.push(
        'Sovereign mode is enforced but default mode is relaxed. Consider setting SOVEREIGN_MODE_DEFAULT=strict for consistency.',
      );
    }

    // If audit level is 'none' but enforced is true, suggest basic logging
    if (policy.enforced && policy.auditLevel === 'none') {
      warnings.push(
        'Sovereign mode is enforced but audit level is none. Consider enabling basic audit logging for compliance.',
      );
    }

    return {
      valid: warnings.length === 0,
      warnings,
    };
  }
}
