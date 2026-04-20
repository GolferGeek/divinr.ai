import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed += 1;
  }
}

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

console.log('=== social-opt-out coverage across discovery surfaces ===\n');

const SURFACES: Array<{ path: string; flag: string; label: string }> = [
  {
    path: '../../src/clubs/club.service.ts',
    flag: 'social_visible_in_member_lists',
    label: 'clubs/club.service.ts (member roster)',
  },
  {
    path: '../../src/clubs/club-analytics.service.ts',
    flag: 'social_leaderboard_visible',
    label: 'clubs/club-analytics.service.ts (post-mortem highlights)',
  },
  {
    path: '../../src/tournaments/tournament-portfolio.service.ts',
    flag: 'social_tournament_participation',
    label: 'tournaments/tournament-portfolio.service.ts (entries)',
  },
  {
    path: '../../src/tournaments/tournament-leaderboard.service.ts',
    flag: 'social_leaderboard_visible',
    label: 'tournaments/tournament-leaderboard.service.ts (leaderboard/results)',
  },
  {
    path: '../../src/markets/markets.service.ts',
    flag: 'social_visible_in_member_lists',
    label: 'markets/markets.service.ts (listAnalysts)',
  },
  {
    path: '../../src/messaging/messaging.service.ts',
    flag: 'social_messaging_enabled',
    label: 'messaging/messaging.service.ts (searchUsers)',
  },
  {
    path: '../../src/markets/services/notification.service.ts',
    flag: 'social_notifications_enabled',
    label: 'markets/services/notification.service.ts (notify + notifyAllUsers)',
  },
];

for (const surface of SURFACES) {
  test(`${surface.label} references ${surface.flag}`, () => {
    const src = read(surface.path);
    const importsService =
      src.includes('SocialOptOutService') || src.includes("social-opt-out.service");
    const callsHelper = src.includes('applyVisibilityFilter');
    const mentionsFlag = src.includes(surface.flag);
    assert.ok(
      (importsService && callsHelper) || mentionsFlag,
      `${surface.label}: expected either SocialOptOutService+applyVisibilityFilter or inline reference to ${surface.flag}`,
    );
  });
}

test('SocialOptOutService exists and exposes applyVisibilityFilter', () => {
  const src = read('../../src/users/social-opt-out.service.ts');
  assert.match(src, /class\s+SocialOptOutService/, 'SocialOptOutService class missing');
  assert.match(
    src,
    /applyVisibilityFilter\s*\(/,
    'applyVisibilityFilter method missing',
  );
  assert.match(src, /IS\s+NOT\s+FALSE/i, 'IS NOT FALSE NULL-safe predicate missing');
});

test('UsersModule exports SocialOptOutService for cross-module DI', () => {
  const src = read('../../src/users/users.module.ts');
  assert.ok(src.includes('SocialOptOutService'), 'UsersModule should reference SocialOptOutService');
  assert.match(src, /exports\s*:\s*\[[^\]]*SocialOptOutService/s, 'SocialOptOutService not in exports');
});

test('UsersController exposes self-serve GET + PATCH endpoints', () => {
  const src = read('../../src/users/users.controller.ts');
  assert.match(src, /social-opt-outs/, 'users controller route missing');
  assert.match(src, /@Get\(/, 'GET handler missing');
  assert.match(src, /@Patch\(/, 'PATCH handler missing');
  assert.match(src, /@SkipReadOnly\(\)/, 'SkipReadOnly decorator missing on read-only exempt handlers');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
