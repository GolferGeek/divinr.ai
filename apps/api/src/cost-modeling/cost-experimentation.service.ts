import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsLlmService, type LlmUsageContext } from '../markets/services/markets-llm.service';

export type ExperimentStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface ExperimentModel {
  provider: string;
  model: string;
}

export interface ExperimentInput {
  systemPrompt: string;
  userPrompt: string;
  // Extras allowed for forward-compat — ignored by v1 runner.
  [key: string]: unknown;
}

export interface CreateExperimentArgs {
  name: string;
  stage: string;
  inputPayload: ExperimentInput;
  models: ExperimentModel[];
  userId: string;
}

export interface ExperimentRow {
  id: string;
  created_at: string;
  created_by_user_id: string;
  name: string;
  stage: string;
  input_payload: ExperimentInput;
  models: ExperimentModel[];
  status: ExperimentStatus;
  notes: string | null;
  runs_count?: number;
}

export interface ExperimentRunRow {
  id: string;
  experiment_id: string;
  provider: string;
  model: string;
  started_at: string;
  completed_at: string | null;
  cost_cents: number | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  output_text: string | null;
  output_hash: string | null;
  error: string | null;
  usage_log_id: string | null;
}

@Injectable()
export class CostExperimentationService {
  private readonly logger = new Logger(CostExperimentationService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsLlmService) private readonly llm: MarketsLlmService,
  ) {}

  async createExperiment(
    args: CreateExperimentArgs,
  ): Promise<{ experimentId: string; status: ExperimentStatus }> {
    if (!Array.isArray(args.models) || args.models.length < 2) {
      throw new Error('At least 2 models required for an experiment');
    }
    const payload = args.inputPayload;
    if (!payload || typeof payload.systemPrompt !== 'string' || typeof payload.userPrompt !== 'string') {
      throw new Error('inputPayload must include systemPrompt and userPrompt strings');
    }

    const insertResult = await this.db.rawQuery(
      `INSERT INTO prediction.cost_experiments
         (created_by_user_id, name, stage, input_payload, models, status)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'pending')
       RETURNING id`,
      [args.userId, args.name, args.stage, JSON.stringify(payload), JSON.stringify(args.models)],
    );
    const idRows = (insertResult.data as Array<{ id: string }> | null) ?? [];
    const experimentId = idRows[0]?.id;
    if (!experimentId) throw new Error('Failed to create experiment row');

    for (const model of args.models) {
      await this.db.rawQuery(
        `INSERT INTO prediction.cost_experiment_runs (experiment_id, provider, model)
         VALUES ($1, $2, $3)`,
        [experimentId, model.provider, model.model],
      );
    }

    // Fire-and-forget background work — Ollama serial constraint enforced inside the loop.
    setImmediate(() => {
      this.runExperimentInBackground(experimentId).catch((err) => {
        this.logger.error(
          `Experiment ${experimentId} background run threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });

    return { experimentId, status: 'pending' };
  }

  async runExperimentInBackground(experimentId: string): Promise<void> {
    await this.db.rawQuery(
      `UPDATE prediction.cost_experiments SET status = 'running' WHERE id = $1`,
      [experimentId],
    );

    const expResult = await this.db.rawQuery(
      `SELECT id, input_payload FROM prediction.cost_experiments WHERE id = $1`,
      [experimentId],
    );
    const expRows = (expResult.data as Array<{ id: string; input_payload: ExperimentInput | string }> | null) ?? [];
    const expRow = expRows[0];
    if (!expRow) {
      this.logger.error(`Experiment ${experimentId} missing during background run`);
      return;
    }
    const payload = typeof expRow.input_payload === 'string'
      ? (JSON.parse(expRow.input_payload) as ExperimentInput)
      : expRow.input_payload;

    const runsResult = await this.db.rawQuery(
      `SELECT id, provider, model FROM prediction.cost_experiment_runs
        WHERE experiment_id = $1 ORDER BY started_at ASC`,
      [experimentId],
    );
    const runs = (runsResult.data as Array<{ id: string; provider: string; model: string }> | null) ?? [];

    let allFailed = true;
    for (const run of runs) {
      try {
        await this.executeRun(run, payload);
        allFailed = false;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Experiment run ${run.id} failed: ${message}`);
        await this.db.rawQuery(
          `UPDATE prediction.cost_experiment_runs
             SET completed_at = now(), error = $2
           WHERE id = $1`,
          [run.id, message],
        );
      }
    }

    const finalStatus: ExperimentStatus = allFailed ? 'failed' : 'complete';
    await this.db.rawQuery(
      `UPDATE prediction.cost_experiments SET status = $2 WHERE id = $1`,
      [experimentId, finalStatus],
    );
    this.logger.log(`Experiment ${experimentId} finished: ${finalStatus}`);
  }

  private async executeRun(
    run: { id: string; provider: string; model: string },
    payload: ExperimentInput,
  ): Promise<void> {
    const usageContext: LlmUsageContext = {
      stage: 'experiment',
      subStage: run.id,
    };
    const execContext = this.llm.buildExecutionContext('admin', 'cost-experiment');
    const startedAt = Date.now();
    const result = await this.llm.generateText(
      execContext,
      payload.systemPrompt,
      payload.userPrompt,
      { llmProvider: run.provider, llmModel: run.model },
      usageContext,
    );
    const latencyMs = Date.now() - startedAt;
    const outputText = result.text ?? '';
    const outputHash = outputText ? createHash('sha256').update(outputText).digest('hex') : null;

    // Locate the freshly-inserted log row by stage='experiment' and sub_stage=run.id.
    const logResult = await this.db.rawQuery(
      `SELECT id, cost_cents, tokens_in, tokens_out, latency_ms
         FROM prediction.llm_usage_log
        WHERE stage = 'experiment' AND sub_stage = $1
        ORDER BY "timestamp" DESC
        LIMIT 1`,
      [run.id],
    );
    const logRows = (logResult.data as Array<{
      id: string;
      cost_cents: number | string | null;
      tokens_in: number | string;
      tokens_out: number | string;
      latency_ms: number | string;
    }> | null) ?? [];
    const logRow = logRows[0];

    await this.db.rawQuery(
      `UPDATE prediction.cost_experiment_runs
         SET completed_at = now(),
             cost_cents = $2,
             tokens_in = $3,
             tokens_out = $4,
             latency_ms = $5,
             output_text = $6,
             output_hash = $7,
             usage_log_id = $8
       WHERE id = $1`,
      [
        run.id,
        logRow?.cost_cents != null ? Number(logRow.cost_cents) : null,
        logRow ? Number(logRow.tokens_in) : 0,
        logRow ? Number(logRow.tokens_out) : 0,
        logRow ? Number(logRow.latency_ms) : latencyMs,
        outputText,
        outputHash,
        logRow?.id ?? null,
      ],
    );
  }

  async getExperiments(): Promise<ExperimentRow[]> {
    const result = await this.db.rawQuery(
      `SELECT e.id, e.created_at, e.created_by_user_id, e.name, e.stage, e.input_payload, e.models,
              e.status, e.notes,
              (SELECT count(*)::integer FROM prediction.cost_experiment_runs r WHERE r.experiment_id = e.id) as runs_count
         FROM prediction.cost_experiments e
        ORDER BY e.created_at DESC`,
    );
    return ((result.data as ExperimentRow[] | null) ?? []).map((row) => ({
      ...row,
      input_payload: typeof row.input_payload === 'string'
        ? JSON.parse(row.input_payload as unknown as string)
        : row.input_payload,
      models: typeof row.models === 'string'
        ? JSON.parse(row.models as unknown as string)
        : row.models,
      runs_count: row.runs_count != null ? Number(row.runs_count) : 0,
    }));
  }

  async getExperimentDetail(id: string): Promise<{ experiment: ExperimentRow; runs: ExperimentRunRow[] } | null> {
    const expResult = await this.db.rawQuery(
      `SELECT id, created_at, created_by_user_id, name, stage, input_payload, models, status, notes
         FROM prediction.cost_experiments WHERE id = $1`,
      [id],
    );
    const expRows = (expResult.data as ExperimentRow[] | null) ?? [];
    if (expRows.length === 0) return null;
    const experiment = expRows[0];
    experiment.input_payload = typeof experiment.input_payload === 'string'
      ? JSON.parse(experiment.input_payload as unknown as string)
      : experiment.input_payload;
    experiment.models = typeof experiment.models === 'string'
      ? JSON.parse(experiment.models as unknown as string)
      : experiment.models;

    const runsResult = await this.db.rawQuery(
      `SELECT id, experiment_id, provider, model, started_at, completed_at,
              cost_cents, tokens_in, tokens_out, latency_ms,
              output_text, output_hash, error, usage_log_id
         FROM prediction.cost_experiment_runs
        WHERE experiment_id = $1
        ORDER BY started_at ASC`,
      [id],
    );
    const runs = ((runsResult.data as ExperimentRunRow[] | null) ?? []).map((r) => ({
      ...r,
      cost_cents: r.cost_cents != null ? Number(r.cost_cents) : null,
      tokens_in: Number(r.tokens_in),
      tokens_out: Number(r.tokens_out),
      latency_ms: Number(r.latency_ms),
    }));

    return { experiment, runs };
  }
}
