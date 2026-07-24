import assert from 'node:assert/strict';
import { A2AUpdateSkillsService } from '../../src/a2a/a2a-update-skills.service';

async function main(): Promise<void> {
  let queryParameters: unknown[] = [];
  const db = {
    rawQuery: async (_sql: string, params: unknown[]) => {
      queryParameters = params;
      return {
        data: [{
          id: 'notification-001',
          event_type: 'tournament_started',
          title: 'Tournament opened',
          summary: 'A demo tournament is now active.',
          created_at: '2026-07-24T12:00:00.000Z',
          link_to: '/private/path/never-returned',
        }],
        error: null,
      };
    },
  };
  const service = new A2AUpdateSkillsService(db as never);
  const result = await service.execute({
    effectiveUserId: '20000000-0000-0000-0000-000000000001',
    skillId: 'personal_updates',
    input: {
      schemaVersion: 2,
      requestId: 'request-001',
      idempotencyKey: 'idempotency-001',
      categories: ['tournament'],
      pageSize: 10,
    },
  });
  assert.equal(queryParameters[0], '20000000-0000-0000-0000-000000000001');
  assert.equal(queryParameters[4], true);
  assert.ok((queryParameters[5] as string[]).includes('tournament_started'));
  assert.deepEqual(result, {
    schemaVersion: 2,
    updates: [{
      updateId: 'notification-001',
      category: 'tournament',
      title: 'Tournament opened',
      summary: 'A demo tournament is now active.',
      occurredAt: '2026-07-24T12:00:00.000Z',
    }],
  });
  assert.equal(JSON.stringify(result).includes('private/path'), false);

  console.log('A2A user-scoped update adapter tests passed');
}

void main();
