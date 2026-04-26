import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LearningPanelService } from '../../src/learning-panel/learning-panel.service';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => { passed++; console.log(`  \u2713 ${name}`); }).catch((err) => {
        failed++; console.error(`  \u2717 ${name}`); console.error(err);
      });
    }
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(err);
  }
}

interface ThreadRow {
  id: string;
  user_id: string;
  title: string;
  origin_surface_key: string | null;
  archived_at: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system_summary';
  content_markdown: string;
  surface_key: string | null;
  citations_json: unknown;
  llm_usage_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
}

interface StateRow {
  thread_id: string;
  summary_markdown: string;
  summary_version: number;
  message_count: number;
  last_compacted_message_id: string | null;
  updated_at: string;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function makeHarness() {
  const threads = new Map<string, ThreadRow>();
  const messages: MessageRow[] = [];
  const states = new Map<string, StateRow>();
  const prompts: Array<{ systemPrompt: string; userPrompt: string }> = [];

  const db = {
    rawQuery: async (sql: string, params: unknown[] = []) => {
      const normalized = normalizeSql(sql);

      if (normalized.startsWith('create table if not exists prediction.learning_panel_threads')) {
        return { data: [], error: null };
      }

      if (normalized.includes('insert into prediction.learning_panel_threads')) {
        const [id, userId, title, originSurfaceKey, now] = params as [string, string, string, string | null, string];
        threads.set(id, {
          id,
          user_id: userId,
          title,
          origin_surface_key: originSurfaceKey,
          archived_at: null,
          last_message_at: now,
          created_at: now,
          updated_at: now,
        });
        return { data: [], error: null };
      }

      if (normalized.includes('insert into prediction.learning_panel_thread_state')) {
        if (params.length === 2) {
          const [threadId, updatedAt] = params as [string, string];
          states.set(threadId, states.get(threadId) ?? {
            thread_id: threadId,
            summary_markdown: '',
            summary_version: 1,
            message_count: 0,
            last_compacted_message_id: null,
            updated_at: updatedAt,
          });
          return { data: [], error: null };
        }

        if (params.length === 3) {
          const [threadId, count, updatedAt] = params as [string, number, string];
          const existing = states.get(threadId);
          states.set(threadId, {
            thread_id: threadId,
            summary_markdown: existing?.summary_markdown ?? '',
            summary_version: existing?.summary_version ?? 1,
            message_count: count,
            last_compacted_message_id: existing?.last_compacted_message_id ?? null,
            updated_at: updatedAt,
          });
          return { data: [], error: null };
        }

        if (params.length === 5) {
          const [threadId, summaryMarkdown, summaryVersion, messageCount, lastCompactedMessageId] =
            params as [string, string, number, number, string];
          states.set(threadId, {
            thread_id: threadId,
            summary_markdown: summaryMarkdown,
            summary_version: summaryVersion,
            message_count: messageCount,
            last_compacted_message_id: lastCompactedMessageId,
            updated_at: new Date().toISOString(),
          });
          return { data: [], error: null };
        }
      }

      if (normalized.includes('insert into prediction.learning_panel_messages')) {
        const [id, threadId, role, content, surfaceKey, citationsJson, llmUsageId, promptTokens, completionTokens, createdAt] =
          params as [string, string, MessageRow['role'], string, string | null, string, string | null, number | null, number | null, string];
        messages.push({
          id,
          thread_id: threadId,
          role,
          content_markdown: content,
          surface_key: surfaceKey,
          citations_json: JSON.parse(citationsJson),
          llm_usage_id: llmUsageId,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          created_at: createdAt,
        });
        return { data: [], error: null };
      }

      if (normalized.includes('update prediction.learning_panel_threads set last_message_at')) {
        const [threadId, updatedAt] = params as [string, string];
        const thread = threads.get(threadId)!;
        thread.last_message_at = updatedAt;
        thread.updated_at = updatedAt;
        return { data: [], error: null };
      }

      if (normalized.includes('select count(*)::int as count from prediction.learning_panel_messages')) {
        const [threadId] = params as [string];
        const count = messages.filter((message) => message.thread_id === threadId && message.role !== 'system_summary').length;
        return { data: [{ count }], error: null };
      }

      if (normalized.includes('select t.id::text as id') && normalized.includes('from prediction.learning_panel_threads t')) {
        const [userId] = params as [string];
        const rows = [...threads.values()]
          .filter((thread) => thread.user_id === userId && thread.archived_at === null)
          .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
          .map((thread) => {
            const latest = [...messages]
              .filter((message) => message.thread_id === thread.id && message.role !== 'system_summary')
              .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
            return {
              id: thread.id,
              title: thread.title,
              origin_surface_key: thread.origin_surface_key,
              last_message_at: thread.last_message_at,
              preview: latest?.content_markdown ?? '',
            };
          });
        return { data: rows, error: null };
      }

      if (normalized.includes('select id::text as id, user_id, title')) {
        const [threadId, userId] = params as [string, string];
        const thread = threads.get(threadId);
        const rows = thread && thread.user_id === userId && thread.archived_at === null ? [thread] : [];
        return { data: rows, error: null };
      }

      if (normalized.includes('select thread_id::text as thread_id')) {
        const [threadId] = params as [string];
        const state = states.get(threadId);
        return { data: state ? [state] : [], error: null };
      }

      if (normalized.includes('select id::text as id, thread_id::text as thread_id')) {
        const [threadId] = params as [string];
        const rows = messages
          .filter((message) => message.thread_id === threadId && message.role !== 'system_summary')
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        return { data: rows, error: null };
      }

      if (normalized.includes('select i.symbol')) {
        return { data: [], error: null };
      }

      throw new Error(`Unhandled SQL in test harness: ${normalized}`);
    },
  };

  const schema = { ensureSchema: async () => undefined };
  const corpus = {
    getStarterPrompts: () => ['What should I learn first?'],
    getRelevantChunks: () => [{ source: 'policy', title: 'Policy', content: 'No web research.' }],
  };
  const contextService = {
    getUserContext: async () => ({
      currentSurfaceKey: 'chat',
      firstTouchMuted: false,
      touchedKeys: ['predictions'],
      onboardingCompletedSteps: ['welcome'],
      onboardingCompleted: false,
    }),
  };
  const marketsLlm = {
    buildExecutionContext: () => ({ conversationId: 'c1' }),
    generateText: async (_ctx: unknown, systemPrompt: string, userPrompt: string) => {
      prompts.push({ systemPrompt, userPrompt });
      return {
        text: `Helpful answer to: ${userPrompt}`,
        provider: 'openrouter',
        model: 'claude-3-5-haiku',
        llmUsageId: `usage-${prompts.length}`,
        promptTokens: 111,
        completionTokens: 22,
      };
    },
  };
  const credentials = {
    listCredentials: async () => [{ id: 'cred-1', provider: 'anthropic', label: 'Anthropic' }],
  };

  const service = new LearningPanelService(
    db as any,
    schema as any,
    corpus as any,
    contextService as any,
    marketsLlm as any,
    credentials as any,
  );

  return { service, threads, messages, states, prompts };
}

async function expectThrows(
  fn: () => Promise<unknown>,
  expected: new (...args: any[]) => Error,
  label: string,
) {
  try {
    await fn();
    failed++;
    console.error(`  \u2717 ${label}`);
    console.error('Expected exception was not thrown');
  } catch (err) {
    assert(err instanceof expected);
    passed++;
    console.log(`  \u2713 ${label}`);
  }
}

async function main() {
  console.log('\n=== LearningPanelService Tests ===\n');

  await test('bootstrap returns starter prompts and concrete thread array payload', async () => {
    const { service } = makeHarness();
    const result = await service.getBootstrap('user-1', 'chat');
    assert.equal(result.enabled, true);
    assert.equal(result.webResearchEnabled, false);
    assert.deepEqual(result.starterPrompts, ['What should I learn first?']);
    assert.ok(Array.isArray(result.threads));
  });

  await test('createThread persists thread, state, and assistant reply', async () => {
    const { service, threads, messages, states } = makeHarness();
    const result = await service.createThread('user-1', {
      originSurfaceKey: 'chat',
      initialMessage: 'What should I learn first?',
    });
    assert.ok(result.thread.id);
    assert.equal(threads.size, 1);
    assert.equal(messages.length, 2);
    assert.equal(states.size, 1);
    assert.equal(result.thread.messages.length, 2);
    assert.equal(result.thread.messages[0]?.role, 'user');
    assert.equal(result.thread.messages[1]?.role, 'assistant');
    assert.equal(result.thread.summary?.messageCount, 2);
  });

  await test('appendMessage persists history and listThreads returns newest preview', async () => {
    const { service } = makeHarness();
    const created = await service.createThread('user-1', {
      originSurfaceKey: 'chat',
      initialMessage: 'What should I learn first?',
    });
    const result = await service.appendMessage('user-1', created.thread.id, {
      message: 'Tell me more',
      surfaceKey: 'chat',
    });
    assert.equal(result.thread.messages.length, 4);
    assert.equal(result.thread.messages.at(-1)?.role, 'assistant');

    const threads = await service.listThreads('user-1');
    assert.equal(threads.length, 1);
    assert.equal(threads[0]!.id, created.thread.id);
    assert.ok(threads[0]!.preview.length > 0);
  });

  await test('compaction persists rolling summary after threshold', async () => {
    const prior = process.env.LEARNING_PANEL_COMPACTION_TRIGGER_MESSAGES;
    const priorRecent = process.env.LEARNING_PANEL_RECENT_CONTEXT_MESSAGES;
    process.env.LEARNING_PANEL_COMPACTION_TRIGGER_MESSAGES = '3';
    process.env.LEARNING_PANEL_RECENT_CONTEXT_MESSAGES = '2';

    try {
      const { service, prompts } = makeHarness();
      const created = await service.createThread('user-1', {
        originSurfaceKey: 'chat',
        initialMessage: 'What should I learn first?',
      });
      await service.appendMessage('user-1', created.thread.id, { message: 'Second question', surfaceKey: 'chat' });
      const result = await service.appendMessage('user-1', created.thread.id, { message: 'Third question', surfaceKey: 'chat' });

      assert.ok((result.thread.summary?.summaryMarkdown ?? '').includes('Compacted conversation summary'));
      assert.ok(result.thread.summary?.lastCompactedMessageId);
      assert.equal(result.thread.summary?.messageCount, 6);
      assert.ok(prompts.at(-1)?.systemPrompt.includes('Compacted thread summary'));
    } finally {
      if (prior === undefined) delete process.env.LEARNING_PANEL_COMPACTION_TRIGGER_MESSAGES;
      else process.env.LEARNING_PANEL_COMPACTION_TRIGGER_MESSAGES = prior;
      if (priorRecent === undefined) delete process.env.LEARNING_PANEL_RECENT_CONTEXT_MESSAGES;
      else process.env.LEARNING_PANEL_RECENT_CONTEXT_MESSAGES = priorRecent;
    }
  });

  await expectThrows(
    () => makeHarness().service.createThread('user-1', { initialMessage: '   ' }),
    BadRequestException,
    'rejects whitespace-only initial message',
  );

  await expectThrows(
    () => makeHarness().service.getThread('user-1', 'missing-thread'),
    NotFoundException,
    'rejects missing thread lookup',
  );

  await test('BYO mode validates credential existence without enabling BYO execution', async () => {
    const { service } = makeHarness();
    const result = await service.createThread('user-1', {
      originSurfaceKey: 'chat',
      initialMessage: 'Use BYO later',
      mode: 'byo',
      credentialId: 'cred-1',
    });
    assert.match(result.thread.messages[1]?.content ?? '', /Helpful answer/);
  });

  await expectThrows(
    () => makeHarness().service.createThread('user-1', {
      originSurfaceKey: 'chat',
      initialMessage: 'Missing credential',
      mode: 'byo',
      credentialId: 'missing',
    }),
    NotFoundException,
    'BYO mode requires a known credential id',
  );

  test('markets chat route is explicitly exempt from read-only blocking and delegates to learning panel', () => {
    const controllerSource = readFileSync(
      resolve(process.cwd(), 'src/markets/markets.controller.ts'),
      'utf8',
    );
    assert.match(controllerSource, /@SkipReadOnly\(\)\s*@Post\('chat\/ask'\)/);
    assert.match(controllerSource, /return this\.learningPanel\.createLegacyReply\(user\.id, body\.message, body\.instrumentId\)/);
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
