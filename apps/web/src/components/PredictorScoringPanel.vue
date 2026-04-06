<script setup lang="ts">
import { ref } from 'vue';
import { usePredictorsStore } from '../stores/predictors.store';
import { useApi } from '../composables/useApi';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonButton, IonChip, IonList, IonItem, IonLabel, IonCheckbox, IonNote,
} from '@ionic/vue';

const props = defineProps<{ instrumentId: string }>();
const predictors = usePredictorsStore();
const api = useApi();

const articles = ref<Record<string, unknown>[]>([]);
const selectedArticles = ref<string[]>([]);
const scoringResult = ref<Record<string, unknown> | null>(null);
const loading = ref(false);

async function loadArticles() {
  try {
    articles.value = await api.get<Record<string, unknown>[]>('/articles');
  } catch { /* ok */ }
}

function toggleArticle(id: string, checked: boolean) {
  if (checked) {
    selectedArticles.value = [...selectedArticles.value, id];
  } else {
    selectedArticles.value = selectedArticles.value.filter(a => a !== id);
  }
}

async function scoreSelected() {
  if (selectedArticles.value.length === 0) return;
  loading.value = true;
  try {
    if (selectedArticles.value.length === 1) {
      scoringResult.value = await predictors.score(props.instrumentId, selectedArticles.value[0]) as Record<string, unknown>;
    } else {
      scoringResult.value = await predictors.scoreBatch(props.instrumentId, selectedArticles.value) as Record<string, unknown>;
    }
    await predictors.fetch(props.instrumentId);
  } catch { /* ok */ }
  loading.value = false;
}

// Load on mount
loadArticles();
predictors.fetch(props.instrumentId);
</script>

<template>
  <div>
    <h3 style="margin-bottom:8px">AI Predictor Scoring</h3>
    <p style="opacity:0.5;margin-bottom:12px">
      Select articles to score for relevance to this instrument. The AI will rate each article 0-1
      and flag irrelevant ones for dismissal.
    </p>

    <!-- Article Selection -->
    <ion-card style="margin-bottom:16px">
      <ion-card-header>
        <ion-card-title style="font-size:0.85rem">Available Articles ({{ articles.length }})</ion-card-title>
      </ion-card-header>
      <ion-card-content style="max-height:300px;overflow-y:auto">
        <ion-list>
          <ion-item v-for="a in articles.slice(0, 50)" :key="String(a['id'])">
            <ion-checkbox
              slot="start"
              :checked="selectedArticles.includes(String(a['id']))"
              @ion-change="(e: any) => toggleArticle(String(a['id']), e.detail.checked)"
            />
            <ion-label>{{ a['title'] || '(untitled)' }} -- {{ String(a['source_origin'] || 'unknown') }}</ion-label>
          </ion-item>
        </ion-list>
        <p v-if="articles.length === 0" style="opacity:0.5">No articles available. Sync data first.</p>
      </ion-card-content>
      <div style="display:flex;align-items:center;padding:8px 16px 16px;gap:8px">
        <ion-chip style="font-size:0.7rem;height:24px">{{ selectedArticles.length }} selected</ion-chip>
        <span style="flex:1" />
        <ion-button color="primary" :disabled="selectedArticles.length === 0 || loading" @click="scoreSelected">
          Score {{ selectedArticles.length === 1 ? 'Article' : `${selectedArticles.length} Articles` }}
        </ion-button>
      </div>
    </ion-card>

    <!-- Scoring Result -->
    <ion-card v-if="scoringResult" style="margin-bottom:16px" color="light">
      <ion-card-header><ion-card-title>Scoring Result</ion-card-title></ion-card-header>
      <ion-card-content>
        <pre style="font-size:0.75rem;max-height:200px;overflow:auto">{{ JSON.stringify(scoringResult, null, 2) }}</pre>
      </ion-card-content>
    </ion-card>

    <!-- Current Predictors -->
    <h3 style="margin-bottom:8px">Active Predictors ({{ predictors.items.length }})</h3>
    <ion-list v-if="predictors.items.length > 0">
      <ion-item v-for="p in predictors.items" :key="String(p['id'])">
        <ion-label>
          <h3>
            <ion-chip :color="Number(p['relevance_score']) > 0.7 ? 'success' : Number(p['relevance_score']) > 0.4 ? 'warning' : 'danger'" style="font-size:0.7rem;height:20px">
              {{ Number(p['relevance_score']).toFixed(2) }}
            </ion-chip>
            <ion-chip style="font-size:0.7rem;height:20px">{{ p['status'] }}</ion-chip>
          </h3>
          <p style="font-size:0.75rem">{{ String(p['rationale'] || '').slice(0, 100) }}</p>
        </ion-label>
      </ion-item>
    </ion-list>
    <ion-note v-else color="primary" style="display:block;padding:8px">No predictors scored yet for this instrument.</ion-note>
  </div>
</template>
