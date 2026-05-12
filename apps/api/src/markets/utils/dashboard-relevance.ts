export type DashboardRelevanceReason =
  | 'followed_analyst'
  | 'watched_instrument'
  | 'open_position'
  | 'queued_trade'
  | 'active_tournament'
  | 'analyst_affinity'
  | 'high_conviction'
  | 'analyst_disagreement'
  | 'recent_activity';

export type DashboardPriorityMode = 'balanced' | 'portfolio_first' | 'tournaments_first';

export interface DashboardAnalysisRelevance {
  score: number;
  reasons: DashboardRelevanceReason[];
  explicit_preference_score: number;
  open_position_count: number;
  active_tournament_count: number;
  top_affinity_score: number | null;
  disagreement_score: number | null;
}

export interface DashboardRelevanceInput {
  instrumentId: string;
  analystIds: string[];
  confidence: number;
  directions: string[];
  createdAt: string;
  followedAnalystIds: Set<string>;
  watchedInstrumentIds: Set<string>;
  mutedInstrumentIds: Set<string>;
  openPositionInstrumentIds: Set<string>;
  queuedTradeInstrumentIds: Set<string>;
  activeTournamentInstrumentIds: Set<string>;
  analystAffinityScores: Map<string, number>;
  priorityMode: DashboardPriorityMode;
  now?: Date;
}

export interface DashboardRelevanceResult {
  hidden: boolean;
  relevance: DashboardAnalysisRelevance;
}

function normalizedConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return confidence <= 1 ? confidence * 100 : confidence;
}

function disagreementScore(directions: string[]): number {
  const nonFlat = directions.filter((dir) => dir === 'up' || dir === 'down');
  if (nonFlat.length < 2) return 0;
  const up = nonFlat.filter((dir) => dir === 'up').length;
  const down = nonFlat.filter((dir) => dir === 'down').length;
  if (up === 0 || down === 0) return 0;
  return Math.min(up, down) / nonFlat.length;
}

function recencyScore(createdAt: string, now: Date): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  const ageHours = Math.max(0, (now.getTime() - created) / 3_600_000);
  return Math.max(0, 1 - ageHours / (24 * 7));
}

function maxAffinity(analystIds: string[], scores: Map<string, number>): number | null {
  let best: number | null = null;
  for (const id of analystIds) {
    const score = scores.get(id);
    if (typeof score === 'number' && Number.isFinite(score)) {
      best = best === null ? score : Math.max(best, score);
    }
  }
  return best;
}

export function scoreDashboardAnalysis(input: DashboardRelevanceInput): DashboardRelevanceResult {
  const reasons: DashboardRelevanceReason[] = [];
  if (input.mutedInstrumentIds.has(input.instrumentId)) {
    return {
      hidden: true,
      relevance: {
        score: Number.NEGATIVE_INFINITY,
        reasons,
        explicit_preference_score: -1000,
        open_position_count: 0,
        active_tournament_count: 0,
        top_affinity_score: null,
        disagreement_score: null,
      },
    };
  }

  let explicit = 0;
  if (input.watchedInstrumentIds.has(input.instrumentId)) {
    explicit += 120;
    reasons.push('watched_instrument');
  }
  if (input.analystIds.some((id) => input.followedAnalystIds.has(id))) {
    explicit += 90;
    reasons.push('followed_analyst');
  }

  const hasOpenPosition = input.openPositionInstrumentIds.has(input.instrumentId);
  const hasQueuedTrade = input.queuedTradeInstrumentIds.has(input.instrumentId);
  const hasActiveTournament = input.activeTournamentInstrumentIds.has(input.instrumentId);
  const openPositionCount = hasOpenPosition ? 1 : 0;
  const activeTournamentCount = hasActiveTournament ? 1 : 0;
  let context = 0;

  if (hasOpenPosition) {
    context += input.priorityMode === 'tournaments_first' ? 130 : 180;
    reasons.push('open_position');
  }
  if (hasQueuedTrade) {
    context += 100;
    reasons.push('queued_trade');
  }
  if (hasActiveTournament) {
    context += input.priorityMode === 'portfolio_first' ? 130 : 180;
    reasons.push('active_tournament');
  }

  const topAffinity = maxAffinity(input.analystIds, input.analystAffinityScores);
  let preference = explicit;
  if (topAffinity !== null && topAffinity >= 0.7) {
    preference += topAffinity * 60;
    reasons.push('analyst_affinity');
  }

  const confidence = normalizedConfidence(input.confidence);
  let quality = 0;
  if (confidence >= 70) {
    quality += (confidence - 70) * 2;
    reasons.push('high_conviction');
  }

  const disagree = disagreementScore(input.directions);
  if (disagree >= 0.25) {
    quality += disagree * 70;
    reasons.push('analyst_disagreement');
  }

  const score = Math.round((preference + context + quality + recencyScore(input.createdAt, input.now ?? new Date()) * 10) * 100) / 100;
  return {
    hidden: false,
    relevance: {
      score,
      reasons,
      explicit_preference_score: explicit,
      open_position_count: openPositionCount,
      active_tournament_count: activeTournamentCount,
      top_affinity_score: topAffinity,
      disagreement_score: disagree > 0 ? disagree : null,
    },
  };
}
