<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonGrid, IonRow, IonCol,
  IonChip, IonNote, IonButton, IonIcon,
} from '@ionic/vue';
import { arrowUpOutline, arrowDownOutline, removeOutline, trendingDownOutline, trophyOutline, peopleOutline, searchOutline, walletOutline, chatbubblesOutline, statsChartOutline } from 'ionicons/icons';
import { useApi } from '../composables/useApi';
import { useCanWrite } from '../composables/useCanWrite';
import { useInstrumentsStore } from '../stores/instruments.store';
import { useDomainStore } from '../stores/domain.store';
import AnalystPredictionModal from '../components/AnalystPredictionModal.vue';
import { useAffinityStore } from '../stores/affinity.store';
import { useTournamentStore } from '../stores/tournament.store';
import { useClubStore } from '../stores/club.store';
import ContrarianAlert from '../components/ContrarianAlert.vue';
import DailyAnalystSummary from '../components/DailyAnalystSummary.vue';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import UserUsageWidget from '../components/UserUsageWidget.vue';
import StudentAccrualWidget from '../components/StudentAccrualWidget.vue';
import { pluralize } from '../utils/format';
import { useMasteryStore } from '../stores/mastery.store';

interface AnalystStance {
  prediction_id: string;
  analyst_id: string;
  analyst_name: string;
  analyst_slug: string;
  direction: string;
  confidence: number;
  rationale: string;
  key_factors: unknown;
  risks: unknown;
}

interface TradeRecommendation {
  id: string;
  run_id: string;
  instrument_id: string;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  position_percent: number;
  kelly_fraction_raw: number;
  kelly_fraction_applied: number;
  quantity: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  arbitrator_direction: string;
  arbitrator_confidence: number;
  calibration_adjusted_confidence: number;
  composite_risk_score: number | null;
  consensus_bullish_count: number;
  consensus_bearish_count: number;
  consensus_total: number;
  is_calibrating: boolean;
  rationale: string;
}

interface DashboardPrediction {
  instrument_id: string;
  symbol: string;
  name: string;
  run_id: string;
  created_at: string;
  arbitrator: { direction: string; confidence: number; rationale: string } | null;
  analysts: AnalystStance[];
  trade_recommendation: TradeRecommendation | null;
}

const instruments = useInstrumentsStore();
const domain = useDomainStore();
const affinityStore = useAffinityStore();
const { canWrite } = useCanWrite();
const router = useRouter();
const { get } = useApi();
const mastery = useMasteryStore();

const predictions = ref<DashboardPrediction[]>([]);
const loading = ref(true);

// Modal state
const modalOpen = ref(false);
const modalSymbol = ref('');
const modalName = ref('');
const modalAnalysts = ref<AnalystStance[]>([]);
const modalInitialIndex = ref(0);
const modalMode = ref<'view' | 'trade'>('view');
const modalInstrumentId = ref('');
const modalCurrentPrice = ref<number | null>(null);
const modalAssetType = ref<string>('stock');
const modalPreferredDirection = ref<'long' | 'short' | null>(null);

function lookupAssetType(instrumentId: string): string {
  const match = instruments.items.find(i => (i as Record<string, unknown>).id === instrumentId) as Record<string, unknown> | undefined;
  const at = match?.asset_type;
  return typeof at === 'string' && at.length > 0 ? at : 'stock';
}

function openAnalystModal(pred: DashboardPrediction, analystIndex: number) {
  modalSymbol.value = pred.symbol;
  modalName.value = pred.name;
  modalAnalysts.value = pred.analysts;
  modalInitialIndex.value = analystIndex;
  modalMode.value = 'view';
  modalInstrumentId.value = pred.instrument_id;
  modalCurrentPrice.value = pred.trade_recommendation?.entry_price ?? null;
  modalAssetType.value = lookupAssetType(pred.instrument_id);
  modalPreferredDirection.value = null;
  modalOpen.value = true;
}

function openTradeModal(pred: DashboardPrediction) {
  if (pred.analysts.length === 0) return;
  const preferredDirection = pred.trade_recommendation?.action === 'sell'
    ? 'short'
    : pred.trade_recommendation?.action === 'buy'
      ? 'long'
      : null;
  const preferredIndex = preferredDirection
    ? pred.analysts.findIndex(a => preferredDirection === 'short' ? a.direction === 'down' : a.direction === 'up')
    : 0;
  modalSymbol.value = pred.symbol;
  modalName.value = pred.name;
  modalAnalysts.value = pred.analysts;
  modalInitialIndex.value = preferredIndex >= 0 ? preferredIndex : 0;
  modalMode.value = 'trade';
  modalInstrumentId.value = pred.instrument_id;
  modalCurrentPrice.value = pred.trade_recommendation?.entry_price ?? null;
  modalAssetType.value = lookupAssetType(pred.instrument_id);
  modalPreferredDirection.value = preferredDirection;
  modalOpen.value = true;
}

function openInstrumentDetail(instrumentId: string) {
  router.push(`/instruments/${instrumentId}`);
}

const tournamentStore = useTournamentStore();
const clubStore = useClubStore();
const showCommunitySurfaces = computed(() => mastery.canViewLevel('competitive_participation'));
const showBuilderSurfaces = computed(() => mastery.canViewLevel('builder'));

onMounted(async () => {
  await instruments.fetch().catch(() => {});
  affinityStore.fetchAffinityProfile().catch(() => {});
  tournamentStore.fetchMyEntries().catch(() => {});
  clubStore.fetchMyClubs().catch(() => {});
  try {
    predictions.value = await get<DashboardPrediction[]>('/predictions/dashboard');
  } catch { /* empty */ }
  loading.value = false;
  // Force Ionic card-content to fill card height for equal-height layout
  await nextTick();
  document.querySelectorAll<HTMLElement>('.prediction-card ion-card-content').forEach(el => {
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.flex = '1';
  });
});

/** Sort analysts by affinity (highest first) when affinity data is available. */
function sortedAnalysts(analysts: AnalystStance[]): AnalystStance[] {
  return affinityStore.sortByAffinity(analysts);
}

/** Affinity-sorted analysts, excluding flat stances (for the compact chip row). */
function nonFlatAnalysts(analysts: AnalystStance[]): AnalystStance[] {
  return sortedAnalysts(analysts).filter((a) => a.direction !== 'flat');
}

/** Get affinity score for an analyst (0-100 display). Returns null if no data. */
function affinityBadge(analystId: string): string | null {
  const entry = affinityStore.affinityMap.get(analystId);
  if (!entry || entry.signal_count < 5) return null;
  return (entry.affinity_score * 100).toFixed(0);
}

function directionColor(dir: string): string {
  if (dir === 'up') return 'success';
  if (dir === 'down') return 'danger';
  return 'medium';
}

function directionIcon(dir: string) {
  if (dir === 'up') return arrowUpOutline;
  if (dir === 'down') return trendingDownOutline;
  return removeOutline;
}

function directionLabel(dir: string): string {
  if (dir === 'up') return 'Bullish';
  if (dir === 'down') return 'Bearish';
  return 'Neutral';
}

function shortName(name: string): string {
  // "Technical Tina — Technical Analyst" → "Technical Tina" (legacy format)
  // "Technical Analyst" → "Technical Analyst" (new format)
  const dashIdx = name.indexOf('—');
  return dashIdx > 0 ? name.slice(0, dashIdx).trim() : name;
}

function actionColor(action: string): string {
  if (action === 'buy') return 'success';
  if (action === 'sell') return 'danger';
  return 'medium';
}

function actionLabel(action: string): string {
  if (action === 'buy') return 'BUY';
  if (action === 'sell') return 'SELL';
  return 'HOLD';
}

function formatPrice(n: number | null): string {
  if (n == null || isNaN(n)) return '—';
  return `$${n.toFixed(2)}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatStartShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
</script>

<template>
  <div>
    <h1>{{ domain.dashboardLayout?.title ?? 'Dashboard' }}</h1>
    <ion-note>{{ domain.activeDomain }} / {{ domain.activeUniverse }}</ion-note>

    <UserUsageWidget />
    <StudentAccrualWidget />

    <!-- Pathway Cards -->
    <div class="pathway-grid">
      <div class="pathway-card" @click="router.push('/predictions')">
        <ion-icon :icon="statsChartOutline" class="pathway-icon" />
        <div class="pathway-label">Analyses</div>
        <div class="pathway-desc">Instruments, signal &amp; risk</div>
      </div>
      <div
        v-if="showCommunitySurfaces"
        class="pathway-card"
        @click="router.push('/tournaments')"
      >
        <ion-icon :icon="trophyOutline" class="pathway-icon" />
        <div class="pathway-label">Tournaments</div>
        <div class="pathway-desc">Compete with other traders</div>
      </div>
      <div
        v-if="showCommunitySurfaces"
        class="pathway-card"
        @click="router.push('/clubs')"
      >
        <ion-icon :icon="peopleOutline" class="pathway-icon" />
        <div class="pathway-label">Clubs</div>
        <div class="pathway-desc">Your groups &amp; social</div>
      </div>
      <div
        v-if="showBuilderSurfaces"
        class="pathway-card"
        @click="router.push('/instruments')"
      >
        <ion-icon :icon="searchOutline" class="pathway-icon" />
        <div class="pathway-label">Research</div>
        <div class="pathway-desc">Tickers &amp; analysis</div>
      </div>
      <div class="pathway-card" @click="router.push('/portfolios')">
        <ion-icon :icon="walletOutline" class="pathway-icon" />
        <div class="pathway-label">Portfolios</div>
        <div class="pathway-desc">Your trades &amp; positions</div>
      </div>
      <div class="pathway-card" @click="router.push('/chat')">
        <ion-icon :icon="chatbubblesOutline" class="pathway-icon" />
        <div class="pathway-label">Learning Panel</div>
        <div class="pathway-desc">Ask about the platform</div>
      </div>
    </div>

    <!-- Your Clubs -->
    <IonCard
      v-if="showCommunitySurfaces && clubStore.myClubs.length > 0"
      class="club-dashboard-card"
      data-tour="dashboard-club-card"
    >
      <IonCardHeader>
        <IonCardTitle>Your Clubs</IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        <div v-for="club in clubStore.myClubs" :key="club.id" class="club-entry"
          @click="router.push(`/clubs/${club.id}`)" role="link" tabindex="0">
          <strong>{{ club.name }}</strong>
          <span class="entry-sep"> · </span>
          <IonNote>{{ pluralize(club.member_count, 'member') }}</IonNote>
        </div>
      </IonCardContent>
    </IonCard>

    <!-- Your Tournaments -->
    <IonCard
      v-if="showCommunitySurfaces && tournamentStore.myEntries.length > 0"
      class="tournament-dashboard-card"
    >
      <IonCardHeader>
        <IonCardTitle>Your Tournaments</IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        <div v-for="entry in tournamentStore.myEntries" :key="entry.id" class="tournament-entry"
          @click="router.push(`/tournaments/${entry.tournament_id}`)" role="link" tabindex="0">
          <strong>{{ entry.tournament_name }}</strong>
          <IonChip size="small" :color="entry.tournament_status === 'active' ? 'success' : 'warning'">
            {{ entry.tournament_status }}<template v-if="entry.tournament_status === 'upcoming' && entry.tournament_starts_at"> • Starts {{ formatStartShort(entry.tournament_starts_at) }}</template>
          </IonChip>
        </div>
      </IonCardContent>
    </IonCard>

    <!-- Daily Analyst Summary (most visible when markets are closed) -->
    <DailyAnalystSummary />

    <!-- Contrarian Alerts -->
    <ContrarianAlert />

    <!-- Summary Stats -->
    <ion-grid>
      <ion-row>
        <ion-col size="6" size-md="3">
          <ion-card>
            <ion-card-content class="ion-text-center">
              <div class="stat-value">{{ instruments.items.length }}</div>
              <ion-note>Tickers</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="6" size-md="3">
          <ion-card>
            <ion-card-content class="ion-text-center">
              <div class="stat-value">{{ predictions.length }}</div>
              <ion-note>Active Analyses</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="6" size-md="3">
          <ion-card>
            <ion-card-content class="ion-text-center">
              <div class="stat-value">{{ predictions.filter(p => p.analysts.length > 0).length }}</div>
              <ion-note>Multi-Analyst</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="6" size-md="3">
          <ion-card>
            <ion-card-content class="ion-text-center">
              <div class="stat-value">{{ predictions.reduce((sum, p) => sum + p.analysts.length, 0) }}</div>
              <ion-note>Analyst Stances</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <!-- Prediction Cards -->
    <h2 style="margin-top:24px">Latest Analyses</h2>

    <div v-if="loading" style="text-align:center;padding:40px;color:#999">Loading analyses...</div>
    <div v-else-if="predictions.length === 0" style="text-align:center;padding:40px;color:#999">
      No analyses yet. The pipeline will generate them as articles are scored.
    </div>

    <ion-grid v-else>
      <ion-row>
        <ion-col v-for="pred in predictions" :key="pred.instrument_id" size="12" size-md="6" size-lg="4" style="display:flex">
          <ion-card class="prediction-card" data-tour="dashboard-prediction-card" style="display:flex;flex-direction:column;height:100%" button @click="router.push(`/instruments/${pred.instrument_id}`)">
            <ion-card-header>
              <div class="prediction-header">
                <div>
                  <ion-card-title>{{ pred.symbol }}</ion-card-title>
                  <ion-note>{{ pred.name }}</ion-note>
                </div>
                <div v-if="pred.arbitrator" class="consensus-badge" :class="pred.arbitrator.direction">
                  <ion-icon :icon="directionIcon(pred.arbitrator.direction)" />
                  <span>{{ directionLabel(pred.arbitrator.direction) }}</span>
                  <span class="confidence">{{ pred.arbitrator.confidence }}%</span>
                </div>
                <div v-else-if="pred.analysts.length > 0" class="consensus-badge" :class="pred.analysts[0].direction">
                  <ion-icon :icon="directionIcon(pred.analysts[0].direction)" />
                  <span>{{ directionLabel(pred.analysts[0].direction) }}</span>
                  <span class="confidence">{{ pred.analysts[0].confidence }}%</span>
                </div>
              </div>
            </ion-card-header>

            <ion-card-content style="display:flex;flex-direction:column;flex:1">
              <!-- Compact analyst stance chips (top 3 non-flat + "+N more") -->
              <div v-if="pred.analysts.length > 0" class="stance-chip-row">
                <template v-for="a in nonFlatAnalysts(pred.analysts).slice(0, 3)" :key="a.analyst_id">
                  <ion-chip
                    :color="directionColor(a.direction)"
                    class="stance-chip clickable"
                    @click.stop="openAnalystModal(pred, pred.analysts.indexOf(a))"
                  >
                    <ion-icon :icon="directionIcon(a.direction)" style="font-size:0.7rem" />
                    <span class="stance-chip-name">{{ shortName(a.analyst_name) }}</span>
                    <span class="stance-chip-conf">{{ a.confidence }}%</span>
                  </ion-chip>
                </template>
                <ion-chip
                  v-if="nonFlatAnalysts(pred.analysts).length > 3"
                  class="stance-chip more-chip clickable"
                  @click.stop="openAnalystModal(pred, 0)"
                >+{{ nonFlatAnalysts(pred.analysts).length - 3 }} more</ion-chip>
                <span
                  v-if="nonFlatAnalysts(pred.analysts).length === 0"
                  class="stance-neutral"
                >All analysts neutral</span>
              </div>
              <div v-else class="stance-neutral">Single analyst analysis</div>

              <!-- Bottom section: rationale + one-line trade rec + footer -->
              <div class="card-bottom-section" style="margin-top:auto">

              <!-- Rationale preview with inline Read more -->
              <div v-if="pred.arbitrator?.rationale" class="rationale-preview">
                {{ pred.arbitrator.rationale.slice(0, 120) }}{{ pred.arbitrator.rationale.length > 120 ? '… ' : '' }}
                <a
                  v-if="pred.arbitrator.rationale.length > 120"
                  class="read-more"
                  data-test="dashboard-card-read-more"
                  @click.stop="openAnalystModal(pred, 0)"
                >Read more</a>
              </div>

              <!-- One-line trade signal -->
              <div v-if="pred.trade_recommendation" class="trade-line">
                <ion-chip
                  :color="actionColor(pred.trade_recommendation.action)"
                  class="trade-action-chip"
                >{{ actionLabel(pred.trade_recommendation.action) }}</ion-chip>
                <span
                  v-if="pred.trade_recommendation.is_calibrating"
                  class="calibrating-badge"
                  title="System is still building outcome history. Signals should be treated as provisional."
                >calibrating</span>
                <span
                  v-if="pred.trade_recommendation.action !== 'hold'"
                  class="trade-line-spec"
                >
                  {{ pred.trade_recommendation.quantity }} sh ·
                  {{ formatPrice(pred.trade_recommendation.entry_price) }} →
                  {{ formatPrice(pred.trade_recommendation.take_profit) }}
                </span>
                <span v-else class="trade-line-hold">hold</span>
              </div>

              <!-- Footer: timestamp + action CTAs -->
              <div class="card-footer">
                <ion-note>{{ timeAgo(pred.created_at) }}</ion-note>
                <div class="card-actions">
                  <ion-button
                    v-if="pred.trade_recommendation && pred.trade_recommendation.action !== 'hold'"
                    size="small"
                    color="primary"
                    data-test="dashboard-card-trade"
                    data-tour="prediction-trade-cta"
                    @click.stop="openTradeModal(pred)"
                  >Trade</ion-button>
                  <ion-button
                    size="small"
                    fill="outline"
                    color="medium"
                    data-test="dashboard-card-view"
                    @click.stop="openInstrumentDetail(pred.instrument_id)"
                  >View</ion-button>
                </div>
              </div>
              </div>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <AnalystPredictionModal
      :is-open="modalOpen"
      :symbol="modalSymbol"
      :name="modalName"
      :analysts="modalAnalysts"
      :initial-index="modalInitialIndex"
      :mode="modalMode"
      :instrument-id="modalInstrumentId"
      :current-price="modalCurrentPrice"
      :asset-type="modalAssetType"
      :preferred-direction="modalPreferredDirection"
      @close="modalOpen = false"
    />
  <FirstTouchPanel surface-key="dashboard" />
  </div>
</template>

<!-- Unscoped overrides for Ionic card flex stretching -->
<style>
.prediction-card {
  display: flex !important;
  flex-direction: column !important;
}
.prediction-card::part(native) {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
}
.prediction-card ion-card-content {
  display: flex !important;
  flex-direction: column !important;
  flex: 1 !important;
}
</style>

<style scoped>
.club-entry, .tournament-entry {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
}
.club-entry:hover, .tournament-entry:hover {
  background: var(--ion-color-light, #f4f5f8);
  border-color: var(--ion-color-light-shade);
  transform: translateY(-1px);
}
.entry-sep {
  color: var(--ion-color-medium);
  margin: 0 2px;
}
.pathway-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
  margin: 16px 0 24px;
}

@media (max-width: 900px) {
  .pathway-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 600px) {
  .pathway-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.pathway-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 20px 12px;
  background: var(--ion-color-light, #f4f5f8);
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  text-align: center;
}

.pathway-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.pathway-icon {
  font-size: 2rem;
  color: var(--ion-color-primary);
  margin-bottom: 4px;
}

.pathway-label {
  font-weight: 600;
  font-size: 1rem;
}

.pathway-desc {
  font-size: 0.75rem;
  color: var(--ion-color-medium);
}

.stat-value {
  font-size: 2rem;
  font-weight: bold;
}

.prediction-card {
  transition: transform 0.15s;
  height: 100%;
}

.prediction-card:hover {
  transform: translateY(-2px);
}

/* placeholder */

.prediction-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.consensus-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.85rem;
}

.consensus-badge.up {
  background: rgba(46, 125, 50, 0.12);
  color: #2e7d32;
}

.consensus-badge.down {
  background: rgba(211, 47, 47, 0.12);
  color: #d32f2f;
}

.consensus-badge.flat {
  background: rgba(117, 117, 117, 0.12);
  color: #757575;
}

.confidence {
  font-size: 0.75rem;
  opacity: 0.8;
}

.stance-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0 8px;
  align-items: center;
}

.stance-chip {
  height: 22px;
  font-size: 0.72rem;
  margin: 0;
}
.stance-chip.clickable { cursor: pointer; }
.stance-chip-name { font-weight: 500; }
.stance-chip-conf { opacity: 0.8; margin-left: 2px; }
.more-chip {
  background: #eef1f8;
  color: #4b5563;
  font-weight: 500;
}

.stance-neutral {
  font-size: 0.78rem;
  color: #999;
  padding: 4px 0;
  display: inline-block;
}

.card-bottom-section {
  margin-top: auto;
}

.rationale-preview {
  font-size: 0.78rem;
  color: #888;
  margin: 0 0 6px 0;
  line-height: 1.35;
  border-top: 1px solid #eee;
  padding-top: 6px;
}
.read-more {
  color: var(--ion-color-primary);
  cursor: pointer;
  font-weight: 600;
  text-decoration: underline;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #eee;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* Equal-height cards in the same row */
ion-row {
  align-items: stretch;
}

ion-col {
  display: flex;
}

@media (max-width: 375px) {
  .card-footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .prediction-header {
    flex-wrap: wrap;
    gap: 8px;
  }
}

/* Slim trade signal — single line */
.trade-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 0.75rem;
}

.trade-action-chip {
  font-weight: 700;
  letter-spacing: 0.4px;
  height: 22px;
  margin: 0;
}

.trade-line-spec {
  color: #374151;
  font-variant-numeric: tabular-nums;
}

.trade-line-hold {
  color: #6b7280;
  font-style: italic;
}

.calibrating-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffeeba;
  border-radius: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  cursor: help;
}

</style>
