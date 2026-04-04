<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton,
  IonIcon, IonChip, IonNote,
} from '@ionic/vue';
import {
  closeOutline, arrowUpOutline, trendingDownOutline, removeOutline,
  chevronBackOutline, chevronForwardOutline,
} from 'ionicons/icons';

interface AnalystStance {
  analyst_id: string;
  analyst_name: string;
  analyst_slug: string;
  direction: string;
  confidence: number;
  rationale: string;
  key_factors: unknown;
  risks: unknown;
}

const props = defineProps<{
  isOpen: boolean;
  symbol: string;
  name: string;
  analysts: AnalystStance[];
  initialIndex: number;
}>();

const emit = defineEmits<{
  close: [];
}>();

const currentIndex = ref(props.initialIndex);

// Reset index when modal opens with new data
watch(() => [props.isOpen, props.initialIndex], ([open]) => {
  if (open) currentIndex.value = props.initialIndex;
});

const analyst = computed(() => props.analysts[currentIndex.value] ?? props.analysts[0]);
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

          <!-- Rationale -->
          <div class="section">
            <h3>Analysis</h3>
            <p class="rationale-text">{{ analyst.rationale || 'No detailed rationale provided.' }}</p>
          </div>

          <!-- Key Factors -->
          <div v-if="formatFactors(analyst.key_factors).length > 0" class="section">
            <h3>Key Factors</h3>
            <ul class="factor-list">
              <li v-for="(factor, i) in formatFactors(analyst.key_factors)" :key="i">{{ factor }}</li>
            </ul>
          </div>

          <!-- Risks -->
          <div v-if="formatFactors(analyst.risks).length > 0" class="section">
            <h3>Risks</h3>
            <ul class="factor-list risk">
              <li v-for="(risk, i) in formatFactors(analyst.risks)" :key="i">{{ risk }}</li>
            </ul>
          </div>
        </div>
      </div>
    </ion-content>
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
</style>
