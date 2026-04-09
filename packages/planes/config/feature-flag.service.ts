import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FeatureFlagContext {
  userId?: string;
  organizationId?: string;
  userAgent?: string;
  ipAddress?: string;
  [key: string]: unknown;
}

export interface FeatureFlagConfig {
  enabled: boolean;
  rolloutPercentage?: number;
  targetUsers?: string[];
  targetOrganizations?: string[];
  excludeUsers?: string[];
  excludeOrganizations?: string[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class FeatureFlagService {
  constructor(@Inject(ConfigService) private configService: ConfigService) {}

  isEnabled(flagName: string, context: FeatureFlagContext = {}): boolean {
    const config = this.getFlagConfig(flagName);

    if (!config.enabled) {
      return false;
    }

    if (this.isExcluded(config, context)) {
      return false;
    }

    if (this.isSpecificallyTargeted(config, context)) {
      return true;
    }

    if (config.rolloutPercentage !== undefined) {
      return this.isInRolloutPercentage(
        flagName,
        context,
        config.rolloutPercentage,
      );
    }

    return config.enabled;
  }

  private getFlagConfig(flagName: string): FeatureFlagConfig {
    const envPrefix = `FEATURE_FLAG_${flagName.toUpperCase()}`;

    const enabled =
      this.configService.get(`${envPrefix}_ENABLED`, 'false') === 'true';
    const rolloutPercentage = this.parseNumber(
      this.configService.get(`${envPrefix}_ROLLOUT_PERCENTAGE`),
    );
    const targetUsers = this.parseArray(
      this.configService.get(`${envPrefix}_TARGET_USERS`),
    );
    const targetOrganizations = this.parseArray(
      this.configService.get(`${envPrefix}_TARGET_ORGANIZATIONS`),
    );
    const excludeUsers = this.parseArray(
      this.configService.get(`${envPrefix}_EXCLUDE_USERS`),
    );
    const excludeOrganizations = this.parseArray(
      this.configService.get(`${envPrefix}_EXCLUDE_ORGANIZATIONS`),
    );

    return {
      enabled,
      rolloutPercentage,
      targetUsers,
      targetOrganizations,
      excludeUsers,
      excludeOrganizations,
    };
  }

  private isExcluded(
    config: FeatureFlagConfig,
    context: FeatureFlagContext,
  ): boolean {
    if (
      config.excludeUsers &&
      context.userId &&
      config.excludeUsers.includes(context.userId)
    ) {
      return true;
    }

    if (
      config.excludeOrganizations &&
      context.organizationId &&
      config.excludeOrganizations.includes(context.organizationId)
    ) {
      return true;
    }

    return false;
  }

  private isSpecificallyTargeted(
    config: FeatureFlagConfig,
    context: FeatureFlagContext,
  ): boolean {
    if (
      config.targetUsers &&
      context.userId &&
      config.targetUsers.includes(context.userId)
    ) {
      return true;
    }

    if (
      config.targetOrganizations &&
      context.organizationId &&
      config.targetOrganizations.includes(context.organizationId)
    ) {
      return true;
    }

    return false;
  }

  private isInRolloutPercentage(
    flagName: string,
    context: FeatureFlagContext,
    percentage: number,
  ): boolean {
    if (percentage <= 0) return false;
    if (percentage >= 100) return true;

    const identifier = context.userId || context.organizationId || 'anonymous';
    const hashInput = `${flagName}:${identifier}`;
    const hash = this.simpleHash(hashInput);
    const userPercentage = hash % 100;

    return userPercentage < percentage;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private parseArray(value: string | undefined): string[] | undefined {
    if (!value || value.trim() === '') {
      return undefined;
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private parseNumber(value: string | undefined): number | undefined {
    if (!value || value.trim() === '') {
      return undefined;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
  }

  getAllFlags(): Record<string, FeatureFlagConfig> {
    const knownFlags = ['SOVEREIGN_ROUTING'];
    const flags: Record<string, FeatureFlagConfig> = {};

    for (const flagName of knownFlags) {
      flags[flagName] = this.getFlagConfig(flagName);
    }

    return flags;
  }

  isSovereignRoutingEnabled(context: FeatureFlagContext = {}): boolean {
    return this.isEnabled('SOVEREIGN_ROUTING', context);
  }
}
