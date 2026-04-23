<script setup lang="ts">
import { ref } from 'vue';
import { usePredictorsStore } from '../stores/predictors.store';
import { useApi } from '../composables/useApi';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonButton, IonChip, IonList, IonItem, IonLabel, IonCheckbox, IonNote, IonIcon,
} from '@ionic/vue';
import { openOutline } from 'ionicons/icons';
import FirstTouchPanel from './FirstTouchPanel.vue';

function fmtDate(raw: unknown): string {
  if (!raw || typeof raw !== 'string') return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

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
    <FirstTouchPanel surface-key="instrument.article-relevance" />

    <h3 style="margin-bottom:8px">Article Relevance</h3>
    <p style="opacity:0.5;margin-bottom:12px">
      Our analysts score the articles they've read for how relevant each one is to this ticker.
      Higher scores mean the article likely fed into a recent analyst signal. Pick articles below
      to have an analyst re-score them.
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

    <!-- Scored articles -->
    <h3 style="margin-bottom:8px">Scored articles ({{ predictors.items.length }})</h3>
    <ion-list v-if="predictors.items.length > 0" data-test="article-relevance-list">
      <ion-item v-for="p in predictors.items" :key="String(p['id'])" data-test="article-relevance-row">
        <ion-label>
          <h3 style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <ion-chip :color="Number(p['relevance_score']) > 0.7 ? 'success' : Number(p['relevance_score']) > 0.4 ? 'warning' : 'danger'" style="font-size:0.7rem;height:20px">
              {{ Number(p['relevance_score']).toFixed(2) }}
            </ion-chip>
            <ion-chip style="font-size:0.7rem;height:20px">{{ p['status'] }}</ion-chip>
            <a
              v-if="p['article_url']"
              :href="String(p['article_url'])"
              target="_blank"
              rel="noopener noreferrer"
              style="font-weight:500;text-decoration:underline;display:inline-flex;align-items:center;gap:4px"
            >
              {{ p['article_title'] || '(untitled article)' }}
              <ion-icon :icon="openOutline" style="font-size:0.85rem" />
            </a>
            <span v-else style="font-weight:500">
              {{ p['article_title'] || '(untitled article)' }}
            </span>
          </h3>
          <p style="font-size:0.72rem;opacity:0.7;margin:2px 0">
            <span v-if="p['analyst_display_name']">Scored by {{ p['analyst_display_name'] }}</span>
            <span v-if="p['analyst_display_name'] && p['article_published_at']"> · </span>
            <span v-if="p['article_published_at']">Published {{ fmtDate(p['article_published_at']) }}</span>
          </p>
          <p style="font-size:0.75rem;margin:4px 0 0">{{ String(p['rationale'] || '').slice(0, 200) }}</p>
        </ion-label>
      </ion-item>
    </ion-list>
    <ion-note v-else color="primary" style="display:block;padding:8px">No articles scored yet for this ticker.</ion-note>
  </div>
</template>
