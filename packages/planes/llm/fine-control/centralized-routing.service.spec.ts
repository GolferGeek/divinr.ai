import { CentralizedRoutingService } from './centralized-routing.service';
import { LocalModelStatusService } from './local-model-status.service';
import { DatabaseService } from '@/database';
import { SovereignPolicyService } from './config/sovereign-policy.service';
import { FeatureFlagService } from '@/config/feature-flag.service';
import { PIIService } from './pii/pii.service';
import { DictionaryPseudonymizerService } from './pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from './run-metadata.service';
import { createMockExecutionContext } from '@orchestrator-ai/transport-types';

function makeService(
  overrides?: Partial<{
    showstopper: boolean;
    localAvailable: boolean;
    bestLocalModel: string;
  }>,
) {
  const localStatus = {
    getLoadedModels: jest.fn(),
  } as unknown as LocalModelStatusService;
  const db = {} as DatabaseService;
  const sovereign = {
    getPolicy: jest.fn(() => ({
      enforced: false,
      defaultMode: 'relaxed',
      auditLevel: 'none',
    })),
    isProviderAllowed: jest.fn(() => true),
  } as unknown as SovereignPolicyService;
  const flags = {
    isSovereignRoutingEnabled: jest.fn(() => false),
  } as unknown as FeatureFlagService;
  const pii = {
    checkPolicy: jest.fn(() =>
      Promise.resolve({
        metadata: {
          piiDetected: overrides?.showstopper ?? false,
          showstopperDetected: overrides?.showstopper ?? false,
          detectionResults: {
            totalMatches: overrides?.showstopper ? 1 : 0,
            flaggedMatches: [],
            dataTypesSummary: {},
          },
          policyDecision: {
            allowed: !overrides?.showstopper,
            blocked: !!overrides?.showstopper,
            violations: [],
            reasoningPath: [],
          },
          processingFlow: overrides?.showstopper
            ? 'showstopper-blocked'
            : 'allowed-external',
          userMessage: {
            summary: '',
            details: [],
            actionsTaken: [],
            isBlocked: !!overrides?.showstopper,
          },
          processingSteps: [],
          timestamps: {},
        },
        originalPrompt: 'p',
      }),
    ),
  } as unknown as PIIService;
  const dict = {} as DictionaryPseudonymizerService;
  const patternRedaction =
    {} as unknown as import('./pii/pattern-redaction.service').PatternRedactionService;
  const usage = {
    insertCompletedUsage: jest.fn(() => Promise.resolve()),
  } as unknown as RunMetadataService;

  const service = new CentralizedRoutingService(
    localStatus,
    db,
    sovereign,
    flags,
    pii,
    dict,
    patternRedaction,
    usage,
  );
  // Patch private methods for local availability and selection
  (
    service as unknown as {
      checkLocalModelAvailability: jest.Mock;
      selectBestLocalModel: jest.Mock;
    }
  ).checkLocalModelAvailability = jest.fn(() =>
    Promise.resolve(overrides?.localAvailable ?? false),
  );
  (
    service as unknown as {
      checkLocalModelAvailability: jest.Mock;
      selectBestLocalModel: jest.Mock;
    }
  ).selectBestLocalModel = jest.fn(() =>
    Promise.resolve(overrides?.bestLocalModel ?? 'llama3.2:3b'),
  );
  return { service, usage };
}

describe('CentralizedRoutingService showstopper behavior', () => {
  const _mockContext = createMockExecutionContext();

  it('blocks remote route when showstopper and no local available', async () => {
    const { service } = makeService({
      showstopper: true,
      localAvailable: false,
    });
    const decision = await service.determineRoute('pii content', {
      providerName: 'openai',
      userId: 'u',
    });
    expect(decision.routeToAgent).toBe(false);
    expect(decision.provider).toBe('policy-blocked');
  });

  it('blocks when showstopper with explicit external provider even if local available', async () => {
    // When user explicitly requests an external provider like 'openai',
    // and there's a showstopper, we BLOCK rather than silently routing to local.
    // This respects the user's provider choice - they asked for openai, not ollama.
    const { service } = makeService({
      showstopper: true,
      localAvailable: true,
      bestLocalModel: 'qwen2.5:7b',
    });
    const decision = await service.determineRoute('pii content', {
      providerName: 'openai',
      userId: 'u',
    });
    expect(decision.routeToAgent).toBe(false);
    expect(decision.provider).toBe('policy-blocked');
  });

  it('bypasses via local when showstopper and no explicit provider', async () => {
    // When no explicit provider is requested and local is available,
    // route to local to bypass the showstopper
    const { service } = makeService({
      showstopper: true,
      localAvailable: true,
      bestLocalModel: 'qwen2.5:7b',
    });
    const decision = await service.determineRoute('pii content', {
      userId: 'u',
      // No providerName - let the routing service decide
    });
    expect(decision.routeToAgent).toBe(true);
    expect(decision.provider).toBe('ollama');
    expect(decision.model).toBe('qwen2.5:7b');
  });
});
