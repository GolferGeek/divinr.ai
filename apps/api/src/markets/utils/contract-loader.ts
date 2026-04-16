/**
 * Shared helper that loads an analyst's v4 stage-keyed contract fragment for a
 * specific workflow stage and emits a fallback observability event when the
 * contract is missing or lacks the target stage section.
 *
 * Every stage-runner service (prediction, risk-reflection, risk-debate,
 * predictor-generation, learning) routes through this function so the fallback
 * accounting is consistent across the pipeline.
 *
 * Effort: stage-keyed-analyst-contracts.
 */
import type { Logger } from '@nestjs/common';
import type { DatabaseService } from '@orchestratorai/planes/database';
import type { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { parseContractMarkdown, buildStagePromptFragment } from './parse-contract-markdown';
import { WorkflowStage } from '../workflow-stages/workflow-stage';

export interface ContractLoaderDeps {
  db: DatabaseService;
  logger: Logger;
  observability: ObservabilityEventsService;
}

export interface ContractFragmentResult {
  stageFragment: string;
  adaptationsText: string;
  fallback: boolean;
}

export type FallbackReason =
  | 'no_config_version'
  | 'empty_context_markdown'
  | 'missing_stage_section'
  | 'load_error';

export async function loadContractFragment(
  deps: ContractLoaderDeps,
  analyst: { id: string; slug: string },
  configId: string | null | undefined,
  stage: WorkflowStage,
  subStage?: 'reflection' | 'debate',
): Promise<ContractFragmentResult> {
  if (!configId) {
    emitFallback(deps, analyst, stage, subStage, null, 'no_config_version');
    return { stageFragment: '', adaptationsText: '', fallback: true };
  }
  try {
    const cmResult = await deps.db.rawQuery(
      `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`,
      [configId],
    );
    const cmRows = (cmResult.data as Array<{ context_markdown: string | null }> | null) ?? [];
    const cm = cmRows[0]?.context_markdown ?? '';
    if (!cm) {
      emitFallback(deps, analyst, stage, subStage, configId, 'empty_context_markdown');
      return { stageFragment: '', adaptationsText: '', fallback: true };
    }
    const sections = parseContractMarkdown(cm);
    const adaptationsText = sections.adaptations ?? '';
    // Stage.ArticleProcessing throws in buildStagePromptFragment — analyst
    // contracts have no article-processing section. Callers should never pass
    // that enum value; catch it defensively.
    if (stage === WorkflowStage.ArticleProcessing) {
      emitFallback(deps, analyst, stage, subStage, configId, 'missing_stage_section');
      return { stageFragment: '', adaptationsText, fallback: true };
    }
    const fragment = buildStagePromptFragment(sections, stage, subStage);
    if (!fragment) {
      emitFallback(deps, analyst, stage, subStage, configId, 'missing_stage_section');
      return { stageFragment: '', adaptationsText, fallback: true };
    }
    return { stageFragment: fragment, adaptationsText, fallback: false };
  } catch (err) {
    deps.logger.warn(`Contract load failed for ${analyst.slug} cfg=${configId}: ${err instanceof Error ? err.message : String(err)}`);
    emitFallback(deps, analyst, stage, subStage, configId, 'load_error');
    return { stageFragment: '', adaptationsText: '', fallback: true };
  }
}

function emitFallback(
  deps: ContractLoaderDeps,
  analyst: { id: string; slug: string },
  stage: WorkflowStage,
  subStage: 'reflection' | 'debate' | undefined,
  configId: string | null,
  reason: FallbackReason,
): void {
  deps.logger.warn(
    `Contract fallback: ${analyst.slug} missing v4 ${stage}${subStage ? `/${subStage}` : ''} section (reason=${reason}, cfg=${configId ?? 'null'})`,
  );
  deps.observability.push({
    context: { conversationId: 'pipeline', userId: 'system', agentSlug: analyst.slug } as never,
    source_app: 'divinr-api',
    hook_event_type: 'pipeline.contract.fallback',
    status: 'running',
    message: `Contract fallback to persona_prompt for ${analyst.slug} at ${stage}${subStage ? `/${subStage}` : ''}`,
    progress: null,
    step: null,
    payload: {
      analyst_slug: analyst.slug,
      analyst_id: analyst.id,
      stage,
      sub_stage: subStage ?? null,
      config_version_id: configId,
      reason,
    },
    timestamp: Date.now(),
  }).catch(() => {});
}
