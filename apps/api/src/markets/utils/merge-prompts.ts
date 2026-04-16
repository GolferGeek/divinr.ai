/**
 * Merges an instrument stage fragment and an analyst stage fragment into a
 * single labeled system prompt. Used by every analyst-facing stage service
 * (predictor generation, risk reflection, risk debate, prediction generation)
 * to produce a prompt that carries both contracts' framing in a way the LLM
 * can distinguish.
 *
 * Output shape:
 *   [Instrument: <symbol>]
 *   <instrumentFragment>
 *
 *   [Analyst: <slug>]
 *   <analystFragment>
 *
 * When either fragment is empty, its labeled block is omitted. Callers on the
 * analyst fallback path pass the legacy persona prompt as `analystFragment`;
 * that is a non-empty string, so the [Analyst:] block still renders.
 *
 * Effort: instrument-contracts (Phase 4).
 */
export function buildMergedSystemPrompt(params: {
  instrumentSymbol: string;
  instrumentFragment: string;
  analystSlug: string;
  analystFragment: string;
}): string {
  const blocks: string[] = [];
  const instrumentBody = params.instrumentFragment.trim();
  const analystBody = params.analystFragment.trim();

  if (instrumentBody) {
    blocks.push(`[Instrument: ${params.instrumentSymbol}]\n${instrumentBody}`);
  }
  if (analystBody) {
    blocks.push(`[Analyst: ${params.analystSlug}]\n${analystBody}`);
  }
  return blocks.join('\n\n');
}

/**
 * Emits a token-count estimate for observability. Uses the rough
 * chars/4 approximation (good enough for soft-cap alerting).
 * Emits a Logger.warn when the estimate exceeds the soft cap.
 */
export interface TokenEstimateLogger {
  warn: (message: string) => void;
}

// Mirror the ObservabilityEventRecord shape from @orchestratorai/planes/observability
// without importing the typed context — callers pass real services whose push
// expects the full shape, test stubs pass a plain Record.
export interface TokenEstimateObservability {
  push: (event: {
    context: never;
    source_app: string;
    hook_event_type: string;
    status: string;
    message: string | null;
    progress: number | null;
    step: string | null;
    payload: Record<string, unknown>;
    timestamp: number;
  }) => Promise<unknown>;
}

export function emitPromptTokenEstimate(
  observability: TokenEstimateObservability,
  logger: TokenEstimateLogger,
  params: {
    prompt: string;
    stage: string;
    subStage?: string | null;
    analystSlug: string | null;
    instrumentSymbol: string | null;
  },
  softCapTokens = 6000,
): void {
  const chars = params.prompt.length;
  const estimatedTokens = Math.ceil(chars / 4);
  if (estimatedTokens > softCapTokens) {
    logger.warn(
      `Prompt token estimate ${estimatedTokens} exceeds soft cap ${softCapTokens} at ${params.stage}${params.subStage ? `/${params.subStage}` : ''} (analyst=${params.analystSlug ?? 'n/a'}, instrument=${params.instrumentSymbol ?? 'n/a'})`,
    );
  }
  observability
    .push({
      context: { conversationId: 'pipeline', userId: 'system', agentSlug: params.analystSlug ?? 'system' } as never,
      source_app: 'divinr-api',
      hook_event_type: 'pipeline.prompt_token_estimate',
      status: 'running',
      message: `Prompt token estimate ${estimatedTokens} at ${params.stage}`,
      progress: null,
      step: null,
      payload: {
        prompt_length_chars: chars,
        estimated_tokens: estimatedTokens,
        stage: params.stage,
        sub_stage: params.subStage ?? null,
        analyst_slug: params.analystSlug,
        instrument_symbol: params.instrumentSymbol,
      },
      timestamp: Date.now(),
    })
    .catch(() => {});
}
