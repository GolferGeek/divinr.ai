import { useTournamentStore, type Tournament } from '../stores/tournament.store';

export type ActiveTournamentState = 'none' | 'one' | 'many';

export interface ActiveTournamentResult {
  state: ActiveTournamentState;
  tournaments: Tournament[];
}

export function impliedQuantity(startingBalance: number, confidence: number, currentPrice: number | null | undefined): number {
  const pct = Math.max(0.01, Math.min(0.05, 0.01 + (Number(confidence) / 100) * 0.04));
  const price = Number(currentPrice ?? 0);
  if (!(price > 0)) return 1;
  return Math.max(1, Math.floor((Number(startingBalance) * pct) / price));
}

export function useActiveTournament() {
  const store = useTournamentStore();

  async function resolveActiveTournaments(opts?: { force?: boolean }): Promise<ActiveTournamentResult> {
    const hasEntries = store.myEntries.length > 0;
    const hasActives = store.tournaments.some(t => t.status === 'active');
    const needsFetch = opts?.force || !hasEntries || !hasActives;
    if (needsFetch) {
      await Promise.all([
        store.fetchMyEntries(),
        store.fetchTournaments({ status: 'active' }),
      ]);
    }
    const entryIds = new Set(store.myEntries.map(e => e.tournament_id));
    const tournaments = store.tournaments.filter(t => t.status === 'active' && entryIds.has(t.id));
    const state: ActiveTournamentState = tournaments.length === 0 ? 'none' : tournaments.length === 1 ? 'one' : 'many';
    return { state, tournaments };
  }

  return { resolveActiveTournaments };
}
