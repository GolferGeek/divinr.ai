import assert from 'node:assert/strict';
import { MasteryService } from '../../src/mastery/mastery.service';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      }).catch((err) => {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error(err);
      });
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

function makeHarness(options?: {
  firstTournamentJoined?: boolean;
  firstClubJoined?: boolean;
  firstAuthoredItem?: boolean;
  masteryLevel?: 'core_trading' | 'competitive_participation' | 'community_creation' | 'builder' | 'operator';
  globalRole?: 'super-admin' | 'owner' | 'admin' | 'member' | 'beta_reader';
}) {
  const profileRow = {
    mastery_level: options?.masteryLevel ?? 'core_trading',
    preferred_level: null,
    updated_at: '2026-04-27T00:00:00.000Z',
  };

  const db = {
    rawQuery: async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.includes('insert into prediction.user_learning_profiles')) {
        if (normalized.includes('(user_id, mastery_level)') && params.length >= 2 && profileRow.mastery_level === 'core_trading') {
          profileRow.mastery_level = (params[1] as typeof profileRow.mastery_level) ?? profileRow.mastery_level;
        }
        if (sql.toLowerCase().includes('do update')) {
          profileRow.preferred_level = (params[1] as typeof profileRow.preferred_level) ?? null;
        }
        return { data: [], error: null };
      }

      if (normalized.includes('select mastery_level, preferred_level, updated_at')) {
        return { data: [profileRow], error: null };
      }

      if (normalized.includes('from prediction.user_positions')) {
        return { data: [{ present: true }], error: null };
      }

      if (normalized.includes('from prediction.tournament_entries')) {
        return { data: [{ present: options?.firstTournamentJoined ?? true }], error: null };
      }

      if (normalized.includes('from prediction.club_members')) {
        return { data: [{ present: options?.firstClubJoined ?? false }], error: null };
      }

      if (normalized.includes('from billing.authored_items')) {
        return { data: [{ present: options?.firstAuthoredItem ?? false }], error: null };
      }

      if (normalized.includes('from authz.rbac_user_roles r join authz.rbac_roles rr on rr.id = r.role_id')) {
        return {
          data: options?.globalRole ? [{ name: options.globalRole }] : [],
          error: null,
        };
      }

      throw new Error(`Unhandled SQL: ${normalized}`);
    },
  };

  const firstTouch = {
    getState: async () => ({
      muted: false,
      touched: ['predictions', 'portfolios', 'chat'],
    }),
  };

  const onboarding = {
    getState: async () => ({
      started_at: '2026-04-27T00:00:00.000Z',
      completed_at: '2026-04-27T00:10:00.000Z',
      skipped: false,
      current_step: 'welcome',
      steps_completed: ['welcome', 'dashboard'],
      last_seen_at: '2026-04-27T00:10:00.000Z',
      first_touch_muted: false,
    }),
  };

  const usageQuery = {
    getSummary: async () => ({
      total_calls: 4,
      total_tokens_in: 100,
      total_tokens_out: 50,
      total_cost_cents: 7,
    }),
  };

  const service = new MasteryService(
    db as never,
    firstTouch as never,
    onboarding as never,
    usageQuery as never,
  );

  return { service, profileRow };
}

async function main() {
  console.log('\n=== MasteryService Tests ===\n');

  await test('getProfile returns persisted level plus derived milestones', async () => {
    const { service } = makeHarness();
    const profile = await service.getProfile('user-1');
    assert.equal(profile.currentLevel, 'competitive_participation');
    assert.equal(profile.preferredLevel, null);
    assert.equal(profile.milestones.firstTrade, true);
    assert.equal(profile.milestones.firstTournamentJoined, true);
    assert.equal(profile.milestones.firstClubJoined, false);
    assert.equal(profile.milestones.firstPortfolioComparison, true);
    assert.equal(profile.learningPanel.usage.totalCalls, 4);
    assert.ok(profile.nextSuggestedSteps.length > 0);
  });

  await test('existing authored users seed into builder visibility', async () => {
    const { service } = makeHarness({
      firstTournamentJoined: true,
      firstClubJoined: true,
      firstAuthoredItem: true,
    });
    const profile = await service.getProfile('user-1');
    assert.equal(profile.currentLevel, 'builder');
  });

  await test('updatePreferredLevel persists a new preferred level', async () => {
    const { service, profileRow } = makeHarness();
    const profile = await service.updatePreferredLevel('user-1', 'community_creation');
    assert.equal(profile.preferredLevel, 'community_creation');
    assert.equal(profile.currentLevel, 'community_creation');
    assert.equal(profileRow.preferred_level, 'community_creation');
  });

  await test('learning panel context promotes owner users to operator effective level', async () => {
    const { service } = makeHarness({ globalRole: 'owner' });
    const context = await service.getLearningPanelContext('user-1', 'authenticated');
    assert.equal(context.currentLevel, 'competitive_participation');
    assert.equal(context.effectiveLevel, 'operator');
    assert.ok(context.visibleSurfaces.includes('operator dashboards'));
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
