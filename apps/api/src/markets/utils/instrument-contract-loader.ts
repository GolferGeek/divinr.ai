/**
 * Shared helper that loads an instrument's v1 stage-keyed contract fragment for
 * a specific workflow stage (including ArticleProcessing, which is
 * instrument-only), and emits a fallback observability event when the contract
 * is missing or lacks the target stage section.
 *
 * Parallel to apps/api/src/markets/utils/contract-loader.ts (the analyst
 * loader). They share types (ContractLoaderDeps, ContractFragmentResult,
 * FallbackReason) and the same observability shape, but emit events under
 * `pipeline.instrument_contract.fallback` and include `instrument_symbol` in
 * the payload for dashboard filtering.
 *
 * Effort: instrument-contracts.
 */
import { parseContractMarkdown, buildInstrumentStagePromptFragment } from './parse-contract-markdown';
import { WorkflowStage } from '../workflow-stages/workflow-stage';
import type { ContractLoaderDeps, ContractFragmentResult, FallbackReason } from './contract-loader';

export async function loadInstrumentContractFragment(
  deps: ContractLoaderDeps,
  instrument: { id: string; symbol: string },
  stage: WorkflowStage,
  subStage?: 'reflection' | 'debate',
): Promise<ContractFragmentResult> {
  try {
    const res = await deps.db.rawQuery(
      `SELECT icv.id AS config_id, icv.context_markdown
       FROM prediction.instruments i
       JOIN prediction.instrument_config_versions icv ON icv.id = i.current_config_version_id
       WHERE i.id = $1`,
      [instrument.id],
    );
    const rows = (res.data as Array<{ config_id: string | null; context_markdown: string | null }> | null) ?? [];
    if (rows.length === 0) {
      emitFallback(deps, instrument, stage, subStage, null, 'no_config_version');
      return { stageFragment: '', adaptationsText: '', fallback: true };
    }
    const configId = rows[0]?.config_id ?? null;
    const cm = rows[0]?.context_markdown ?? '';
    if (!cm) {
      emitFallback(deps, instrument, stage, subStage, configId, 'empty_context_markdown');
      return { stageFragment: '', adaptationsText: '', fallback: true };
    }
    const sections = parseContractMarkdown(cm);
    const adaptationsText = sections.adaptations ?? '';
    const fragment = buildInstrumentStagePromptFragment(sections, stage, subStage);
    if (!fragment) {
      emitFallback(deps, instrument, stage, subStage, configId, 'missing_stage_section');
      return { stageFragment: '', adaptationsText, fallback: true };
    }
    return { stageFragment: fragment, adaptationsText, fallback: false };
  } catch (err) {
    deps.logger.warn(
      `Instrument contract load failed for ${instrument.symbol}: ${err instanceof Error ? err.message : String(err)}`,
    );
    emitFallback(deps, instrument, stage, subStage, null, 'load_error');
    return { stageFragment: '', adaptationsText: '', fallback: true };
  }
}

function emitFallback(
  deps: ContractLoaderDeps,
  instrument: { id: string; symbol: string },
  stage: WorkflowStage,
  subStage: 'reflection' | 'debate' | undefined,
  configId: string | null,
  reason: FallbackReason,
): void {
  deps.logger.warn(
    `Instrument contract fallback: ${instrument.symbol} missing v1 ${stage}${subStage ? `/${subStage}` : ''} section (reason=${reason}, cfg=${configId ?? 'null'})`,
  );
  deps.observability
    .push({
      context: { conversationId: 'pipeline', userId: 'system', agentSlug: `instrument:${instrument.symbol}` } as never,
      source_app: 'divinr-api',
      hook_event_type: 'pipeline.instrument_contract.fallback',
      status: 'running',
      message: `Instrument contract fallback for ${instrument.symbol} at ${stage}${subStage ? `/${subStage}` : ''}`,
      progress: null,
      step: null,
      payload: {
        instrument_id: instrument.id,
        instrument_symbol: instrument.symbol,
        stage,
        sub_stage: subStage ?? null,
        config_version_id: configId,
        reason,
      },
      timestamp: Date.now(),
    })
    .catch(() => {});
}
