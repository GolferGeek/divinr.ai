<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { usePortfolioStore, type PortfolioSummary } from '../stores/portfolio.store';
import { useApi } from '../composables/useApi';
import EquitySparkline from '../components/EquitySparkline.vue';
import ProvenanceTooltip from '../components/ProvenanceTooltip.vue';
import {
  IonCard, IonCardContent, IonGrid, IonRow, IonCol,
  IonChip, IonList, IonItem, IonLabel, IonButton, IonNote,
} from '@ionic/vue';

const portfolio = usePortfolioStore();
const api = useApi();
const decisions = ref<Array<Record<string, unknown>>>([]);
const expandedKey = ref<string | null>(null);

onMounted(async () => {
  await Promise.all([
    portfolio.fetchAllPortfolios(),
    portfolio.fetchMyPortfolio(),
    portfolio.fetchMyPositions('open'),
    portfolio.fetchMyQueue(),
    api.get<Array<Record<string, unknown>>>('/trades/decisions').then(d => decisions.value = d).catch(() => {}),
  ]).catch(() => {});
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

const sortedPortfolios = computed(() => {
  // user first, then highest total_return_pct
  return [...portfolio.allPortfolios].sort((a, b) => {
    if (a.kind === 'user' && b.kind !== 'user') return -1;
    if (b.kind === 'user' && a.kind !== 'user') return 1;
    return Number(b.total_return_pct) - Number(a.total_return_pct);
  });
});

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

    <!-- Master table -->
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid var(--ion-color-step-150)">
            <th style="padding:8px">Name</th>
            <th style="padding:8px">Kind</th>
            <th style="padding:8px;text-align:right">Balance</th>
            <th style="padding:8px;text-align:right">Realized</th>
            <th style="padding:8px;text-align:right">Unrealized</th>
            <th style="padding:8px;text-align:right">Win Rate</th>
            <th style="padding:8px;text-align:right">Return</th>
            <th style="padding:8px;text-align:right">Bailouts</th>
            <th style="padding:8px;text-align:right">Open</th>
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
              <td style="padding:8px">
                <EquitySparkline :snapshots="(portfolio.portfolioDetails[rowKey(p)]?.snapshots || []) as []" />
              </td>
            </tr>
            <tr v-if="expandedKey === rowKey(p)">
              <td colspan="10" style="padding:16px;background:var(--ion-color-step-50)">
                <div v-if="!portfolio.portfolioDetails[rowKey(p)]" style="opacity:0.6">Loading…</div>
                <div v-else>
                  <h3 style="margin:0 0 8px 0">Positions</h3>
                  <ion-list v-if="(portfolio.portfolioDetails[rowKey(p)]?.positions || []).length > 0">
                    <ion-item v-for="pos in portfolio.portfolioDetails[rowKey(p)].positions" :key="String(pos.id)">
                      <ion-button
                        v-if="p.kind === 'user' && pos.status === 'open'"
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
                        <ion-button slot="end" fill="clear" size="small" color="danger" @click="portfolio.cancelTrade(String(t['id']))">Cancel</ion-button>
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
