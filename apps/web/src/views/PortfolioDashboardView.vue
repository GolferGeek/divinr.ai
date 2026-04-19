<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { usePortfolioStore, type PortfolioSummary } from '../stores/portfolio.store';
import { useEnablementStore, type EnabledTriple } from '../stores/enablement.store';
import { useCanWrite } from '../composables/useCanWrite';
import { useApi } from '../composables/useApi';
import { useRouter } from 'vue-router';
import AddTripleFlow from '../components/AddTripleFlow.vue';
import EquitySparkline from '../components/EquitySparkline.vue';
import EquityCurveChart from '../components/EquityCurveChart.vue';
import CalibrationChart from '../components/CalibrationChart.vue';
import ProvenanceTooltip from '../components/ProvenanceTooltip.vue';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import type { SnapshotHistoryPoint, BenchmarkPoint, CalibrationBucket } from '../stores/portfolio.store';
import { colorClass } from '../utils/colorClass';
import {
  IonCard, IonCardContent, IonGrid, IonRow, IonCol,
  IonChip, IonList, IonItem, IonLabel, IonButton, IonNote,
  IonSegment, IonSegmentButton,
} from '@ionic/vue';

const portfolio = usePortfolioStore();
const enablement = useEnablementStore();
const { canWrite } = useCanWrite();
const api = useApi();
const router = useRouter();
const decisions = ref<Array<Record<string, unknown>>>([]);
const expandedKey = ref<string | null>(null);

onMounted(async () => {
  try {
    await portfolio.fetchMyPortfolio();
    await Promise.all([
      portfolio.fetchAllPortfolios(),
      portfolio.fetchMyPositions('open'),
      portfolio.fetchMyQueue(),
      api.get<Array<Record<string, unknown>>>('/trades/decisions').then(d => decisions.value = d).catch(() => {}),
    ]);
    applyTab('mine');
  } catch (err) {
    console.error('Failed to load portfolio data', err);
  }
});

function rowKey(p: PortfolioSummary): string { return `${p.kind}:${p.id}`; }

async function toggleRow(p: PortfolioSummary) {
  const k = rowKey(p);
  if (expandedKey.value === k) { expandedKey.value = null; return; }
  expandedKey.value = k;
  if (!portfolio.portfolioDetails[k]) {
    try { await portfolio.fetchPortfolioDetail(p.kind, p.id); } catch (_) { /* swallow */ }
  }
}

function pnlColor(val: unknown): string {
  const n = Number(val);
  if (n > 0) return 'color:var(--ion-color-success)';
  if (n < 0) return 'color:var(--ion-color-danger)';
  return '';
}

function formatCurrency(val: unknown): string {
  const n = Number(val);
  return n >= 0
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(val: unknown): string {
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function kindBadgeColor(kind: string): string {
  switch (kind) {
    case 'user': return 'primary';
    case 'analyst': return 'tertiary';
    case 'arbitrator': return 'warning';
    case 'day_trader': return 'secondary';
    default: return 'medium';
  }
}

type SortKey =
  | 'name' | 'kind' | 'current_balance' | 'realized_pnl' | 'unrealized_pnl'
  | 'win_rate' | 'total_return_pct' | 'total_bailouts' | 'open_position_count'
  | 'sharpe_30d' | 'max_drawdown_30d' | 'longest_win_streak' | 'calibration_score';

const sortKey = ref<SortKey | null>(null);
const sortDir = ref<'asc' | 'desc'>('desc');
const search = ref('');
const ALL_KINDS: Array<PortfolioSummary['kind']> = ['user', 'analyst', 'arbitrator', 'day_trader'];
const activeKinds = ref<Set<PortfolioSummary['kind']>>(new Set(ALL_KINDS));
const portfolioTab = ref<'mine' | 'analysts' | 'triples'>('mine');

function applyTab(tab: 'mine' | 'analysts' | 'triples') {
  portfolioTab.value = tab;
  if (tab === 'mine') {
    activeKinds.value = new Set(['user']);
    const myId = String(portfolio.myPortfolio?.['id'] ?? '');
    if (myId) {
      const k = `user:${myId}`;
      expandedKey.value = k;
      if (!portfolio.portfolioDetails[k]) {
        portfolio.fetchPortfolioDetail('user', myId).catch(() => {});
      }
    }
  } else if (tab === 'triples') {
    enablement.fetchEnabledTriples().catch(() => {});
  } else {
    activeKinds.value = new Set(['analyst', 'arbitrator', 'day_trader']);
    expandedKey.value = null;
  }
}

function authorshipLabel(triple: EnabledTriple): string {
  if (triple.isAuthoredAnalyst || triple.isAuthoredInstrument) return '(yours)';
  return '(base)';
}

async function handleDisableTriple(triple: EnabledTriple) {
  await enablement.disableTriple(triple.analystId, triple.instrumentId, triple.authorUserId ?? undefined);
}

function navigateToTriple(triple: EnabledTriple) {
  router.push({
    path: `/instruments/${triple.instrumentId}`,
    query: {
      analystId: triple.analystId,
      authorUserId: triple.authorUserId ?? '',
    },
  });
}

function toggleKind(k: PortfolioSummary['kind']) {
  const next = new Set(activeKinds.value);
  if (next.has(k)) next.delete(k); else next.add(k);
  activeKinds.value = next;
}

function setSort(key: SortKey | string) {
  if (!key) { sortKey.value = null; return; }
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key as SortKey;
    sortDir.value = 'desc';
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '';
  return sortDir.value === 'asc' ? ' ▲' : ' ▼';
}

function compareValues(a: unknown, b: unknown, dir: 'asc' | 'desc'): number {
  const sign = dir === 'asc' ? 1 : -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b) * sign;
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isFinite(an) && !Number.isFinite(bn)) return 0;
  if (!Number.isFinite(an)) return 1;  // nulls always to bottom
  if (!Number.isFinite(bn)) return -1;
  return (an - bn) * sign;
}

const sortedPortfolios = computed(() => {
  const filtered = portfolio.allPortfolios.filter((p) => {
    if (!activeKinds.value.has(p.kind)) return false;
    if (search.value.trim()) {
      return p.name.toLowerCase().includes(search.value.trim().toLowerCase());
    }
    return true;
  });

  if (!sortKey.value) {
    // default: user first, then highest total_return_pct
    return [...filtered].sort((a, b) => {
      if (a.kind === 'user' && b.kind !== 'user') return -1;
      if (b.kind === 'user' && a.kind !== 'user') return 1;
      return Number(b.total_return_pct) - Number(a.total_return_pct);
    });
  }

  const key = sortKey.value;
  return [...filtered].sort((a, b) => compareValues(a[key], b[key], sortDir.value));
});

const GROUP_ORDER = ['user', 'analyst', 'day_trader'] as const;
const GROUP_LABELS: Record<string, string> = {
  user: 'My Portfolio',
  analyst: 'Analysts',
  day_trader: 'Day Traders',
};

const groupedPortfolios = computed(() => {
  const list = sortedPortfolios.value;
  const groups: Array<{ kind: string; label: string; items: PortfolioSummary[] }> = [];
  for (const groupKey of GROUP_ORDER) {
    let items: PortfolioSummary[];
    if (groupKey === 'user') {
      // Only show the current user's portfolio
      const myId = String(portfolio.myPortfolio?.['id'] ?? '');
      items = list.filter(p => p.kind === 'user' && p.id === myId);
      // Fallback: if myPortfolio not loaded yet, show nothing
      if (!myId) items = [];
    } else if (groupKey === 'analyst') {
      // Merge analysts and arbitrator — arbitrator first
      const arbitrators = list.filter(p => p.kind === 'arbitrator');
      const analysts = list.filter(p => p.kind === 'analyst');
      items = [...arbitrators, ...analysts];
    } else {
      items = list.filter(p => p.kind === groupKey);
    }
    if (items.length > 0) {
      groups.push({ kind: groupKey, label: GROUP_LABELS[groupKey] || groupKey, items });
    }
  }
  return groups;
});

function fmtSharpe(v: number | null): string {
  return v == null ? '—' : v.toFixed(2);
}
function fmtDrawdown(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}
function fmtCalibration(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(0)}%`;
}

function detailHistory(p: PortfolioSummary): SnapshotHistoryPoint[] {
  const d = portfolio.portfolioDetails[rowKey(p)];
  return (d?.snapshot_history ?? []) as SnapshotHistoryPoint[];
}
function detailBenchmark(p: PortfolioSummary): BenchmarkPoint[] {
  const d = portfolio.portfolioDetails[rowKey(p)];
  return (d?.benchmark_series ?? []) as BenchmarkPoint[];
}
function detailCalibration(p: PortfolioSummary): CalibrationBucket[] | null {
  const d = portfolio.portfolioDetails[rowKey(p)];
  return (d?.calibration_buckets ?? null) as CalibrationBucket[] | null;
}

async function onSellPosition(p: PortfolioSummary, positionId: string) {
  try {
    await portfolio.closePositionAction(positionId);
    // Re-fetch the user detail row so the closed status appears
    await portfolio.fetchPortfolioDetail(p.kind, p.id);
  } catch (_) { /* swallow */ }
}

// 5.6a — reference exit levels for the user's open positions (informational only)
function refLevels(pos: Record<string, unknown>): { label: string; value: string }[] {
  const entry = Number(pos.entry_price ?? 0);
  const dir = String(pos.direction ?? 'long');
  if (!entry) return [];
  const sign = dir === 'long' ? 1 : -1;
  const stop5 = entry * (1 - 0.05 * sign);
  const stop10 = entry * (1 - 0.10 * sign);
  const trail = entry * (1 + 0.08 * sign); // illustrative trailing-stop reference
  return [
    { label: '5% stop', value: `$${stop5.toFixed(2)}` },
    { label: '10% stop', value: `$${stop10.toFixed(2)}` },
    { label: '8% trail', value: `$${trail.toFixed(2)}` },
  ];
}
</script>

<template>
  <div>
    <h1 style="margin-bottom:16px">Portfolios</h1>

    <!-- Portfolio Tabs -->
    <IonSegment :value="portfolioTab" @ionChange="applyTab(($event.detail.value as 'mine' | 'analysts' | 'triples'))" style="margin-bottom:12px;max-width:500px">
      <IonSegmentButton value="mine"><IonLabel>My Portfolio</IonLabel></IonSegmentButton>
      <IonSegmentButton value="analysts"><IonLabel>Analyst Portfolios</IonLabel></IonSegmentButton>
      <IonSegmentButton value="triples"><IonLabel>My Triples</IonLabel></IonSegmentButton>
    </IonSegment>

    <!-- My Triples Panel -->
    <div v-if="portfolioTab === 'triples'">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <span style="font-size:0.82rem;opacity:0.6">{{ enablement.enabledCount }} active triple{{ enablement.enabledCount === 1 ? '' : 's' }}</span>
      </div>

      <div v-if="enablement.loading" style="opacity:0.6;padding:16px">Loading triples...</div>

      <div v-else-if="enablement.groupedByInstrument.length === 0" style="padding:16px">
        <IonNote color="primary">No triples enabled yet. Add instruments to your portfolio to get started.</IonNote>
      </div>

      <div v-else style="display:flex;flex-direction:column;gap:0">
        <div v-for="group in enablement.groupedByInstrument" :key="group.instrumentId" style="border-bottom:1px solid var(--ion-color-step-100)">
          <div style="padding:12px 16px 4px 16px;font-weight:600;font-size:0.95rem">
            {{ group.instrumentSymbol }}
            <span style="font-weight:400;font-size:0.82rem;opacity:0.6;margin-left:8px">{{ group.instrumentName }}</span>
            <span v-if="group.isAuthoredInstrument" style="font-size:0.72rem;opacity:0.5;margin-left:6px">(yours)</span>
          </div>
          <div
            v-for="triple in group.triples"
            :key="triple.id"
            class="triple-row"
            style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px 8px 32px;cursor:pointer"
            @click="navigateToTriple(triple)"
          >
            <div>
              <span style="font-size:0.88rem">{{ triple.analystName }}</span>
              <span style="font-size:0.75rem;opacity:0.5;margin-left:6px">{{ authorshipLabel(triple) }}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span
                v-if="triple.isAuthoredAnalyst || triple.isAuthoredInstrument"
                style="font-size:0.68rem;opacity:0.45;max-width:200px"
              >Billing continues until content is deleted</span>
              <IonButton
                size="small"
                fill="outline"
                color="medium"
                @click.stop="handleDisableTriple(triple)"
              >Disable</IonButton>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:16px">
        <AddTripleFlow />
      </div>
    </div>

    <!-- Filters (only for portfolio/analyst tabs) -->
    <div v-if="portfolioTab !== 'triples'" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
      <input
        v-model="search"
        type="text"
        placeholder="Search by name…"
        data-testid="portfolio-search"
        style="padding:6px 10px;border:1px solid var(--ion-color-step-200);border-radius:4px;font-size:0.85rem;min-width:140px;max-width:100%"
      />
      <span style="font-size:0.75rem;opacity:0.7;margin-left:8px">Kinds:</span>
      <ion-chip
        v-for="k in ALL_KINDS"
        :key="k"
        :color="activeKinds.has(k) ? kindBadgeColor(k) : 'medium'"
        :outline="!activeKinds.has(k)"
        :data-testid="`kind-chip-${k}`"
        style="cursor:pointer;font-size:0.7rem;height:22px"
        @click="toggleKind(k)"
      >{{ k }}</ion-chip>

      <span style="font-size:0.75rem;opacity:0.7;margin-left:16px">Sort:</span>
      <select
        :value="sortKey ?? ''"
        style="padding:5px 8px;border:1px solid var(--ion-color-step-200);border-radius:4px;font-size:0.82rem;background:var(--ion-background-color);color:inherit"
        @change="setSort(($event.target as HTMLSelectElement).value as SortKey)"
      >
        <option value="">Default</option>
        <option value="name">Name</option>
        <option value="current_balance">Balance</option>
        <option value="total_return_pct">Return</option>
        <option value="win_rate">Win Rate</option>
        <option value="realized_pnl">Realized P&amp;L</option>
        <option value="unrealized_pnl">Unrealized P&amp;L</option>
        <option value="open_position_count">Open Positions</option>
        <option value="longest_win_streak">Win Streak</option>
        <option value="sharpe_30d">Sharpe</option>
        <option value="max_drawdown_30d">Max Drawdown</option>
        <option value="calibration_score">Calibration</option>
      </select>
      <ion-chip
        v-if="sortKey"
        :color="sortDir === 'desc' ? 'primary' : 'medium'"
        style="cursor:pointer;font-size:0.7rem;height:22px"
        @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
      >{{ sortDir === 'desc' ? 'High to Low' : 'Low to High' }}</ion-chip>
    </div>

    <!-- Portfolio rows grouped by kind -->
    <div v-if="portfolioTab !== 'triples'" style="display:flex;flex-direction:column;gap:0">
      <template v-for="group in groupedPortfolios" :key="group.kind">
        <!-- Group header -->
        <div style="display:grid;grid-template-columns:3fr 1fr 1fr 1fr 0.5fr;gap:4px;padding:10px 16px 4px 16px;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.45;border-bottom:1px solid var(--ion-color-step-100);margin-top:8px">
          <span>{{ group.label }}</span>
          <span style="text-align:right">Balance</span>
          <span style="text-align:right">Return</span>
          <span style="text-align:right">Win Rate</span>
          <span style="text-align:right">Open</span>
        </div>

        <template v-for="p in group.items" :key="rowKey(p)">
          <!-- Row -->
          <div
            class="portfolio-row"
            :style="expandedKey === rowKey(p) ? 'background:var(--ion-color-step-50);border-left:3px solid var(--ion-color-primary)' : 'border-left:3px solid transparent'"
            @click="toggleRow(p)"
          >
            <div style="display:grid;grid-template-columns:3fr 1fr 1fr 1fr 0.5fr;gap:4px;align-items:center;padding:10px 16px;cursor:pointer">
              <div style="font-size:0.92rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ p.name }}</div>
              <div style="text-align:right;font-size:0.88rem;font-weight:500">{{ formatCurrency(p.current_balance) }}</div>
              <div style="text-align:right;font-size:0.88rem;font-weight:600" :style="pnlColor(p.total_return_pct)">{{ fmtPct(p.total_return_pct) }}</div>
              <div style="text-align:right;font-size:0.88rem">{{ p.win_rate != null ? `${p.win_rate.toFixed(0)}%` : '—' }}</div>
              <div style="text-align:right;font-size:0.88rem">{{ p.open_position_count }}</div>
            </div>

          <!-- Expanded detail panel -->
          <div v-if="expandedKey === rowKey(p)" style="padding:0 16px 16px 16px;border-top:1px solid var(--ion-color-step-100)">
            <!-- Secondary metrics -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px 24px;padding:12px 0;font-size:0.82rem">
              <div><span style="opacity:0.5">Realized</span> <span :style="pnlColor(p.realized_pnl)" style="font-weight:500;margin-left:6px">{{ formatCurrency(p.realized_pnl) }}</span></div>
              <div><span style="opacity:0.5">Unrealized</span> <span :style="pnlColor(p.unrealized_pnl)" style="font-weight:500;margin-left:6px">{{ formatCurrency(p.unrealized_pnl) }}</span></div>
              <div><span style="opacity:0.5">Bailouts</span> <span style="font-weight:500;margin-left:6px">{{ formatCurrency(p.total_bailouts) }}</span></div>
              <div><span style="opacity:0.5">Sharpe</span> <span style="font-weight:500;margin-left:6px">{{ fmtSharpe(p.sharpe_30d) }}</span></div>
              <div><span style="opacity:0.5">Max DD</span> <span :style="pnlColor(p.max_drawdown_30d)" style="font-weight:500;margin-left:6px">{{ fmtDrawdown(p.max_drawdown_30d) }}</span></div>
              <div><span style="opacity:0.5">Streak</span> <span style="font-weight:500;margin-left:6px">{{ p.longest_win_streak ?? 0 }}</span></div>
              <div v-if="p.calibration_score != null">
                <span style="opacity:0.5">Calibration</span>
                <router-link
                  v-if="p.analyst_id"
                  :to="{ name: 'analyst-performance', params: { id: p.analyst_id } }"
                  style="text-decoration:underline;color:var(--ion-color-primary);font-weight:500;margin-left:6px"
                  @click.stop
                >{{ fmtCalibration(p.calibration_score) }}</router-link>
                <span v-else style="font-weight:500;margin-left:6px">{{ fmtCalibration(p.calibration_score) }}</span>
              </div>
            </div>
                <!-- Equity curve + calibration charts -->
                <div v-if="portfolio.portfolioDetails[rowKey(p)]" style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:24px">
                  <div style="flex:1 1 480px;min-width:320px">
                    <EquityCurveChart
                      :history="detailHistory(p)"
                      :benchmark="detailBenchmark(p)"
                    />
                  </div>
                  <div
                    v-if="p.kind === 'analyst' && detailCalibration(p)"
                    style="flex:1 1 360px;min-width:320px"
                  >
                    <CalibrationChart :buckets="detailCalibration(p)!" />
                  </div>
                </div>
                <div v-if="!portfolio.portfolioDetails[rowKey(p)]" style="opacity:0.6">Loading…</div>
                <div v-else>
                  <h3 style="margin:0 0 8px 0">Positions</h3>
                  <ion-list v-if="(portfolio.portfolioDetails[rowKey(p)]?.positions || []).length > 0">
                    <ion-item v-for="pos in portfolio.portfolioDetails[rowKey(p)].positions" :key="String(pos.id)">
                      <ion-button
                        v-if="canWrite && p.kind === 'user' && pos.status === 'open'"
                        slot="end"
                        size="small"
                        color="danger"
                        fill="outline"
                        @click.stop="onSellPosition(p, String(pos.id))"
                      >Sell</ion-button>
                      <ion-label>
                        <h3>
                          {{ pos.symbol }}
                          <ion-chip :color="pos.direction === 'long' ? 'success' : 'danger'" style="font-size:0.7rem;height:20px">{{ pos.direction }}</ion-chip>
                          <ion-chip :color="pos.status === 'open' ? 'primary' : 'medium'" style="font-size:0.7rem;height:20px">{{ pos.status }}</ion-chip>
                          <ProvenanceTooltip :position="pos as Record<string, unknown>" />
                        </h3>
                        <p>
                          Qty: {{ pos.quantity }} | Entry: ${{ Number(pos.entry_price).toFixed(2) }}
                          <span v-if="pos.exit_price"> | Exit: ${{ Number(pos.exit_price).toFixed(2) }}</span>
                          <span v-if="pos.unrealized_pnl != null" :style="pnlColor(pos.unrealized_pnl)"> | Unrealized: {{ formatCurrency(pos.unrealized_pnl) }}</span>
                          <span v-if="pos.realized_pnl != null && pos.status === 'closed'" :style="pnlColor(pos.realized_pnl)"> | Realized: {{ formatCurrency(pos.realized_pnl) }}</span>
                          <span v-if="p.kind === 'user' && pos.status === 'open'">
                            | Today:
                            <span v-if="pos.intraday_pct != null" :class="colorClass(pos.intraday_pct as number)">{{ (Number(pos.intraday_pct) * 100).toFixed(2) }}%</span>
                            <span v-else>—</span>
                          </span>
                        </p>
                        <!-- 5.6a reference levels for user open positions only -->
                        <p v-if="p.kind === 'user' && pos.status === 'open'" style="font-size:0.75rem;opacity:0.75">
                          reference levels (manual exit):
                          <span v-for="lvl in refLevels(pos as Record<string, unknown>)" :key="lvl.label" style="margin-right:8px">
                            {{ lvl.label }} {{ lvl.value }}
                          </span>
                        </p>
                      </ion-label>
                    </ion-item>
                  </ion-list>
                  <ion-note v-else color="primary" style="display:block">No positions in last 30 days.</ion-note>

                  <!-- 5.6 — user expanded panel preserves the existing widgets -->
                  <template v-if="p.kind === 'user'">
                    <h3 style="margin:16px 0 8px 0">Account</h3>
                    <ion-grid v-if="portfolio.myPortfolio">
                      <ion-row>
                        <ion-col size="12" size-md="3">
                          <ion-card>
                            <ion-card-content style="text-align:center">
                              <div style="font-size:1.25rem;font-weight:bold">{{ formatCurrency(portfolio.myPortfolio['current_balance']) }}</div>
                              <div style="opacity:0.7">Balance</div>
                            </ion-card-content>
                          </ion-card>
                        </ion-col>
                        <ion-col size="12" size-md="3">
                          <ion-card>
                            <ion-card-content style="text-align:center">
                              <div style="font-size:1.25rem;font-weight:bold" :style="pnlColor(portfolio.myPortfolio['total_realized_pnl'])">
                                {{ formatCurrency(portfolio.myPortfolio['total_realized_pnl']) }}
                              </div>
                              <div style="opacity:0.7">Realized P&amp;L</div>
                            </ion-card-content>
                          </ion-card>
                        </ion-col>
                        <ion-col size="12" size-md="3">
                          <ion-card>
                            <ion-card-content style="text-align:center">
                              <div style="font-size:1.25rem;font-weight:bold" :style="pnlColor(portfolio.myPortfolio['total_unrealized_pnl'])">
                                {{ formatCurrency(portfolio.myPortfolio['total_unrealized_pnl']) }}
                              </div>
                              <div style="opacity:0.7">Unrealized P&amp;L</div>
                            </ion-card-content>
                          </ion-card>
                        </ion-col>
                        <ion-col size="12" size-md="3">
                          <ion-card>
                            <ion-card-content style="text-align:center">
                              <div style="font-size:1.25rem;font-weight:bold">{{ portfolio.myPositions.length }}</div>
                              <div style="opacity:0.7">Open Positions</div>
                            </ion-card-content>
                          </ion-card>
                        </ion-col>
                      </ion-row>
                    </ion-grid>

                    <h3 style="margin:16px 0 8px 0">Queued Trades ({{ portfolio.myQueue.length }})</h3>
                    <ion-list v-if="portfolio.myQueue.length > 0">
                      <ion-item v-for="t in portfolio.myQueue" :key="String(t['id'])">
                        <ion-label>
                          <h3>{{ t['symbol'] }}</h3>
                          <p>
                            <ion-chip :color="t['direction'] === 'long' ? 'success' : 'danger'" style="font-size:0.7rem;height:20px">{{ t['direction'] }}</ion-chip>
                            Qty: {{ t['quantity'] }}
                          </p>
                          <p style="font-size:0.75rem">{{ new Date(String(t['queued_at'])).toLocaleString() }}</p>
                        </ion-label>
                        <ion-button v-if="canWrite" slot="end" fill="clear" size="small" color="danger" @click="portfolio.cancelTrade(String(t['id']))">Cancel</ion-button>
                      </ion-item>
                    </ion-list>
                    <ion-note v-else color="primary" style="display:block;padding:12px">No queued trades. Trades execute at 5 PM ET settlement.</ion-note>

                    <h3 v-if="decisions.length > 0" style="margin:16px 0 8px 0">Your Decisions</h3>
                    <ion-list v-if="decisions.length > 0">
                      <ion-item v-for="d in decisions" :key="String(d['id'])">
                        <ion-label>
                          <h3>
                            <ion-chip
                              :color="d['decision'] === 'skip' ? 'medium' : d['decision'] === 'buy' ? 'success' : 'danger'"
                              style="font-size:0.7rem;height:20px"
                            >{{ d['decision'] === 'skip' ? 'Skipped' : d['decision'] === 'buy' ? 'Bought' : 'Sold' }}</ion-chip>
                            {{ d['symbol'] }}
                            <span v-if="d['analyst_name']" style="font-size:0.8rem;opacity:0.6"> — {{ d['analyst_name'] }}</span>
                          </h3>
                          <p style="font-size:0.7rem;opacity:0.4">{{ new Date(String(d['decided_at'])).toLocaleDateString() }}</p>
                        </ion-label>
                      </ion-item>
                    </ion-list>
                  </template>
                </div>
              </div>
        <FirstTouchPanel surface-key="portfolios" />
  </div>
        </template>
      </template>
    </div>

    <ion-note v-if="portfolioTab !== 'triples' && sortedPortfolios.length === 0" color="primary" style="display:block;padding:12px">
      No portfolios yet.
    </ion-note>
  </div>
</template>

<style scoped>
.portfolio-row {
  border-bottom: 1px solid var(--ion-color-step-100);
  transition: background 0.15s ease, border-left-color 0.15s ease;
}
.portfolio-row:hover {
  background: var(--ion-color-step-50);
}
.triple-row:hover {
  background: var(--ion-color-step-50);
}
.positive { color: var(--ion-color-success); }
.negative { color: var(--ion-color-danger); }
.neutral { color: var(--ion-color-medium); }
</style>
