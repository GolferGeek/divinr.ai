import type { AgentProduct } from '../agent-contracts/catalog';
import type { VerifiedAgentPrincipal } from '../oauth/dpop-resource.service';

export interface ImmutableVerifiedAgentPrincipal {
  readonly userId: string;
  readonly installationInternalId: string;
  readonly installationId: string;
  readonly grantInternalId: string;
  readonly grantId: string;
  readonly scopes: readonly string[];
  readonly dpopJkt: string;
  readonly accessTokenJti: string;
}

export interface ValidatedInitialAgentCommand {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly contextId: string;
  readonly messageId: string;
  readonly skillId: 'general_updates' | 'personal_updates';
  readonly product: Readonly<AgentProduct>;
  readonly businessInput: Readonly<Record<string, unknown>>;
  readonly businessInputHash: string;
  readonly baseIntent: Readonly<Record<string, unknown>>;
  readonly baseIntentHash: string;
  readonly currentIntentHash: string;
}

export function deepFreezeJson<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreezeJson(member);
    }
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

export function immutablePrincipal(
  principal: VerifiedAgentPrincipal,
): ImmutableVerifiedAgentPrincipal {
  return Object.freeze({
    userId: principal.userId,
    installationInternalId: principal.installationInternalId,
    installationId: principal.installationId,
    grantInternalId: principal.grantInternalId,
    grantId: principal.grantId,
    scopes: Object.freeze([...principal.scopes].sort()),
    dpopJkt: principal.dpopJkt,
    accessTokenJti: principal.accessTokenJti,
  });
}
