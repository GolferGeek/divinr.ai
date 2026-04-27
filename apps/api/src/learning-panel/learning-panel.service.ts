import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { randomUUID } from 'node:crypto';
import { CredentialsService } from '../credentials/credentials.service';
import { MarketsLlmService, type LlmTextResult } from '../markets/services/markets-llm.service';
import { LlmUsageQueryService } from '../markets/services/llm-usage-query.service';
import {
  LearningPanelContextService,
  type LearningPanelUserContext,
} from './learning-panel-context.service';
import {
  LearningPanelCorpusService,
  type LearningPanelCorpusChunk,
} from './learning-panel-corpus.service';
import { LearningPanelSchemaService } from './learning-panel-schema.service';

type LearningPanelRole = 'user' | 'assistant';
type LearningPanelFeedbackValue = 'helpful' | 'unhelpful';

interface LearningPanelModeInput {
  mode?: 'platform' | 'byo';
  credentialId?: string;
}

interface LearningPanelMessage {
  id: string;
  role: LearningPanelRole;
  content: string;
  createdAt: string;
  citations: LearningPanelCorpusChunk[];
  llmUsageId: string | null;
  feedback: LearningPanelFeedbackRecord | null;
}

interface LearningPanelThreadRecord {
  id: string;
  userId: string;
  title: string;
  originSurfaceKey: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LearningPanelThreadStateRecord {
  threadId: string;
  summaryMarkdown: string;
  summaryVersion: number;
  messageCount: number;
  lastCompactedMessageId: string | null;
  updatedAt: string;
}

interface LearningPanelMessageRecord {
  id: string;
  threadId: string;
  role: LearningPanelRole;
  content: string;
  surfaceKey: string | null;
  citations: LearningPanelCorpusChunk[];
  llmUsageId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
}

interface LearningPanelFeedbackRecord {
  messageId: string;
  feedback: LearningPanelFeedbackValue;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningPanelUsageStatus {
  totalCalls: number;
  totalCostCents: number;
  callLimit: number;
  costLimitCents: number;
  warningThresholdRatio: number;
  warning: boolean;
  blocked: boolean;
}

export interface LearningPanelThreadPayload {
  id: string;
  title: string;
  originSurfaceKey: string | null;
  createdAt: string;
  updatedAt: string;
  messages: LearningPanelMessage[];
  summary?: {
    summaryMarkdown: string;
    summaryVersion: number;
    messageCount: number;
    lastCompactedMessageId: string | null;
  };
}

export interface LearningPanelBootstrapPayload {
  enabled: boolean;
  modelProvider: string;
  modelName: string;
  webResearchEnabled: boolean;
  starterPrompts: string[];
  threads: Array<{
    id: string;
    title: string;
    originSurfaceKey: string | null;
    lastMessageAt: string;
    preview: string;
  }>;
  usage: LearningPanelUsageStatus;
}

@Injectable()
export class LearningPanelService {
  private readonly logger = new Logger(LearningPanelService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(LearningPanelSchemaService) private readonly schema: LearningPanelSchemaService,
    @Inject(LearningPanelCorpusService) private readonly corpus: LearningPanelCorpusService,
    @Inject(LearningPanelContextService) private readonly contextService: LearningPanelContextService,
    @Inject(MarketsLlmService) private readonly marketsLlm: MarketsLlmService,
    @Inject(LlmUsageQueryService) private readonly usageQuery: LlmUsageQueryService,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
  ) {}

  async getBootstrap(userId: string, surfaceKey?: string): Promise<LearningPanelBootstrapPayload> {
    return {
      enabled: this.isEnabled(),
      modelProvider: this.getConfig().provider,
      modelName: this.getConfig().model,
      webResearchEnabled: false,
      starterPrompts: this.corpus.getStarterPrompts(surfaceKey),
      threads: await this.listThreads(userId),
      usage: await this.getUsageStatus(userId),
    };
  }

  async listThreads(userId: string) {
    const result = await this.db.rawQuery(
      `SELECT t.id::text AS id,
              t.title,
              t.origin_surface_key,
              t.last_message_at,
              COALESCE(latest.content_markdown, '') AS preview
         FROM prediction.learning_panel_threads t
         LEFT JOIN LATERAL (
           SELECT m.content_markdown
             FROM prediction.learning_panel_messages m
            WHERE m.thread_id = t.id
              AND m.role <> 'system_summary'
            ORDER BY m.created_at DESC
            LIMIT 1
         ) latest ON true
        WHERE t.user_id = $1
          AND t.archived_at IS NULL
        ORDER BY t.last_message_at DESC`,
      [userId],
    );

    if (result.error) {
      throw new Error(`Failed to list learning panel threads: ${result.error.message}`);
    }

    const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      originSurfaceKey: (row.origin_surface_key as string | null) ?? null,
      lastMessageAt: String(row.last_message_at),
      preview: String(row.preview ?? '').slice(0, 160),
    }));
  }

  async getThread(userId: string, threadId: string): Promise<LearningPanelThreadPayload> {
    const thread = await this.getOwnedThread(userId, threadId);
    const messages = await this.fetchVisibleMessages(threadId);
    const state = await this.getThreadState(threadId);
    const feedbackByMessageId = await this.getFeedbackByMessageIds(
      userId,
      messages.map((message) => message.id),
    );
    return this.toPayload(thread, messages, state, feedbackByMessageId);
  }

  async createThread(
    userId: string,
    input: {
      originSurfaceKey?: string;
      initialMessage: string;
      instrumentId?: string;
      mode?: 'platform' | 'byo';
      credentialId?: string;
    },
  ): Promise<{ thread: LearningPanelThreadPayload; usage: LearningPanelUsageStatus }> {
    const message = this.normalizeMessage(input.initialMessage);
    await this.resolveGenerationMode(userId, input);
    await this.assertWithinUsageLimits(userId);

    const threadId = randomUUID();
    const now = new Date().toISOString();
    const threadTitle = this.deriveTitle(message);

    await this.query(
      `INSERT INTO prediction.learning_panel_threads
        (id, user_id, title, origin_surface_key, last_message_at, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $5::timestamptz, $5::timestamptz)`,
      [threadId, userId, threadTitle, input.originSurfaceKey ?? null, now],
      'create learning panel thread',
    );
    await this.query(
      `INSERT INTO prediction.learning_panel_thread_state
        (thread_id, summary_markdown, summary_version, message_count, last_compacted_message_id, updated_at)
       VALUES ($1::uuid, '', 1, 0, null, $2::timestamptz)
       ON CONFLICT (thread_id) DO NOTHING`,
      [threadId, now],
      'initialize learning panel thread state',
    );

    const userMessage = await this.persistMessage(threadId, {
      role: 'user',
      content: message,
      surfaceKey: input.originSurfaceKey ?? null,
      citations: [],
      llmUsageId: null,
      promptTokens: null,
      completionTokens: null,
      createdAt: now,
    });

    const assistantMessage = await this.generateAssistantMessage(
      userId,
      message,
      input.originSurfaceKey,
      input.instrumentId,
      threadId,
      userMessage.id,
    );

    await this.persistMessage(threadId, assistantMessage);
    await this.syncThreadDerivedState(threadId, assistantMessage.createdAt);

    return {
      thread: await this.getThread(userId, threadId),
      usage: await this.getUsageStatus(userId),
    };
  }

  async appendMessage(
    userId: string,
    threadId: string,
    input: {
      message: string;
      surfaceKey?: string;
      instrumentId?: string;
      mode?: 'platform' | 'byo';
      credentialId?: string;
    },
  ): Promise<{ thread: LearningPanelThreadPayload; usage: LearningPanelUsageStatus }> {
    const thread = await this.getOwnedThread(userId, threadId);
    const message = this.normalizeMessage(input.message);
    await this.resolveGenerationMode(userId, input);
    await this.assertWithinUsageLimits(userId);

    const now = new Date().toISOString();
    const userMessage = await this.persistMessage(threadId, {
      role: 'user',
      content: message,
      surfaceKey: input.surfaceKey ?? thread.originSurfaceKey,
      citations: [],
      llmUsageId: null,
      promptTokens: null,
      completionTokens: null,
      createdAt: now,
    });

    await this.compactThreadIfNeeded(threadId);

    const assistantMessage = await this.generateAssistantMessage(
      userId,
      message,
      input.surfaceKey ?? thread.originSurfaceKey ?? undefined,
      input.instrumentId,
      threadId,
      userMessage.id,
    );

    await this.persistMessage(threadId, assistantMessage);
    await this.syncThreadDerivedState(threadId, assistantMessage.createdAt);
    await this.compactThreadIfNeeded(threadId);

    return {
      thread: await this.getThread(userId, threadId),
      usage: await this.getUsageStatus(userId),
    };
  }

  async submitFeedback(
    userId: string,
    messageId: string,
    input: { feedback: LearningPanelFeedbackValue; note?: string | null },
  ): Promise<{ feedback: LearningPanelFeedbackRecord }> {
    if (input.feedback !== 'helpful' && input.feedback !== 'unhelpful') {
      throw new BadRequestException('feedback must be helpful or unhelpful');
    }

    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : null;
    const messageResult = await this.db.rawQuery(
      `SELECT m.id::text AS id,
              m.thread_id::text AS thread_id,
              m.role
         FROM prediction.learning_panel_messages m
         JOIN prediction.learning_panel_threads t
           ON t.id = m.thread_id
        WHERE m.id = $1::uuid
          AND t.user_id = $2
          AND t.archived_at IS NULL
        LIMIT 1`,
      [messageId, userId],
    );
    if (messageResult.error) {
      throw new Error(`Failed to read learning panel message for feedback: ${messageResult.error.message}`);
    }
    const messageRow = ((messageResult.data as Array<Record<string, unknown>> | null) ?? [])[0];
    if (!messageRow) {
      throw new NotFoundException('Learning panel message not found');
    }
    if (String(messageRow.role) !== 'assistant') {
      throw new BadRequestException('Feedback can only be submitted for assistant messages');
    }

    const result = await this.db.rawQuery(
      `INSERT INTO prediction.learning_panel_feedback
        (id, user_id, thread_id, message_id, feedback, note, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, now(), now())
       ON CONFLICT (user_id, message_id) DO UPDATE
         SET feedback = EXCLUDED.feedback,
             note = EXCLUDED.note,
             updated_at = now()
       RETURNING message_id::text AS message_id,
                 feedback,
                 note,
                 created_at,
                 updated_at`,
      [randomUUID(), userId, String(messageRow.thread_id), messageId, input.feedback, note],
    );
    if (result.error) {
      throw new Error(`Failed to persist learning panel feedback: ${result.error.message}`);
    }

    const row = ((result.data as Array<Record<string, unknown>> | null) ?? [])[0];
    if (!row) {
      throw new Error('Learning panel feedback write returned no row');
    }

    return {
      feedback: {
        messageId: String(row.message_id),
        feedback: row.feedback as LearningPanelFeedbackValue,
        note: (row.note as string | null) ?? null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      },
    };
  }

  async createLegacyReply(
    userId: string,
    message: string,
    instrumentId?: string,
  ): Promise<{ response: string; reasoning: string | null }> {
    await this.assertWithinUsageLimits(userId);
    const assistantMessage = await this.generateAssistantMessage(
      userId,
      message,
      'chat',
      instrumentId,
    );
    return {
      response: assistantMessage.content,
      reasoning: null,
    };
  }

  private isEnabled(): boolean {
    return process.env.LEARNING_PANEL_ENABLED !== 'false';
  }

  private getConfig() {
    return {
      provider:
        process.env.LEARNING_PANEL_MODEL_PROVIDER ||
        process.env.COMMERCIAL_LLM_PROVIDER ||
        'openrouter',
      model:
        process.env.LEARNING_PANEL_MODEL_NAME ||
        process.env.DEFAULT_COMMERCIAL_MODEL ||
        'claude-3-5-haiku',
      maxInputChars: Number(process.env.LEARNING_PANEL_MAX_INPUT_CHARS || 2000),
      maxRetrievedChunks: Number(process.env.LEARNING_PANEL_MAX_RETRIEVED_CHUNKS || 4),
      maxOutputTokens: Number(process.env.LEARNING_PANEL_MAX_OUTPUT_TOKENS || 1200),
      compactionTriggerMessages: Number(process.env.LEARNING_PANEL_COMPACTION_TRIGGER_MESSAGES || 12),
      recentContextMessages: Math.max(2, Number(process.env.LEARNING_PANEL_RECENT_CONTEXT_MESSAGES || 6)),
      maxSummaryChars: Number(process.env.LEARNING_PANEL_MAX_SUMMARY_CHARS || 6000),
      monthlyCallLimit: Math.max(1, Number(process.env.LEARNING_PANEL_MONTHLY_CALL_LIMIT || 150)),
      monthlyCostLimitCents: Math.max(1, Number(process.env.LEARNING_PANEL_MONTHLY_COST_LIMIT_CENTS || 200)),
      warningThresholdRatio: Math.min(0.99, Math.max(0.1, Number(process.env.LEARNING_PANEL_WARNING_THRESHOLD_RATIO || 0.8))),
    };
  }

  private async getUsageStatus(userId: string): Promise<LearningPanelUsageStatus> {
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1).toISOString();
    const summary = await this.usageQuery.getSummary({
      userId,
      stage: 'learning_panel',
      startDate,
      endDate,
    });
    const config = this.getConfig();
    const callRatio = summary.total_calls / config.monthlyCallLimit;
    const costRatio = summary.total_cost_cents / config.monthlyCostLimitCents;
    const blocked = summary.total_calls >= config.monthlyCallLimit || summary.total_cost_cents >= config.monthlyCostLimitCents;
    const warning = !blocked && Math.max(callRatio, costRatio) >= config.warningThresholdRatio;

    return {
      totalCalls: summary.total_calls,
      totalCostCents: summary.total_cost_cents,
      callLimit: config.monthlyCallLimit,
      costLimitCents: config.monthlyCostLimitCents,
      warningThresholdRatio: config.warningThresholdRatio,
      warning,
      blocked,
    };
  }

  private async assertWithinUsageLimits(userId: string): Promise<void> {
    const usage = await this.getUsageStatus(userId);
    if (!usage.blocked) {
      return;
    }

    throw new HttpException({
      code: 'learning_panel_limit_reached',
      message: 'Learning Panel monthly usage limit reached.',
      usage,
    }, HttpStatus.TOO_MANY_REQUESTS);
  }

  private normalizeMessage(message: string): string {
    if (!message || typeof message !== 'string') {
      throw new BadRequestException('message is required');
    }
    const trimmed = message.trim().slice(0, this.getConfig().maxInputChars);
    if (!trimmed) {
      throw new BadRequestException('message is required');
    }
    return trimmed;
  }

  private deriveTitle(message: string): string {
    return message.length > 48 ? `${message.slice(0, 45)}...` : message;
  }

  private async resolveGenerationMode(userId: string, input: LearningPanelModeInput) {
    if ((input.mode ?? 'platform') !== 'byo') {
      return { mode: 'platform' as const, byoCredentialId: null };
    }

    if (!input.credentialId) {
      throw new BadRequestException('credentialId is required for byo mode');
    }

    const credentials = await this.credentials.listCredentials(userId);
    const exists = credentials.some((credential) => credential.id === input.credentialId);
    if (!exists) {
      throw new NotFoundException('BYO credential not found');
    }

    this.logger.log(`Learning Panel BYO mode requested for ${userId}, but platform mode is enforced in v1`);
    return { mode: 'byo' as const, byoCredentialId: input.credentialId };
  }

  private async getOwnedThread(userId: string, threadId: string): Promise<LearningPanelThreadRecord> {
    const result = await this.db.rawQuery(
      `SELECT id::text AS id,
              user_id,
              title,
              origin_surface_key,
              created_at,
              updated_at
         FROM prediction.learning_panel_threads
        WHERE id = $1::uuid
          AND user_id = $2
          AND archived_at IS NULL`,
      [threadId, userId],
    );
    if (result.error) {
      throw new Error(`Failed to read learning panel thread: ${result.error.message}`);
    }

    const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];
    if (rows.length === 0) {
      throw new NotFoundException('Learning panel thread not found');
    }

    const row = rows[0]!;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      title: String(row.title),
      originSurfaceKey: (row.origin_surface_key as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private async getThreadState(threadId: string): Promise<LearningPanelThreadStateRecord> {
    const result = await this.db.rawQuery(
      `SELECT thread_id::text AS thread_id,
              summary_markdown,
              summary_version,
              message_count,
              last_compacted_message_id::text AS last_compacted_message_id,
              updated_at
         FROM prediction.learning_panel_thread_state
        WHERE thread_id = $1::uuid`,
      [threadId],
    );
    if (result.error) {
      throw new Error(`Failed to read learning panel thread state: ${result.error.message}`);
    }

    const row = ((result.data as Array<Record<string, unknown>> | null) ?? [])[0];
    if (!row) {
      return {
        threadId,
        summaryMarkdown: '',
        summaryVersion: 1,
        messageCount: 0,
        lastCompactedMessageId: null,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      threadId: String(row.thread_id),
      summaryMarkdown: String(row.summary_markdown ?? ''),
      summaryVersion: Number(row.summary_version ?? 1),
      messageCount: Number(row.message_count ?? 0),
      lastCompactedMessageId: (row.last_compacted_message_id as string | null) ?? null,
      updatedAt: String(row.updated_at),
    };
  }

  private async fetchVisibleMessages(threadId: string): Promise<LearningPanelMessageRecord[]> {
    const result = await this.db.rawQuery(
      `SELECT id::text AS id,
              thread_id::text AS thread_id,
              role,
              content_markdown,
              surface_key,
              citations_json,
              llm_usage_id::text AS llm_usage_id,
              prompt_tokens,
              completion_tokens,
              created_at
         FROM prediction.learning_panel_messages
        WHERE thread_id = $1::uuid
          AND role <> 'system_summary'
        ORDER BY created_at ASC`,
      [threadId],
    );
    if (result.error) {
      throw new Error(`Failed to read learning panel messages: ${result.error.message}`);
    }

    const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map((row) => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      role: row.role as LearningPanelRole,
      content: String(row.content_markdown ?? ''),
      surfaceKey: (row.surface_key as string | null) ?? null,
      citations: this.parseCitations(row.citations_json),
      llmUsageId: (row.llm_usage_id as string | null) ?? null,
      promptTokens: this.toNumberOrNull(row.prompt_tokens),
      completionTokens: this.toNumberOrNull(row.completion_tokens),
      createdAt: String(row.created_at),
    }));
  }

  private async getFeedbackByMessageIds(
    userId: string,
    messageIds: string[],
  ): Promise<Map<string, LearningPanelFeedbackRecord>> {
    if (messageIds.length === 0) {
      return new Map();
    }

    const result = await this.db.rawQuery(
      `SELECT message_id::text AS message_id,
              feedback,
              note,
              created_at,
              updated_at
         FROM prediction.learning_panel_feedback
        WHERE user_id = $1
          AND message_id = ANY($2::uuid[])`,
      [userId, messageIds],
    );
    if (result.error) {
      throw new Error(`Failed to read learning panel feedback: ${result.error.message}`);
    }

    const map = new Map<string, LearningPanelFeedbackRecord>();
    for (const row of ((result.data as Array<Record<string, unknown>> | null) ?? [])) {
      map.set(String(row.message_id), {
        messageId: String(row.message_id),
        feedback: row.feedback as LearningPanelFeedbackValue,
        note: (row.note as string | null) ?? null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      });
    }
    return map;
  }

  private async persistMessage(
    threadId: string,
    message: Omit<LearningPanelMessageRecord, 'id' | 'threadId'> & { id?: string },
  ): Promise<LearningPanelMessageRecord> {
    const persisted: LearningPanelMessageRecord = {
      id: message.id ?? randomUUID(),
      threadId,
      role: message.role,
      content: message.content,
      surfaceKey: message.surfaceKey ?? null,
      citations: message.citations,
      llmUsageId: message.llmUsageId ?? null,
      promptTokens: message.promptTokens ?? null,
      completionTokens: message.completionTokens ?? null,
      createdAt: message.createdAt,
    };

    await this.query(
      `INSERT INTO prediction.learning_panel_messages
        (id, thread_id, role, content_markdown, surface_key, citations_json, llm_usage_id, prompt_tokens, completion_tokens, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::uuid, $8, $9, $10::timestamptz)`,
      [
        persisted.id,
        threadId,
        persisted.role,
        persisted.content,
        persisted.surfaceKey,
        JSON.stringify(persisted.citations),
        persisted.llmUsageId,
        persisted.promptTokens,
        persisted.completionTokens,
        persisted.createdAt,
      ],
      'insert learning panel message',
    );

    return persisted;
  }

  private async syncThreadDerivedState(threadId: string, updatedAt: string): Promise<void> {
    const countResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int AS count
         FROM prediction.learning_panel_messages
        WHERE thread_id = $1::uuid
          AND role <> 'system_summary'`,
      [threadId],
    );
    if (countResult.error) {
      throw new Error(`Failed to count learning panel messages: ${countResult.error.message}`);
    }
    const count = Number(((countResult.data as Array<Record<string, unknown>> | null) ?? [])[0]?.count ?? 0);

    await this.query(
      `UPDATE prediction.learning_panel_threads
          SET last_message_at = $2::timestamptz,
              updated_at = $2::timestamptz
        WHERE id = $1::uuid`,
      [threadId, updatedAt],
      'update learning panel thread timestamps',
    );
    await this.query(
      `INSERT INTO prediction.learning_panel_thread_state
        (thread_id, summary_markdown, summary_version, message_count, last_compacted_message_id, updated_at)
       VALUES ($1::uuid, '', 1, $2, null, $3::timestamptz)
       ON CONFLICT (thread_id) DO UPDATE
         SET message_count = EXCLUDED.message_count,
             updated_at = EXCLUDED.updated_at`,
      [threadId, count, updatedAt],
      'sync learning panel thread state',
    );
  }

  private async compactThreadIfNeeded(threadId: string): Promise<void> {
    const config = this.getConfig();
    const messages = await this.fetchVisibleMessages(threadId);
    if (messages.length <= config.compactionTriggerMessages) {
      return;
    }

    const state = await this.getThreadState(threadId);
    const keepCount = Math.min(config.recentContextMessages, messages.length);
    const cutoffIndex = messages.length - keepCount;
    if (cutoffIndex <= 0) {
      return;
    }

    const compactedBoundary = messages[cutoffIndex - 1]!;
    const candidates = messages.slice(0, cutoffIndex);
    const lastCompactIndex = state.lastCompactedMessageId
      ? candidates.findIndex((message) => message.id === state.lastCompactedMessageId)
      : -1;
    const newMessages = lastCompactIndex >= 0 ? candidates.slice(lastCompactIndex + 1) : candidates;
    if (newMessages.length === 0) {
      return;
    }

    const appendedSummary = this.renderCompactSummary(newMessages);
    const mergedSummary = [state.summaryMarkdown, appendedSummary]
      .filter(Boolean)
      .join('\n\n')
      .slice(-config.maxSummaryChars);

    await this.query(
      `INSERT INTO prediction.learning_panel_thread_state
        (thread_id, summary_markdown, summary_version, message_count, last_compacted_message_id, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid, now())
       ON CONFLICT (thread_id) DO UPDATE
         SET summary_markdown = EXCLUDED.summary_markdown,
             summary_version = EXCLUDED.summary_version,
             message_count = EXCLUDED.message_count,
             last_compacted_message_id = EXCLUDED.last_compacted_message_id,
             updated_at = now()`,
      [
        threadId,
        mergedSummary,
        state.summaryVersion + 1,
        messages.length,
        compactedBoundary.id,
      ],
      'compact learning panel thread',
    );
  }

  private renderCompactSummary(messages: LearningPanelMessageRecord[]): string {
    const lines = messages.map((message) => {
      const speaker = message.role === 'assistant' ? 'Assistant' : 'User';
      return `- ${speaker}: ${message.content.replace(/\s+/g, ' ').slice(0, 280)}`;
    });
    return `Compacted conversation summary:\n${lines.join('\n')}`;
  }

  private async generateAssistantMessage(
    userId: string,
    message: string,
    surfaceKey?: string,
    instrumentId?: string,
    threadId?: string,
    excludedMessageId?: string,
  ): Promise<Omit<LearningPanelMessageRecord, 'threadId'>> {
    const config = this.getConfig();
    const context = await this.contextService.getUserContext(userId, surfaceKey);
    const citations = (await this.corpus.getRelevantChunks(surfaceKey)).slice(
      0,
      config.maxRetrievedChunks,
    );
    const marketContext = await this.getMarketContext(instrumentId);
    const conversationContext = threadId
      ? await this.buildConversationContext(threadId, excludedMessageId)
      : '';
    const systemPrompt = this.buildSystemPrompt(
      context,
      citations,
      marketContext,
      surfaceKey,
      conversationContext,
    );
    const executionContext = this.marketsLlm.buildExecutionContext(userId, 'learning-panel');
    const result = await this.marketsLlm.generateText(executionContext, systemPrompt, message, undefined, {
      stage: 'learning_panel',
      billedUserId: userId,
      instrumentId,
    });

    return this.toAssistantMessage(result, citations);
  }

  private async buildConversationContext(
    threadId: string,
    excludedMessageId?: string,
  ): Promise<string> {
    const [state, messages] = await Promise.all([
      this.getThreadState(threadId),
      this.fetchVisibleMessages(threadId),
    ]);

    const afterCompaction = state.lastCompactedMessageId
      ? messages.slice(messages.findIndex((message) => message.id === state.lastCompactedMessageId) + 1)
      : messages;
    const filtered = excludedMessageId
      ? afterCompaction.filter((message) => message.id !== excludedMessageId)
      : afterCompaction;
    const recent = filtered.slice(-this.getConfig().recentContextMessages);
    const transcript = recent.map((entry) => {
      const speaker = entry.role === 'assistant' ? 'Assistant' : 'User';
      return `${speaker}: ${entry.content}`;
    }).join('\n');

    return [
      state.summaryMarkdown ? `Compacted thread summary:\n${state.summaryMarkdown}` : '',
      transcript ? `Recent thread transcript:\n${transcript}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private toAssistantMessage(
    result: LlmTextResult,
    citations: LearningPanelCorpusChunk[],
  ): Omit<LearningPanelMessageRecord, 'threadId'> {
    return {
      id: randomUUID(),
      role: 'assistant',
      content: result.text,
      surfaceKey: null,
      citations,
      llmUsageId: result.llmUsageId ?? null,
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  private buildSystemPrompt(
    context: LearningPanelUserContext,
    citations: LearningPanelCorpusChunk[],
    marketContext: string,
    surfaceKey: string | undefined,
    conversationContext: string,
  ): string {
    const seen = context.touchedKeys.slice(0, 20).join(', ') || 'none yet';
    const steps = context.onboardingCompletedSteps.join(', ') || 'none yet';
    const citationText = citations
      .map((chunk) => `- ${chunk.title}: ${chunk.content}`)
      .join('\n');

    return [
      'You are the Divinr Learning Panel, a Divinr-grounded educational assistant.',
      'Explain analyses, signals, risk, portfolios, clubs, tournaments, and visible app capabilities.',
      'Use the words "analysis" and "signal" in user-facing language. Avoid "prediction", "advice", and "recommendation".',
      'Do not provide investment advice, trade recommendations, or open web research.',
      `Current surface: ${surfaceKey ?? 'general'}`,
      `Touched surfaces: ${seen}`,
      `Completed onboarding steps: ${steps}`,
      `First-touch muted: ${context.firstTouchMuted ? 'yes' : 'no'}`,
      marketContext ? `Visible market context:\n${marketContext}` : '',
      conversationContext,
      citationText ? `Approved Divinr knowledge:\n${citationText}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private async getMarketContext(instrumentId?: string): Promise<string> {
    const parts: string[] = [];

    if (instrumentId) {
      const instResult = await this.db.rawQuery(
        `SELECT i.symbol,
                i.name,
                mp.direction,
                mp.confidence,
                mp.rationale,
                ma.display_name AS analyst_name
           FROM prediction.market_predictions mp
           JOIN prediction.instruments i ON i.id = mp.instrument_id
           JOIN prediction.market_analysts ma ON ma.id = mp.analyst_id
          WHERE mp.instrument_id = $1
          ORDER BY mp.created_at DESC
          LIMIT 5`,
        [instrumentId],
      );
      if (!instResult.error) {
        const predictions = (instResult.data as Array<Record<string, unknown>> | null) ?? [];
        if (predictions.length > 0) {
          parts.push(`Recent analyses for ${predictions[0].symbol} (${predictions[0].name}):`);
          for (const prediction of predictions) {
            parts.push(
              `- ${prediction.analyst_name}: ${prediction.direction} at ${prediction.confidence}% confidence. "${String(prediction.rationale ?? '').slice(0, 180)}"`,
            );
          }
        }
      }
    }

    return parts.join('\n');
  }

  private toPayload(
    thread: LearningPanelThreadRecord,
    messages: LearningPanelMessageRecord[],
    state: LearningPanelThreadStateRecord,
    feedbackByMessageId: Map<string, LearningPanelFeedbackRecord>,
  ): LearningPanelThreadPayload {
    return {
      id: thread.id,
      title: thread.title,
      originSurfaceKey: thread.originSurfaceKey,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        citations: message.citations,
        llmUsageId: message.llmUsageId,
        feedback: feedbackByMessageId.get(message.id) ?? null,
      })),
      summary: {
        summaryMarkdown: state.summaryMarkdown,
        summaryVersion: state.summaryVersion,
        messageCount: state.messageCount,
        lastCompactedMessageId: state.lastCompactedMessageId,
      },
    };
  }

  private parseCitations(raw: unknown): LearningPanelCorpusChunk[] {
    if (Array.isArray(raw)) {
      return raw as LearningPanelCorpusChunk[];
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as LearningPanelCorpusChunk[] : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private async query(sql: string, params: unknown[], label: string): Promise<void> {
    const result = await this.db.rawQuery(sql, params);
    if (result.error) {
      throw new Error(`Failed to ${label}: ${result.error.message}`);
    }
  }
}
