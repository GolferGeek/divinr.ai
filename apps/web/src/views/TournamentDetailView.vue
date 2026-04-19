<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote, IonSegment, IonSegmentButton, IonLabel } from '@ionic/vue';
import { useTournamentStore } from '../stores/tournament.store';
import { useAuthStore } from '../stores/auth.store';
import { useCanWrite } from '../composables/useCanWrite';
import MemberProfileDrawer from '../components/MemberProfileDrawer.vue';
import RankCell from '../components/RankCell.vue';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';
import { colorClass as sharedColorClass } from '../utils/colorClass';

const store = useTournamentStore();
const auth = useAuthStore();
const { canWrite } = useCanWrite();
const drawerOpen = ref(false);
const drawerUserId = ref<string | null>(null);
const drawerClubId = computed<string | null>(() => {
  const t = store.activeTournament;
  return t && t.scope === 'club' ? t.scope_id : null;
});

function colorClass(v: number | null | undefined): string {
  if (v === 0 && isPreSprint()) return '';
  return sharedColorClass(v);
}

function openMember(userId: string) {
  if (!drawerClubId.value) return;
  drawerUserId.value = userId;
  drawerOpen.value = true;
}

function closeDrawer() {
  drawerOpen.value = false;
  drawerUserId.value = null;
}

function formatEntryTs(iso: string): string {
  const d = new Date(iso);
  return `Opened ${d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function sizePct(pos: { quantity: number; entry_price: number | null }): number {
  const tournament = store.activeTournament;
  if (!tournament || !pos.entry_price) return 0;
  const bal = Number(tournament.starting_balance);
  if (!bal) return 0;
  return (pos.quantity * Number(pos.entry_price) / bal) * 100;
}
const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string);
const tab = ref<'leaderboard' | 'positions' | 'trade' | 'info'>('leaderboard');
const tradeSymbol = ref('');
const tradeDirection = ref<'long' | 'short'>('long');
const tradeQuantity = ref(1);
const tradeError = ref('');
const predictionIdForTrade = ref<string | null>(null);
const inviteToken = ref('');
const showInvite = ref(false);

const SYMBOL_REGEX = /^[A-Z.]{1,10}$/;

function applyTradePrefillFromQuery() {
  const q = route.query;
  const hasAnyPrefill = q.symbol || q.direction || q.qty || q.predictionId;
  if (!hasAnyPrefill) return;
  if (q.tab === 'trade') tab.value = 'trade';
  const rawSymbol = typeof q.symbol === 'string' ? q.symbol.toUpperCase() : '';
  if (rawSymbol && SYMBOL_REGEX.test(rawSymbol)) tradeSymbol.value = rawSymbol;
  if (q.direction === 'long' || q.direction === 'short') tradeDirection.value = q.direction;
  const rawQty = typeof q.qty === 'string' ? parseInt(q.qty, 10) : NaN;
  if (Number.isFinite(rawQty) && rawQty > 0) tradeQuantity.value = rawQty;
  if (typeof q.predictionId === 'string' && q.predictionId.length > 0) {
    predictionIdForTrade.value = q.predictionId;
  }
  router.replace({ path: route.path });
}

onMounted(async () => {
  await store.fetchTournament(id.value);
  await store.fetchLeaderboard(id.value);
  await store.fetchPositions(id.value, 'open');
  applyTradePrefillFromQuery();
});

async function queueTrade() {
  tradeError.value = '';
  if (!tradeSymbol.value || tradeQuantity.value <= 0) return;
  const submittedSymbol = tradeSymbol.value.toUpperCase();
  const submittedDirection = tradeDirection.value;
  const submittedQuantity = tradeQuantity.value;
  const submittedPredictionId = predictionIdForTrade.value;
  try {
    await store.queueTrade(id.value, {
      symbol: submittedSymbol,
      direction: submittedDirection,
      quantity: submittedQuantity,
      ...(submittedPredictionId ? { predictionId: submittedPredictionId } : {}),
    });
    if (submittedPredictionId) {
      // observability for CTA funnel, see prediction-to-trade-intent effort
      console.info('[prediction-to-trade-intent] trade_queued', {
        predictionId: submittedPredictionId,
        tournamentId: id.value,
        symbol: submittedSymbol,
        direction: submittedDirection,
        quantity: submittedQuantity,
      });
    }
    tradeSymbol.value = '';
    tradeQuantity.value = 1;
    predictionIdForTrade.value = null;
    await store.fetchPositions(id.value, 'open');
  } catch (e: unknown) {
    tradeError.value = e instanceof Error ? e.message : String(e);
  }
}

async function closePos(positionId: string) {
  await store.closePosition(id.value, positionId);
  await store.fetchPositions(id.value, 'open');
  await store.fetchLeaderboard(id.value);
}

async function generateInvite() {
  const result = await store.createInvite(id.value) as { token: string };
  inviteToken.value = `${window.location.origin}/tournaments/invite/${result.token}`;
  showInvite.value = true;
}

function copyInvite() {
  navigator.clipboard.writeText(inviteToken.value);
}

function typeLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatStart(iso?: string | null): string {
  if (!iso) return 'the scheduled start time';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

const EM_DASH = '\u2014';
function isPreSprint(): boolean {
  return store.activeTournament?.status === 'upcoming';
}
function fmtPct(v: number | null | undefined): string {
  if (v == null) return EM_DASH;
  if (v === 0 && isPreSprint()) return EM_DASH;
  return `${v}%`;
}
function fmtMoney(v: number | null | undefined): string {
  if (v == null) return EM_DASH;
  if (v === 0 && isPreSprint()) return EM_DASH;
  return `$${Number(v).toLocaleString()}`;
}
function fmtSharpe(v: number | null | undefined): string {
  if (v == null) return EM_DASH;
  if (v === 0 && isPreSprint()) return EM_DASH;
  return String(v);
}

const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => { nowTimer = setInterval(() => { now.value = Date.now(); }, 60_000); });
onUnmounted(() => { if (nowTimer) clearInterval(nowTimer); });

const countdownText = computed(() => {
  const iso = store.activeTournament?.starts_at;
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now.value;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Starts in ${days}d ${hours}h`;
  if (hours > 0) return `Starts in ${hours}h ${minutes}m`;
  return `Starts in ${minutes}m`;
});

function formatWithZone(iso?: string | null): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}
</script>

<template>
  <div class="detail-page" v-if="store.activeTournament">
    <div class="page-header">
      <div>
        <h1>{{ store.activeTournament.name }}</h1>
        <div class="meta">
          <IonChip :color="store.activeTournament.status === 'active' ? 'success' : 'medium'">{{ store.activeTournament.status }}</IonChip>
          <IonChip color="tertiary">{{ typeLabel(store.activeTournament.tournament_type) }}</IonChip>
        </div>
      </div>
      <div class="actions">
        <IonButton v-if="store.activeTournament.scope === 'invitation'" size="small" fill="outline" @click="generateInvite">
          Share Invite Link
        </IonButton>
        <IonButton v-if="store.activeTournament.status === 'completed'" size="small" @click="router.push(`/tournaments/${id}/results`)">
          View Results
        </IonButton>
        <IonButton v-if="store.activeTournament.channel_id" size="small" fill="outline"
          @click="router.push(`/messages/${store.activeTournament.channel_id}`)">
          Chat
        </IonButton>
      </div>
    </div>

    <div v-if="showInvite" class="invite-box">
      <input :value="inviteToken" readonly class="invite-input" />
      <IonButton size="small" @click="copyInvite">Copy</IonButton>
    </div>

    <LegalDisclaimer variant="tournament" />

    <IonSegment class="tournament-tabs" scrollable :value="tab" @ionChange="(e: CustomEvent) => (tab = e.detail.value)">
      <IonSegmentButton value="leaderboard"><IonLabel>Leaderboard</IonLabel></IonSegmentButton>
      <IonSegmentButton value="positions"><IonLabel>My Positions</IonLabel></IonSegmentButton>
      <IonSegmentButton value="trade"><IonLabel>Trade</IonLabel></IonSegmentButton>
      <IonSegmentButton value="info"><IonLabel>Info</IonLabel></IonSegmentButton>
    </IonSegment>

    <!-- Leaderboard Tab -->
    <div v-if="tab === 'leaderboard'" class="tab-content">
      <div class="leaderboard-scroll" v-if="store.leaderboard.length > 0">
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Return %</th>
            <th>PnL</th>
            <th>Win Rate</th>
            <th title="Return per unit of volatility. Higher is better. Appears once the sprint has data.">
              Risk-Adjusted Return
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in store.leaderboard"
            :key="entry.user_id"
            :class="['leaderboard-row', entry.user_id === auth.userId ? 'is-you' : '']"
            @click="openMember(entry.user_id)"
          >
            <td><RankCell :rank="entry.rank" :delta="entry.rank_delta ?? null" /></td>
            <td>
              <span class="player-cell">
                <span class="player-name">{{ entry.display_name || 'Player' }}</span>
                <span v-if="entry.user_id === auth.userId" class="you-badge">YOU</span>
              </span>
            </td>
            <td :class="colorClass(entry.return_pct)">{{ fmtPct(entry.return_pct) }}</td>
            <td :class="colorClass(entry.total_pnl)">{{ fmtMoney(entry.total_pnl) }}</td>
            <td :class="colorClass(entry.win_rate)">{{ fmtPct(entry.win_rate) }}</td>
            <td>{{ fmtSharpe(entry.sharpe_ratio) }}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <p v-else class="empty">No players yet.</p>
    </div>

    <MemberProfileDrawer
      v-if="drawerClubId && drawerUserId"
      :open="drawerOpen"
      :club-id="drawerClubId"
      :user-id="drawerUserId"
      @close="closeDrawer"
    />

    <!-- Positions Tab -->
    <div v-if="tab === 'positions'" class="tab-content">
      <div v-if="store.positions.length === 0" class="empty">No open positions.</div>
      <IonCard v-for="pos in store.positions" :key="pos.id" class="position-card">
        <IonCardContent>
          <div class="pos-row">
            <strong class="pos-symbol">{{ pos.symbol }}</strong>
            <IonChip :color="pos.direction === 'long' ? 'success' : 'danger'">{{ pos.direction }}</IonChip>
            <span>Qty: {{ pos.quantity }}</span>
            <span>Entry: ${{ pos.entry_price }}</span>
            <span v-if="pos.current_price != null">Now: ${{ Number(pos.current_price).toFixed(2) }}</span>
            <span :class="pos.unrealized_pnl >= 0 ? 'positive' : 'negative'">
              PnL: ${{ Number(pos.unrealized_pnl).toFixed(2) }}
            </span>
            <IonNote v-if="pos.opened_at" class="pos-ts">{{ formatEntryTs(pos.opened_at) }}</IonNote>
            <IonButton v-if="canWrite" size="small" fill="outline" color="danger" @click="closePos(pos.id)">Close</IonButton>
          </div>
          <div class="pos-size-bar" :title="`Allocation: ${sizePct(pos).toFixed(1)}% of virtual balance`">
            <div class="pos-size-fill" :style="{ width: `${Math.min(sizePct(pos), 100)}%` }"></div>
          </div>
        </IonCardContent>
      </IonCard>
    </div>

    <!-- Trade Tab -->
    <div v-if="tab === 'trade'" class="tab-content">
      <IonCard v-if="canWrite && store.activeTournament.status === 'active'">
        <IonCardHeader><IonCardTitle>Queue Trade</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div v-if="tradeError" style="color:var(--ion-color-danger);font-size:0.85rem;margin-bottom:8px;padding:8px;background:var(--ion-color-danger-tint);border-radius:4px">{{ tradeError }}</div>
          <div class="trade-form">
            <input v-model="tradeSymbol" placeholder="Symbol (e.g. AAPL)" class="trade-input" />
            <select v-model="tradeDirection" class="trade-input">
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            <input v-model.number="tradeQuantity" type="number" min="1" placeholder="Quantity" class="trade-input" />
            <IonButton @click="queueTrade">Queue Trade</IonButton>
          </div>
          <div style="margin-top:12px">
            <LegalDisclaimer variant="tournament" />
          </div>
        </IonCardContent>
      </IonCard>
      <p v-else-if="!canWrite" class="empty">Read-only access — trading is not available.</p>
      <div v-else-if="store.activeTournament.status === 'upcoming'" class="empty upcoming-block">
        <p>
          Trading opens when the sprint starts on {{ formatStart(store.activeTournament.starts_at) }}.
          <span v-if="countdownText" class="countdown-inline">· {{ countdownText }}</span>
        </p>
        <p class="what-now-label">What can I do now?</p>
        <ul class="what-now-list">
          <li>Run analyses on your watchlist</li>
          <li>Review your club's analysts</li>
          <li>Check the leaderboard to see who else is playing</li>
        </ul>
      </div>
      <p v-else-if="store.activeTournament.status === 'completed'" class="empty">
        This sprint is closed. See final standings in Leaderboard.
      </p>
      <p v-else class="empty">Trades can only be queued during active games.</p>
    </div>

    <!-- Info Tab -->
    <div v-if="tab === 'info'" class="tab-content">
      <IonCard>
        <IonCardContent>
          <p v-if="store.activeTournament.description">{{ store.activeTournament.description }}</p>
          <div class="info-grid">
            <div><strong>Virtual Balance:</strong> ${{ Number(store.activeTournament.starting_balance).toLocaleString() }}</div>
            <div><strong>Type:</strong> {{ typeLabel(store.activeTournament.tournament_type) }}</div>
            <div>
              <strong>Scope:</strong>
              <a
                v-if="store.activeTournament.scope === 'club' && store.activeTournament.scope_id"
                class="scope-link"
                @click.prevent="router.push(`/clubs/${store.activeTournament.scope_id}`)"
                href="#"
              >{{ store.activeTournament.scope }}</a>
              <span v-else>{{ store.activeTournament.scope }}</span>
            </div>
            <div><strong>Start:</strong> {{ formatWithZone(store.activeTournament.starts_at) }}</div>
            <div><strong>End:</strong> {{ formatWithZone(store.activeTournament.ends_at) }}</div>
            <div><strong>Prize:</strong> Bragging rights + Sprint Champion badge on your profile.</div>
          </div>
        </IonCardContent>
      </IonCard>
    </div>
  </div>
</template>

<style scoped>
.detail-page { padding: 1rem; max-width: 900px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.page-header h1 { margin: 0; font-size: 1.4rem; }
.meta { display: flex; gap: 0.25rem; margin-top: 0.25rem; }
.actions { display: flex; gap: 0.5rem; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.tab-content { margin-top: 1rem; }
.leaderboard-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.leaderboard-table th, .leaderboard-table td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--ion-color-light-shade); }
.positive { color: var(--ion-color-success); }
.negative { color: var(--ion-color-danger); }
.neutral { color: var(--ion-color-medium); }
.leaderboard-row { cursor: pointer; }
.leaderboard-row:hover { background: var(--ion-color-light-tint); }
.leaderboard-row.is-you { background: rgba(88, 86, 214, 0.08); }
.leaderboard-row.is-you:hover { background: rgba(88, 86, 214, 0.14); }
.player-cell { display: inline-flex; align-items: center; gap: 0.4rem; }
.you-badge {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(88, 86, 214, 0.18);
  color: var(--ion-color-primary);
}
.empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
.pos-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.trade-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.trade-input { padding: 0.5rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem; }
.invite-box { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.invite-input { flex: 1; padding: 0.5rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; font-size: 0.85rem; }
.position-card { margin-bottom: 0.5rem; }
.pos-symbol { font-size: 1rem; }
.pos-ts { font-size: 0.75rem; color: var(--ion-color-medium); margin-left: auto; }
.pos-size-bar {
  width: 100%;
  height: 6px;
  margin-top: 0.6rem;
  background: var(--ion-color-light);
  border-radius: 3px;
  overflow: hidden;
}
.pos-size-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ion-color-primary) 0%, var(--ion-color-tertiary) 100%);
  transition: width 0.2s ease;
}
.upcoming-block { text-align: left; padding: 1.5rem 1rem; }
.upcoming-block p { margin: 0 0 0.5rem; }
.countdown-inline { color: var(--ion-color-primary); font-weight: 600; }
.what-now-label { font-weight: 600; color: var(--ion-text-color); margin-top: 0.75rem; }
.what-now-list { margin: 0.25rem 0 0 1.25rem; padding: 0; }
.what-now-list li { margin-bottom: 0.25rem; }
.scope-link { color: var(--ion-color-primary); text-decoration: underline; cursor: pointer; margin-left: 0.25rem; }
.leaderboard-scroll { width: 100%; }

@media (max-width: 600px) {
  .leaderboard-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .leaderboard-table { min-width: 560px; }
  .leaderboard-table th:nth-child(1),
  .leaderboard-table td:nth-child(1) {
    position: sticky;
    left: 0;
    background: var(--ion-background-color, #fff);
    z-index: 2;
    max-width: 48px;
    overflow: hidden;
    white-space: nowrap;
    padding-left: 0.25rem;
    padding-right: 0.25rem;
  }
  .leaderboard-table th:nth-child(2),
  .leaderboard-table td:nth-child(2) {
    position: sticky;
    left: 48px;
    background: var(--ion-background-color, #fff);
    z-index: 1;
  }
  .leaderboard-row.is-you td:nth-child(1),
  .leaderboard-row.is-you td:nth-child(2) {
    background: rgba(88, 86, 214, 0.08);
  }
  .leaderboard-row:hover td:nth-child(1),
  .leaderboard-row:hover td:nth-child(2) {
    background: var(--ion-color-light-tint);
  }
  .leaderboard-row.is-you:hover td:nth-child(1),
  .leaderboard-row.is-you:hover td:nth-child(2) {
    background: rgba(88, 86, 214, 0.14);
  }
  .pos-row { gap: 0.5rem; font-size: 0.85rem; }
  .pos-ts { margin-left: 0; width: 100%; }
}
</style>
