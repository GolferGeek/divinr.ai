<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton,
  IonIcon, IonChip, IonNote,
} from '@ionic/vue';
import {
  closeOutline, arrowUpOutline, trendingDownOutline, removeOutline,
  chevronBackOutline, chevronForwardOutline,
} from 'ionicons/icons';
import { useApi } from '../composables/useApi';
import { useProvenanceStore } from '../stores/provenance.store';
import { usePortfolioStore } from '../stores/portfolio.store';
import { useAuthStore } from '../stores/auth.store';
import { useAffinityStore } from '../stores/affinity.store';
import { useActiveTournament, impliedQuantity } from '../composables/useActiveTournament';
import type { Tournament } from '../stores/tournament.store';
import TournamentPicker from './TournamentPicker.vue';

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

// Effort: see-your-reasoning. Local row type for the new Reasoning tab.
interface LlmCall {
  runId: string;
  provider: string;
  model: string;
  tier: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  totalCost: number | null;
  reasoningContent: string;
  reasoningTruncated: boolean;
  createdAt: string;
}

const props = withDefaults(defineProps<{
  isOpen: boolean;
  symbol: string;
  name: string;
  analysts: AnalystStance[];
  initialIndex: number;
  mode?: 'view' | 'trade';
  instrumentId?: string;
  currentPrice?: number | null;
  assetType?: string;
}>(), { mode: 'view', instrumentId: '', currentPrice: null, assetType: 'stock' });

const emit = defineEmits<{
  close: [];
}>();

const currentIndex = ref(props.initialIndex);

// Reset index when modal opens with new data
watch(() => [props.isOpen, props.initialIndex], ([open]) => {
  if (open) currentIndex.value = props.initialIndex;
});

// ─── Browse Signal Tracking ──────────────────────────────────
const affinityStore = useAffinityStore();
const browseTimerRef = ref<ReturnType<typeof setTimeout> | null>(null);
const lastBrowseSignal = new Map<string, number>();

function startBrowseTimer(analystId: string) {
  clearBrowseTimer();
  if (!analystId) return;
  const lastSent = lastBrowseSignal.get(analystId) ?? 0;
  if (Date.now() - lastSent < 5 * 60 * 1000) return; // debounce: 5 min per analyst
  browseTimerRef.value = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      affinityStore.recordBrowseSignal(analystId);
      lastBrowseSignal.set(analystId, Date.now());
    }
  }, 10_000); // 10 seconds
}

function clearBrowseTimer() {
  if (browseTimerRef.value) {
    clearTimeout(browseTimerRef.value);
    browseTimerRef.value = null;
  }
}

onUnmounted(() => clearBrowseTimer());

const analyst = computed(() => props.analysts[currentIndex.value] ?? props.analysts[0]);

// Start/stop timer when modal opens/closes or analyst changes
watch(() => [props.isOpen, analyst.value?.analyst_id], ([open, aId]) => {
  if (open && aId) startBrowseTimer(aId as string);
  else clearBrowseTimer();
});
const hasPrev = computed(() => currentIndex.value > 0);
const hasNext = computed(() => currentIndex.value < props.analysts.length - 1);

function prev() {
  if (hasPrev.value) currentIndex.value--;
}
function next() {
  if (hasNext.value) currentIndex.value++;
}
function goTo(i: number) {
  currentIndex.value = i;
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

function formatFactors(factors: unknown): string[] {
  if (Array.isArray(factors)) return factors.map(String).filter(Boolean);
  return [];
}

// ─── Provenance ──────────────────────────────────────────────
const provenance = useProvenanceStore();
const activeTab = ref<'analysis' | 'evidence' | 'risk' | 'memory' | 'challenge' | 'reasoning'>('analysis');
const challenges = ref<Array<Record<string, unknown>>>([]);
const challengeLoading = ref(false);
const challengeThinking = ref<string | null>(null);

// ─── Reasoning (effort: see-your-reasoning) ───────────────────
const llmCalls = ref<LlmCall[]>([]);
const llmCallsLoading = ref(false);
const llmCallsError = ref<string | null>(null);

watch(() => [props.isOpen, currentIndex.value], ([open]) => {
  if (open && analyst.value?.prediction_id) {
    provenance.fetchProvenance(analyst.value.prediction_id);
    // Synchronously set loading=true before the async call so the Reasoning
    // tab's disabled state stays consistent through the fetch round-trip
    // (otherwise it would briefly render as "no reasoning yet → disabled"
    // before the fetch completes and flips it).
    llmCallsLoading.value = true;
    llmCalls.value = [];
    llmCallsError.value = null;
    void loadLlmCalls(analyst.value.prediction_id);
  }
  activeTab.value = 'analysis';
  tradeResult.value = null;
  tradeError.value = '';
});

async function loadLlmCalls(predictionId: string) {
  try {
    const res = await api.get<{ predictionId: string; calls: LlmCall[] }>(
      `/predictions/${predictionId}/llm-calls`,
    );
    llmCalls.value = res.calls;
  } catch (err) {
    llmCallsError.value = err instanceof Error ? err.message : String(err);
  } finally {
    llmCallsLoading.value = false;
  }
}

// ─── Trade Actions ───────────────────────────────────────────
const api = useApi();
const portfolioStore = usePortfolioStore();
const showDisclaimer = ref(false);
const tradeResult = ref<Record<string, unknown> | null>(null);
const tradeError = ref('');
const disclaimerAcknowledged = ref(false);

// Trade-mode form state
const tradeQty = ref(10);
const tradeDirection = ref<'long' | 'short'>('long');
const tradeSubmitting = ref(false);

watch(() => [props.isOpen, currentIndex.value], () => {
  // Default direction from current analyst stance when opening trade form
  const a = analyst.value;
  if (a) tradeDirection.value = a.direction === 'down' ? 'short' : 'long';
});

const tradeTotalCost = computed(() => {
  const p = Number(props.currentPrice ?? 0);
  return p * Math.max(0, Number(tradeQty.value || 0));
});

async function submitImmediateTrade() {
  tradeError.value = '';
  tradeResult.value = null;
  const a = analyst.value;
  if (!a) return;
  if (!props.instrumentId) {
    tradeError.value = 'Missing instrument context';
    return;
  }
  if (!tradeQty.value || tradeQty.value <= 0) {
    tradeError.value = 'Quantity must be > 0';
    return;
  }
  tradeSubmitting.value = true;
  try {
    const result = await portfolioStore.executeTrade({
      predictionId: a.prediction_id,
      instrumentId: props.instrumentId,
      direction: tradeDirection.value,
      quantity: Number(tradeQty.value),
    });
    if ((result as { requiresDisclaimer?: boolean }).requiresDisclaimer) {
      showDisclaimer.value = true;
      return;
    }
    if ((result as { error?: string }).error) {
      tradeError.value = String((result as { error: string }).error);
      return;
    }
    tradeResult.value = result;
  } catch (err) {
    tradeError.value = err instanceof Error ? err.message : String(err);
  } finally {
    tradeSubmitting.value = false;
  }
}

async function takeTrade() {
  tradeError.value = '';
  tradeResult.value = null;
  const a = analyst.value;
  if (!a) return;

  try {
    const direction = a.direction === 'down' ? 'short' : 'long';
    const result = await api.post<Record<string, unknown>>('/trades/confirm', {
      predictionId: a.prediction_id,
      analystId: a.analyst_id,
      direction,
    });

    if (result.requiresDisclaimer) {
      showDisclaimer.value = true;
      return;
    }

    if (result.error) {
      tradeError.value = String(result.error);
      return;
    }

    tradeResult.value = result;
  } catch (err) {
    tradeError.value = err instanceof Error ? err.message : String(err);
  }
}

async function skipTrade() {
  const a = analyst.value;
  if (!a) return;
  try {
    await api.post('/trades/skip', {
      predictionId: a.prediction_id,
    });
    tradeResult.value = { skipped: true };
  } catch { /* silent */ }
}

// ─── Trade This Prediction (tournament CTA) ──────────────────
const router = useRouter();
const { resolveActiveTournaments } = useActiveTournament();
const pickerOpen = ref(false);
const pickerTournaments = ref<Tournament[]>([]);
const pendingPickerResolve = ref<((id: string | null) => void) | null>(null);
const ctaBusy = ref(false);

// DB canonical is 'stock'; 'equity' accepted as synonym for forward-compat
const isEquity = computed(() => {
  const at = props.assetType ?? 'stock';
  return at === 'stock' || at === 'equity';
});

function onPickerSelect(tournamentId: string) {
  pickerOpen.value = false;
  pendingPickerResolve.value?.(tournamentId);
  pendingPickerResolve.value = null;
}

function onPickerDismiss() {
  pickerOpen.value = false;
  pendingPickerResolve.value?.(null);
  pendingPickerResolve.value = null;
}

// Avoid stuck ctaBusy if the outer modal closes while the picker is awaiting a choice
watch(() => props.isOpen, open => {
  if (!open && pendingPickerResolve.value) {
    pendingPickerResolve.value(null);
    pendingPickerResolve.value = null;
    pickerOpen.value = false;
    ctaBusy.value = false;
  }
});

async function handleTradeThisPrediction() {
  const a = analyst.value;
  if (!a) return;
  if (!isEquity.value) return;
  if (ctaBusy.value) return;
  ctaBusy.value = true;
  try {
    const { state, tournaments } = await resolveActiveTournaments();
    if (state === 'none') {
      router.push({ path: '/tournaments', query: { reason: 'no-active-entry' } });
      emit('close');
      return;
    }
    let target: Tournament;
    if (state === 'one') {
      target = tournaments[0];
    } else {
      pickerTournaments.value = tournaments;
      pickerOpen.value = true;
      const pickedId = await new Promise<string | null>(resolve => {
        pendingPickerResolve.value = resolve;
      });
      if (!pickedId) return;
      const found = tournaments.find(t => t.id === pickedId);
      if (!found) return;
      target = found;
    }
    const qty = impliedQuantity(target.starting_balance, a.confidence, props.currentPrice);
    const direction = a.direction === 'down' ? 'short' : 'long';
    router.push({
      path: `/tournaments/${target.id}`,
      query: {
        tab: 'trade',
        symbol: props.symbol,
        direction,
        qty: String(qty),
        predictionId: a.prediction_id,
      },
    });
    // observability for CTA funnel, see prediction-to-trade-intent effort
    console.info('[prediction-to-trade-intent] cta_navigated', {
      state,
      predictionId: a.prediction_id,
      symbol: props.symbol,
      direction,
      impliedQty: qty,
    });
    emit('close');
  } finally {
    ctaBusy.value = false;
  }
}

async function acknowledgeDisclaimer() {
  try {
    await api.post('/trades/acknowledge-disclaimer', {});
    disclaimerAcknowledged.value = true;
    showDisclaimer.value = false;
    // Retry the appropriate trade flow now that disclaimer is acknowledged
    if (props.mode === 'trade') {
      await submitImmediateTrade();
    } else {
      await takeTrade();
    }
  } catch {
    showDisclaimer.value = false;
  }
}

async function loadChallenges() {
  const a = analyst.value;
  if (!a) return;
  // Check for existing challenges first
  try {
    const existing = await api.get<Array<Record<string, unknown>>>(`/predictions/${a.prediction_id}/challenges`);
    if (existing.length > 0) {
      challenges.value = existing;
      return;
    }
  } catch { /* no existing */ }

  // Stream challenges via SSE — each analyst result appears as it completes
  challengeLoading.value = true;
  challenges.value = [];
  try {
    const authStore = useAuthStore();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authStore.token) headers['Authorization'] = `Bearer ${authStore.token}`;
    const res = await fetch(`/api/markets/predictions/${a.prediction_id}/challenge`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (reader) {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done || data.error) { challengeThinking.value = null; continue; }
              if (data.thinking) { challengeThinking.value = `${data.analyst} is analyzing... (${data.index + 1}/${data.total})`; continue; }
              challengeThinking.value = null;
              challenges.value = [...challenges.value, data];
            } catch { /* skip malformed */ }
          }
        }
      }
    }
  } catch { /* silent */ }
  challengeThinking.value = null;
  challengeLoading.value = false;
}
</script>

<template>
  <ion-modal :is-open="isOpen" @didDismiss="emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ symbol }} — Analyst View</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="emit('close')">
            <ion-icon :icon="closeOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div v-if="analyst" class="modal-body">
        <!-- Analyst Tabs -->
        <div class="analyst-tabs">
          <button
            v-for="(a, i) in analysts"
            :key="a.analyst_id"
            class="analyst-tab"
            :class="{ active: i === currentIndex, up: a.direction === 'up', down: a.direction === 'down' }"
            @click="goTo(i)"
          >
            {{ a.analyst_name }}
          </button>
        </div>

        <!-- Navigation -->
        <div class="nav-row">
          <ion-button fill="clear" size="small" :disabled="!hasPrev" @click="prev">
            <ion-icon :icon="chevronBackOutline" />
          </ion-button>
          <span class="nav-counter">{{ currentIndex + 1 }} of {{ analysts.length }}</span>
          <ion-button fill="clear" size="small" :disabled="!hasNext" @click="next">
            <ion-icon :icon="chevronForwardOutline" />
          </ion-button>
        </div>

        <!-- Analyst Detail -->
        <div class="analyst-detail">
          <div class="detail-header">
            <div>
              <h2 class="analyst-name">{{ analyst.analyst_name }}</h2>
              <ion-note>{{ symbol }} — {{ name }}</ion-note>
            </div>
            <div class="direction-badge" :class="analyst.direction">
              <ion-icon :icon="directionIcon(analyst.direction)" />
              <span class="direction-label">{{ directionLabel(analyst.direction) }}</span>
              <span class="confidence-value">{{ analyst.confidence }}%</span>
            </div>
          </div>

          <!-- Tabs -->
          <div class="provenance-tabs">
            <button :class="{ active: activeTab === 'analysis' }" @click="activeTab = 'analysis'">Analysis</button>
            <button :class="{ active: activeTab === 'evidence' }" @click="activeTab = 'evidence'">Evidence</button>
            <button :class="{ active: activeTab === 'risk' }" @click="activeTab = 'risk'">Risk</button>
            <button :class="{ active: activeTab === 'memory' }" @click="activeTab = 'memory'">Memory</button>
            <button
              :class="{ active: activeTab === 'reasoning' }"
              :disabled="!llmCallsLoading && llmCalls.length === 0"
              :title="llmCalls.length > 0 ? '' : 'This analyst call did not produce reasoning content'"
              @click="activeTab = 'reasoning'"
            >Reasoning</button>
            <button :class="{ active: activeTab === 'challenge' }" @click="activeTab = 'challenge'; if (challenges.length === 0 && !challengeLoading) loadChallenges()">Challenge</button>
          </div>

          <!-- Analysis Tab -->
          <div v-if="activeTab === 'analysis'">
            <!-- What the Reports Say (fact-based) -->
            <div v-if="formatFactors(analyst.key_factors).length > 0" class="section facts-section">
              <h3 class="section-category-label">What the Reports Say</h3>
              <p class="section-category-desc">Key observations extracted from recent articles and data</p>
              <ul class="factor-list">
                <li v-for="(factor, i) in formatFactors(analyst.key_factors)" :key="i">{{ factor }}</li>
              </ul>
            </div>

            <!-- What This Actually Means (interpretation) -->
            <div class="section meaning-section">
              <h3 class="section-category-label">What This Actually Means</h3>
              <p class="section-category-desc">{{ analyst.analyst_name }}'s interpretation and guidance</p>
              <p class="rationale-text">{{ analyst.rationale || 'No detailed rationale provided.' }}</p>
              <div v-if="formatFactors(analyst.risks).length > 0" style="margin-top:12px">
                <h4 style="font-size:0.85rem;opacity:0.7;margin-bottom:6px">Risks to Watch</h4>
                <ul class="factor-list risk">
                  <li v-for="(risk, i) in formatFactors(analyst.risks)" :key="i">{{ risk }}</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Evidence Tab -->
          <div v-if="activeTab === 'evidence'">
            <div v-if="provenance.loading" class="section"><ion-note>Loading evidence...</ion-note></div>
            <div v-else-if="provenance.data" class="section">
              <h3>Articles Scored by This Analyst</h3>
              <div v-if="provenance.data.articles.length === 0"><ion-note>No articles scored yet</ion-note></div>
              <div v-for="article in [...provenance.data.articles].sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime())" :key="article.id" style="margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #eee">
                <div style="display:flex;align-items:baseline;gap:8px">
                  <a v-if="article.url" :href="article.url" target="_blank" rel="noopener" style="font-size:0.9rem;font-weight:500;color:var(--ion-color-primary);flex:1">
                    {{ article.title || '(untitled)' }}
                  </a>
                  <span v-else style="font-size:0.9rem;font-weight:500;flex:1">{{ article.title || '(untitled)' }}</span>
                  <span v-if="article.published_at" style="font-size:0.7rem;opacity:0.5;white-space:nowrap">{{ new Date(article.published_at).toLocaleDateString() }} {{ new Date(article.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
                </div>
                <div style="font-size:0.75rem;opacity:0.6">
                  Relevance: {{ (Number(article.relevance_score) * 100).toFixed(0) }}%
                  <span v-if="article.rationale"> — {{ article.rationale }}</span>
                </div>
              </div>

              <h3 style="margin-top:20px">Data Sources Used</h3>
              <div v-if="Object.keys(provenance.data.sourceData).length === 0"><ion-note>No specialized data used</ion-note></div>
              <div v-for="(src, key) in provenance.data.sourceData" :key="String(key)" style="font-size:0.85rem;margin-bottom:6px">
                <strong>{{ (src as any).name || key }}</strong>:
                {{ ((src as any).dataTypes || []).join(', ') }}
                <span style="opacity:0.5">({{ (src as any).charCount || 0 }} chars)</span>
              </div>
            </div>
          </div>

          <!-- Risk Tab -->
          <div v-if="activeTab === 'risk'">
            <div v-if="provenance.loading" class="section"><ion-note>Loading risk data...</ion-note></div>
            <div v-else-if="provenance.data?.riskAssessment" class="section">
              <h3>{{ provenance.data.analyst.display_name }}'s Risk Assessment</h3>
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
                <span style="font-size:2rem;font-weight:bold">{{ (provenance.data.riskAssessment as any).score }}</span>
                <span style="opacity:0.5">/100</span>
                <span style="font-size:0.8rem;opacity:0.6">{{ ((Number((provenance.data.riskAssessment as any).confidence) || 0) * 100).toFixed(0) }}% confidence</span>
              </div>
              <p style="font-size:0.9rem;line-height:1.6">{{ (provenance.data.riskAssessment as any).reasoning }}</p>
              <div v-if="((provenance.data.riskAssessment as any).evidence || []).length > 0" style="margin-top:12px">
                <h3>Evidence</h3>
                <ul class="factor-list">
                  <li v-for="(e, i) in ((provenance.data.riskAssessment as any).evidence || [])" :key="i">{{ e }}</li>
                </ul>
              </div>
            </div>
            <div v-else class="section"><ion-note>No risk assessment available</ion-note></div>
          </div>

          <!-- Memory Tab -->
          <div v-if="activeTab === 'memory'">
            <div v-if="provenance.loading" class="section"><ion-note>Loading memory...</ion-note></div>
            <div v-else-if="provenance.data" class="section">
              <div v-if="provenance.data.memory.calibration?.predictions_made" style="margin-bottom:16px;padding:12px;background:#f8f8f8;border-radius:8px">
                <strong>Track Record:</strong>
                {{ provenance.data.memory.calibration.predictions_made }} predictions,
                {{ provenance.data.memory.calibration.correct || 0 }} correct
                ({{ provenance.data.memory.calibration.predictions_made > 0
                  ? ((((provenance.data.memory.calibration.correct || 0) / provenance.data.memory.calibration.predictions_made) * 100).toFixed(0))
                  : 0 }}% accuracy)
              </div>

              <div v-if="provenance.data.memory.patterns.length > 0" style="margin-bottom:16px">
                <h3>Learned Patterns</h3>
                <ul class="factor-list">
                  <li v-for="(p, i) in provenance.data.memory.patterns.slice(0, 5)" :key="i">{{ (p as any).pattern }} ({{ ((Number((p as any).confidence) || 0) * 100).toFixed(0) }}% conf)</li>
                </ul>
              </div>

              <div v-if="provenance.data.memory.corrections.length > 0" style="margin-bottom:16px">
                <h3>Self-Corrections</h3>
                <ul class="factor-list risk">
                  <li v-for="(c, i) in provenance.data.memory.corrections.slice(0, 5)" :key="i">{{ (c as any).correction }}</li>
                </ul>
              </div>

              <div v-if="provenance.data.memory.instrumentNotes.length > 0">
                <h3>Notes on {{ symbol }}</h3>
                <ul class="factor-list">
                  <li v-for="(n, i) in provenance.data.memory.instrumentNotes.slice(0, 5)" :key="i">{{ (n as any).note }}</li>
                </ul>
              </div>

              <div v-if="provenance.data.memory.patterns.length === 0 && provenance.data.memory.corrections.length === 0 && !provenance.data.memory.calibration?.predictions_made">
                <ion-note>No memory accumulated yet — this analyst is still learning.</ion-note>
              </div>
            </div>
          </div>

          <!-- Challenge Tab -->
          <div v-if="activeTab === 'challenge'">
            <div v-if="challengeLoading && challenges.length === 0 && !challengeThinking" class="section" style="text-align:center;padding:24px">
              <ion-note>Starting challenge analysis...</ion-note>
            </div>
            <div v-if="challengeThinking" style="text-align:center;padding:12px;opacity:0.7;font-size:0.85rem">
              {{ challengeThinking }}
            </div>
            <div v-if="challenges.length > 0" class="section">
              <h3>Counter-Arguments</h3>
              <div v-for="(c, i) in challenges" :key="i" style="margin-bottom:16px;padding:12px;background:#f8f8f8;border-radius:8px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                  <strong>{{ (c.challenger as any)?.display_name }}</strong>
                  <ion-chip
                    :color="(c as any).counterDirection === 'up' ? 'success' : (c as any).counterDirection === 'down' ? 'danger' : 'medium'"
                    style="font-size:0.65rem;height:18px"
                  >
                    {{ (c as any).counterDirection }} {{ (c as any).counterConfidence }}%
                  </ion-chip>
                </div>
                <p style="font-size:0.9rem;line-height:1.5;margin:0">{{ (c as any).counterArgument }}</p>
                <ul v-if="((c as any).evidence || []).length > 0" class="factor-list" style="margin-top:8px">
                  <li v-for="(e, j) in ((c as any).evidence || [])" :key="j">{{ e }}</li>
                </ul>
              </div>
            </div>
            <div v-else class="section" style="text-align:center">
              <ion-button color="warning" @click="loadChallenges">Challenge This Analysis</ion-button>
              <p style="font-size:0.75rem;opacity:0.5;margin-top:8px">Other analysts will provide counter-arguments</p>
            </div>
          </div>

          <!-- Reasoning Tab (effort: see-your-reasoning) -->
          <div v-if="activeTab === 'reasoning'">
            <div v-if="llmCallsLoading" class="section"><ion-note>Loading reasoning...</ion-note></div>
            <div v-else-if="llmCallsError" class="section"><ion-note color="danger">{{ llmCallsError }}</ion-note></div>
            <div v-else-if="llmCalls.length === 0" class="section">
              <ion-note>No reasoning content captured for this call.</ion-note>
            </div>
            <div v-else>
              <div v-for="call in llmCalls" :key="call.runId" class="section">
                <div class="reasoning-header">
                  <strong>{{ call.provider }}</strong> / <code>{{ call.model }}</code>
                  <span v-if="call.reasoningTruncated" class="reasoning-truncated">(truncated at 64 KB)</span>
                  <span class="reasoning-meta">{{ call.inputTokens }} in / {{ call.outputTokens }} out</span>
                </div>
                <pre class="reasoning-pre">{{ call.reasoningContent }}</pre>
              </div>
            </div>
          </div>

          <!-- Trade Mode Form (Phase 6) -->
          <div v-if="mode === 'trade'" class="section trade-actions">
            <div v-if="tradeResult" class="trade-confirmation">
              <ion-chip color="success">Trade Filled</ion-chip>
              <p style="font-size:0.85rem">
                {{ symbol }} — {{ tradeDirection }} {{ tradeQty }} shares
                <span v-if="currentPrice"> @ ${{ Number(currentPrice).toFixed(2) }}</span>
              </p>
              <p style="font-size:0.7rem;opacity:0.6">Position opened immediately. View it under your portfolio.</p>
            </div>
            <div v-else>
              <h3 style="margin-bottom:8px">Trade {{ symbol }}</h3>
              <div style="display:flex;gap:8px;margin-bottom:12px">
                <ion-button
                  size="small"
                  :fill="tradeDirection === 'long' ? 'solid' : 'outline'"
                  color="success"
                  @click="tradeDirection = 'long'"
                >Buy (Long)</ion-button>
                <ion-button
                  size="small"
                  :fill="tradeDirection === 'short' ? 'solid' : 'outline'"
                  color="danger"
                  @click="tradeDirection = 'short'"
                >Sell (Short)</ion-button>
              </div>
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <label style="font-size:0.85rem">Shares:</label>
                <input
                  v-model.number="tradeQty"
                  type="number"
                  min="1"
                  style="width:80px;padding:4px 8px;border:1px solid #ccc;border-radius:4px"
                />
                <span v-if="currentPrice != null" style="font-size:0.8rem;opacity:0.7">
                  @ ${{ Number(currentPrice).toFixed(2) }}
                </span>
              </div>
              <div v-if="currentPrice != null" style="font-size:0.85rem;margin-bottom:12px">
                Total cost: <strong>${{ tradeTotalCost.toFixed(2) }}</strong>
              </div>
              <div v-if="tradeError" style="color:var(--ion-color-danger);font-size:0.8rem;margin-bottom:8px">{{ tradeError }}</div>
              <ion-button
                color="primary"
                :disabled="tradeSubmitting || !tradeQty || tradeQty <= 0"
                @click="submitImmediateTrade"
              >{{ tradeSubmitting ? 'Submitting…' : 'Submit Trade' }}</ion-button>
            </div>
          </div>

          <!-- Trade Actions (legacy view-mode queue flow) -->
          <div v-else class="section trade-actions">
            <div v-if="tradeResult && !tradeResult.skipped" class="trade-confirmation">
              <ion-chip color="success">Trade Queued</ion-chip>
              <p>{{ tradeResult.symbol }} — {{ tradeResult.direction }} {{ tradeResult.quantity }} shares ({{ ((Number(tradeResult.positionPercent) || 0) * 100).toFixed(0) }}% position)</p>
              <p style="font-size:0.75rem;opacity:0.6">Effective confidence: {{ Number(tradeResult.effectiveConfidence).toFixed(0) }}% — executes at EOD settlement</p>
            </div>
            <div v-else-if="tradeResult?.skipped" class="trade-confirmation">
              <ion-chip color="medium">Skipped</ion-chip>
              <p style="font-size:0.8rem;opacity:0.6">Decision recorded for outcome tracking</p>
            </div>
            <div v-else>
              <div v-if="disclaimerAcknowledged" style="font-size:0.75rem;opacity:0.5;margin-bottom:8px;text-align:center">
                Analysis only — your decision
              </div>
              <div v-if="tradeError" style="color:var(--ion-color-danger);font-size:0.8rem;margin-bottom:8px">{{ tradeError }}</div>
              <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
                <ion-button color="success" @click="takeTrade">
                  Take This Trade
                </ion-button>
                <ion-button
                  color="primary"
                  fill="outline"
                  :disabled="!isEquity || ctaBusy"
                  :aria-disabled="!isEquity || ctaBusy ? 'true' : 'false'"
                  @click="handleTradeThisPrediction"
                >
                  Trade this prediction
                </ion-button>
                <ion-button color="medium" fill="outline" @click="skipTrade">
                  Skip
                </ion-button>
              </div>
              <ion-note v-if="!isEquity" color="medium" style="display:block;text-align:center;margin-top:6px;font-size:0.75rem">
                Tournament trading is equity-only right now.
              </ion-note>
            </div>
          </div>
        </div>

        <!-- Disclaimer Modal -->
        <div v-if="showDisclaimer" class="disclaimer-overlay" @click.self="showDisclaimer = false">
          <div class="disclaimer-content">
            <h3>Before You Trade</h3>
            <p>Divinr provides AI-generated analysis and signals for educational purposes only. This is not investment advice, and no fiduciary relationship exists between you and Divinr. Past performance does not guarantee future results. All trading decisions are yours.</p>
            <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
              <ion-button color="primary" @click="acknowledgeDisclaimer">I Understand</ion-button>
              <ion-button color="medium" fill="outline" @click="showDisclaimer = false">Cancel</ion-button>
            </div>
          </div>
        </div>
      </div>
    </ion-content>
    <TournamentPicker
      :is-open="pickerOpen"
      :tournaments="pickerTournaments"
      @select="onPickerSelect"
      @dismiss="onPickerDismiss"
    />
  </ion-modal>
</template>

<style scoped>
.modal-body {
  max-width: 700px;
  margin: 0 auto;
}

.analyst-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 8px;
  border-bottom: 1px solid #e0e0e0;
}

.analyst-tab {
  padding: 8px 14px;
  border: none;
  border-radius: 20px;
  background: #f0f0f0;
  color: #555;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.analyst-tab:hover {
  background: #e0e0e0;
}

.analyst-tab.active {
  font-weight: 600;
}

.analyst-tab.active.up {
  background: rgba(46, 125, 50, 0.15);
  color: #2e7d32;
}

.analyst-tab.active.down {
  background: rgba(211, 47, 47, 0.15);
  color: #d32f2f;
}

.analyst-tab.active:not(.up):not(.down) {
  background: rgba(117, 117, 117, 0.15);
  color: #555;
}

.nav-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 8px 0;
}

.nav-counter {
  font-size: 0.8rem;
  color: #999;
}

.analyst-detail {
  margin-top: 16px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.analyst-name {
  margin: 0 0 4px 0;
  font-size: 1.3rem;
}

.direction-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 1rem;
}

.direction-badge.up {
  background: rgba(46, 125, 50, 0.12);
  color: #2e7d32;
}

.direction-badge.down {
  background: rgba(211, 47, 47, 0.12);
  color: #d32f2f;
}

.direction-badge.flat {
  background: rgba(117, 117, 117, 0.12);
  color: #757575;
}

.confidence-value {
  font-size: 0.85rem;
  opacity: 0.8;
}

.section {
  margin-bottom: 20px;
}

.section h3 {
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
  margin: 0 0 8px 0;
}

.rationale-text {
  font-size: 0.95rem;
  line-height: 1.6;
  color: #333;
  margin: 0;
}

.section-category-label {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 2px;
}

.section-category-desc {
  font-size: 0.75rem;
  opacity: 0.5;
  margin-bottom: 10px;
}

.facts-section {
  background: rgba(33, 150, 243, 0.04);
  border-left: 3px solid var(--ion-color-primary, #3880ff);
  padding: 12px 16px;
  border-radius: 4px;
}

.meaning-section {
  background: rgba(76, 175, 80, 0.04);
  border-left: 3px solid var(--ion-color-success, #2dd36f);
  padding: 12px 16px;
  border-radius: 4px;
}

.factor-list {
  margin: 0;
  padding-left: 20px;
}

.factor-list li {
  font-size: 0.9rem;
  line-height: 1.5;
  color: #444;
  margin-bottom: 4px;
}

.factor-list.risk li {
  color: #b71c1c;
}

.provenance-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 8px;
}

.provenance-tabs button {
  padding: 6px 14px;
  border: none;
  border-radius: 16px;
  background: #f0f0f0;
  color: #555;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}

.provenance-tabs button:hover {
  background: #e0e0e0;
}

.provenance-tabs button.active {
  background: var(--ion-color-primary);
  color: white;
  font-weight: 600;
}

.provenance-tabs button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Reasoning tab (effort: see-your-reasoning) */
.reasoning-pre {
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 0.8rem;
  max-height: 60vh;
  overflow: auto;
  background: #f8f8f8;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px;
  margin-top: 8px;
}

.reasoning-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.85rem;
}

.reasoning-header .reasoning-truncated {
  color: var(--ion-color-warning, #ffa500);
  font-size: 0.75rem;
}

.reasoning-header .reasoning-meta {
  margin-left: auto;
  opacity: 0.6;
  font-size: 0.75rem;
}

.trade-actions {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.trade-confirmation {
  text-align: center;
  padding: 12px;
}

.disclaimer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.disclaimer-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  max-width: 500px;
  margin: 16px;
}
</style>
