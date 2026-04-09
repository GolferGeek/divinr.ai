<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { usePortfolioStore, type PortfolioSummary } from '../stores/portfolio.store';
import { useCanWrite } from '../composables/useCanWrite';
import { useApi } from '../composables/useApi';
import EquitySparkline from '../components/EquitySparkline.vue';
import EquityCurveChart from '../components/EquityCurveChart.vue';
import CalibrationChart from '../components/CalibrationChart.vue';
import ProvenanceTooltip from '../components/ProvenanceTooltip.vue';
import type { SnapshotHistoryPoint, BenchmarkPoint, CalibrationBucket } from '../stores/portfolio.store';
import {
  IonCard, IonCardContent, IonGrid, IonRow, IonCol,
  IonChip, IonList, IonItem, IonLabel, IonButton, IonNote,
} from '@ionic/vue';

const portfolio = usePortfolioStore();
const { canWrite } = useCanWrite();
const api = useApi();
const decisions = ref<Array<Record<string, unknown>>>([]);
const expandedKey = ref<string | null>(null);

onMounted(async () => {
  await Promise.all([
    portfolio.fetchAllPortfolios(),
    portfolio.fetchMyPortfolio(),
    portfolio.fetchMyPositions('open'),
    portfolio.fetchMyQueue(),
    api.get<Array<Record<string, unknown>>>('/trades/decisions').then(d => decisions.value = d).catch((err) => console.error('Failed to load trade decisions', err)),
  ]).catch((err) => console.error('Failed to load portfolio data', err));
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

function toggleKind(k: PortfolioSummary['kind']) {
  const next = new Set(activeKinds.value);
  if (next.has(k)) next.delete(k); else next.add(k);
  activeKinds.value = next;
}

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = key;
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

    <!-- Filters -->
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
      <input
        v-model="search"
        type="text"
        placeholder="Search by name…"
        data-testid="portfolio-search"
        style="padding:6px 10px;border:1px solid var(--ion-color-step-200);border-radius:4px;font-size:0.85rem;min-width:200px"
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
    </div>

    <!-- Master table -->
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid var(--ion-color-step-150)">
            <th style="padding:8px;cursor:pointer;user-select:none" @click="setSort('name')">Name{{ sortIndicator('name') }}</th>
            <th style="padding:8px;cursor:pointer;user-select:none" @click="setSort('kind')">Kind{{ sortIndicator('kind') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('current_balance')">Balance{{ sortIndicator('current_balance') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('realized_pnl')">Realized{{ sortIndicator('realized_pnl') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('unrealized_pnl')">Unrealized{{ sortIndicator('unrealized_pnl') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('win_rate')">Win Rate{{ sortIndicator('win_rate') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('total_return_pct')">Return{{ sortIndicator('total_return_pct') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('total_bailouts')">Bailouts{{ sortIndicator('total_bailouts') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('open_position_count')">Open{{ sortIndicator('open_position_count') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('sharpe_30d')" title="Sharpe ratio over 30d">Sharpe{{ sortIndicator('sharpe_30d') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('max_drawdown_30d')" title="Max drawdown over 30d">Max DD{{ sortIndicator('max_drawdown_30d') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('longest_win_streak')">Win Streak{{ sortIndicator('longest_win_streak') }}</th>
            <th style="padding:8px;text-align:right;cursor:pointer;user-select:none" @click="setSort('calibration_score')" title="Analyst calibration: needs ≥ 20 resolved analyses">Calibration{{ sortIndicator('calibration_score') }}</th>
            <th style="padding:8px">Trend</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="p in sortedPortfolios" :key="rowKey(p)">
            <tr
              style="cursor:pointer;border-bottom:1px solid var(--ion-color-step-100)"
              :style="expandedKey === rowKey(p) ? 'background:var(--ion-color-step-50)' : ''"
              @click="toggleRow(p)"
            >
              <td style="padding:8px;font-weight:500">{{ p.name }}</td>
              <td style="padding:8px">
                <ion-chip :color="kindBadgeColor(p.kind)" style="font-size:0.7rem;height:20px">{{ p.kind }}</ion-chip>
              </td>
              <td style="padding:8px;text-align:right">{{ formatCurrency(p.current_balance) }}</td>
              <td style="padding:8px;text-align:right" :style="pnlColor(p.realized_pnl)">{{ formatCurrency(p.realized_pnl) }}</td>
              <td style="padding:8px;text-align:right" :style="pnlColor(p.unrealized_pnl)">{{ formatCurrency(p.unrealized_pnl) }}</td>
              <td style="padding:8px;text-align:right">{{ p.win_rate != null ? `${p.win_rate.toFixed(0)}%` : '—' }}</td>
              <td style="padding:8px;text-align:right" :style="pnlColor(p.total_return_pct)">{{ fmtPct(p.total_return_pct) }}</td>
              <td style="padding:8px;text-align:right">{{ formatCurrency(p.total_bailouts) }}</td>
              <td style="padding:8px;text-align:right">{{ p.open_position_count }}</td>
              <td style="padding:8px;text-align:right">{{ fmtSharpe(p.sharpe_30d) }}</td>
              <td style="padding:8px;text-align:right" :style="pnlColor(p.max_drawdown_30d)">{{ fmtDrawdown(p.max_drawdown_30d) }}</td>
              <td style="padding:8px;text-align:right">{{ p.longest_win_streak ?? 0 }}</td>
              <td
                style="padding:8px;text-align:right"
                :title="p.calibration_score == null ? (p.kind === 'analyst' ? 'Needs ≥ 20 resolved analyses' : 'Not applicable for this actor type') : ''"
              >{{ fmtCalibration(p.calibration_score) }}</td>
              <td style="padding:8px">
                <EquitySparkline :snapshots="(portfolio.portfolioDetails[rowKey(p)]?.snapshots || []) as []" />
              </td>
            </tr>
            <tr v-if="expandedKey === rowKey(p)">
              <td colspan="14" style="padding:16px;background:var(--ion-color-step-50)">
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
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <ion-note v-if="sortedPortfolios.length === 0" color="primary" style="display:block;padding:12px">
      No portfolios yet.
    </ion-note>
  </div>
</template>
