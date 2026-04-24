<script setup lang="ts">
import { ref } from 'vue';
import {
  IonItem, IonLabel, IonIcon, IonNote, IonSpinner,
} from '@ionic/vue';
import { chevronDownOutline, chevronForwardOutline, openOutline } from 'ionicons/icons';
import { useApi } from '../composables/useApi';
import FirstTouchPanel from './FirstTouchPanel.vue';

interface SourceArticle {
  id: string;
  title: string;
  url: string;
  published_at?: string;
  rationale?: string;
  relevance_score?: number;
}

interface ProvenancePayload {
  articles: SourceArticle[];
  fallback: boolean;
}

const props = defineProps<{
  predictionId: string;
  instrumentSymbol?: string;
}>();

const api = useApi();
const expanded = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const payload = ref<ProvenancePayload | null>(null);

async function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value && payload.value === null && !loading.value) {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<ProvenancePayload>(
        `/predictions/${props.predictionId}/provenance`,
      );
      payload.value = { articles: res.articles ?? [], fallback: Boolean(res.fallback) };
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }
}

function fmtDate(raw: unknown): string {
  if (!raw || typeof raw !== 'string') return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function truncate(text: string, max = 200): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
</script>

<template>
  <div class="prediction-sources" data-test="prediction-sources">
    <FirstTouchPanel surface-key="prediction.sources" />

    <ion-item
      button
      lines="none"
      :detail="false"
      data-test="prediction-sources-toggle"
      @click="toggle"
    >
      <ion-icon
        slot="start"
        :icon="expanded ? chevronDownOutline : chevronForwardOutline"
        aria-hidden="true"
      />
      <ion-label>
        <span style="font-weight:600">Sources</span>
        <span
          v-if="payload"
          style="opacity:0.6;margin-left:6px;font-size:0.85rem"
        >({{ payload.articles.length }})</span>
      </ion-label>
    </ion-item>

    <div v-if="expanded" class="sources-body" data-test="prediction-sources-body">
      <div v-if="loading" style="padding:8px 12px;display:flex;align-items:center;gap:8px">
        <ion-spinner name="dots" />
        <ion-note color="medium">Loading sources…</ion-note>
      </div>

      <div v-else-if="error" style="padding:8px 12px">
        <ion-note color="danger">Couldn't load sources: {{ error }}</ion-note>
      </div>

      <template v-else-if="payload">
        <p
          v-if="payload.fallback"
          class="fallback-banner"
          data-test="prediction-sources-fallback"
        >
          Articles used in this specific analysis weren't captured — showing
          recent articles this analyst scored<span v-if="instrumentSymbol"> for {{ instrumentSymbol }}</span>
          instead.
        </p>

        <ion-note
          v-if="payload.articles.length === 0"
          color="medium"
          style="display:block;padding:8px 12px"
          data-test="prediction-sources-empty"
        >
          No articles were used in this analysis.
        </ion-note>

        <ul v-else class="article-list">
          <li
            v-for="article in payload.articles"
            :key="article.id"
            class="article-row"
            data-test="prediction-sources-row"
          >
            <a
              v-if="article.url"
              :href="article.url"
              target="_blank"
              rel="noopener noreferrer"
              class="article-title"
            >
              {{ article.title || '(untitled)' }}
              <ion-icon :icon="openOutline" aria-hidden="true" />
            </a>
            <span v-else class="article-title">{{ article.title || '(untitled)' }}</span>
            <div class="article-meta">
              <span v-if="article.published_at">{{ fmtDate(article.published_at) }}</span>
            </div>
            <p v-if="article.rationale" class="article-rationale">
              {{ truncate(String(article.rationale), 200) }}
            </p>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.prediction-sources {
  margin-top: 8px;
  border-top: 1px solid var(--ion-color-light-shade, #e5e7eb);
  padding-top: 6px;
}

.sources-body {
  padding: 4px 0 8px;
}

.fallback-banner {
  margin: 6px 12px 10px;
  padding: 8px 10px;
  font-style: italic;
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--ion-color-medium-shade, #6b7280);
  background: var(--ion-color-light, #f3f4f6);
  border-radius: 6px;
}

.article-list {
  list-style: none;
  margin: 0;
  padding: 0 12px;
}

.article-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--ion-color-light-shade, #eee);
}
.article-row:last-child { border-bottom: none; }

.article-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--ion-color-primary);
  text-decoration: none;
}
.article-title:hover { text-decoration: underline; }
.article-title ion-icon { font-size: 0.8rem; }

.article-meta {
  font-size: 0.72rem;
  opacity: 0.6;
  margin-top: 2px;
}

.article-rationale {
  margin: 4px 0 0;
  font-size: 0.78rem;
  line-height: 1.4;
  opacity: 0.85;
}
</style>
