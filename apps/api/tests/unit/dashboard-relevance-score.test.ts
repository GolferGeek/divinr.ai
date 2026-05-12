import assert from 'node:assert/strict';
import { scoreDashboardAnalysis } from '../../src/markets/utils/dashboard-relevance';

function base(overrides: Partial<Parameters<typeof scoreDashboardAnalysis>[0]> = {}) {
  return {
    instrumentId: 'inst-a',
    analystIds: ['analyst-a'],
    confidence: 82,
    directions: ['up', 'up'],
    createdAt: '2026-05-12T12:00:00.000Z',
    followedAnalystIds: new Set<string>(),
    watchedInstrumentIds: new Set<string>(),
    mutedInstrumentIds: new Set<string>(),
    openPositionInstrumentIds: new Set<string>(),
    queuedTradeInstrumentIds: new Set<string>(),
    activeTournamentInstrumentIds: new Set<string>(),
    analystAffinityScores: new Map<string, number>(),
    priorityMode: 'balanced' as const,
    now: new Date('2026-05-12T13:00:00.000Z'),
    ...overrides,
  };
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test('muted instruments are hidden from dashboard scoring', () => {
  const result = scoreDashboardAnalysis(base({
    mutedInstrumentIds: new Set(['inst-a']),
    watchedInstrumentIds: new Set(['inst-a']),
  }));
  assert.equal(result.hidden, true);
  assert.equal(result.relevance.reasons.length, 0);
});

test('followed analysts and watched instruments add explicit preference reasons', () => {
  const result = scoreDashboardAnalysis(base({
    followedAnalystIds: new Set(['analyst-a']),
    watchedInstrumentIds: new Set(['inst-a']),
  }));
  assert.equal(result.hidden, false);
  assert(result.relevance.explicit_preference_score > 0);
  assert(result.relevance.reasons.includes('followed_analyst'));
  assert(result.relevance.reasons.includes('watched_instrument'));
});

test('portfolio priority favors open positions over tournament-only instruments', () => {
  const portfolio = scoreDashboardAnalysis(base({
    instrumentId: 'inst-held',
    openPositionInstrumentIds: new Set(['inst-held']),
    activeTournamentInstrumentIds: new Set(['inst-tournament']),
    priorityMode: 'portfolio_first',
  }));
  const tournament = scoreDashboardAnalysis(base({
    instrumentId: 'inst-tournament',
    openPositionInstrumentIds: new Set(['inst-held']),
    activeTournamentInstrumentIds: new Set(['inst-tournament']),
    priorityMode: 'portfolio_first',
  }));
  assert(portfolio.relevance.score > tournament.relevance.score);
  assert(portfolio.relevance.reasons.includes('open_position'));
});

test('tournament priority favors active tournament instruments over portfolio-only instruments', () => {
  const portfolio = scoreDashboardAnalysis(base({
    instrumentId: 'inst-held',
    openPositionInstrumentIds: new Set(['inst-held']),
    activeTournamentInstrumentIds: new Set(['inst-tournament']),
    priorityMode: 'tournaments_first',
  }));
  const tournament = scoreDashboardAnalysis(base({
    instrumentId: 'inst-tournament',
    openPositionInstrumentIds: new Set(['inst-held']),
    activeTournamentInstrumentIds: new Set(['inst-tournament']),
    priorityMode: 'tournaments_first',
  }));
  assert(tournament.relevance.score > portfolio.relevance.score);
  assert(tournament.relevance.reasons.includes('active_tournament'));
});

test('high analyst affinity and disagreement add explainable reasons', () => {
  const result = scoreDashboardAnalysis(base({
    analystIds: ['analyst-a', 'analyst-b'],
    directions: ['up', 'down'],
    analystAffinityScores: new Map([['analyst-b', 0.82]]),
  }));
  assert(result.relevance.reasons.includes('analyst_affinity'));
  assert(result.relevance.reasons.includes('analyst_disagreement'));
  assert.equal(result.relevance.top_affinity_score, 0.82);
  assert(result.relevance.disagreement_score !== null && result.relevance.disagreement_score > 0);
});

test('dashboard-threshold confidence adds an explainable quality reason', () => {
  const result = scoreDashboardAnalysis(base({
    confidence: 72,
    directions: ['up', 'up'],
  }));
  assert(result.relevance.reasons.includes('high_conviction'));
});

test('same inputs produce stable scores', () => {
  const input = base({
    watchedInstrumentIds: new Set(['inst-a']),
    activeTournamentInstrumentIds: new Set(['inst-a']),
  });
  const first = scoreDashboardAnalysis(input);
  const second = scoreDashboardAnalysis(input);
  assert.deepEqual(first, second);
});
