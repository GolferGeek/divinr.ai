<script setup lang="ts">
import { onMounted } from 'vue';
import { useSourcesStore } from '../stores/sources.store';
import {
  IonList, IonItem, IonLabel, IonChip, IonToggle, IonNote,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonIcon,
} from '@ionic/vue';
import { newspaperOutline, cloudOutline } from 'ionicons/icons';

const store = useSourcesStore();

onMounted(() => {
  store.fetch();
  store.fetchDataAdapters();
});

function toggleArticles(sourceId: string) {
  if (store.selectedSourceId === sourceId) {
    store.selectedSourceId = null;
    store.articles = [];
  } else {
    store.fetchArticles(sourceId);
  }
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
</script>

<template>
  <div>
    <!-- Data Source Adapters -->
    <h1 style="margin-bottom:8px">
      <ion-icon :icon="cloudOutline" style="vertical-align:middle;margin-right:8px" />
      Data Source Adapters
    </h1>
    <ion-note style="display:block;margin-bottom:16px">
      External APIs that feed specialized data to each analyst.
    </ion-note>

    <div v-if="store.dataAdapters.length === 0">
      <ion-note color="medium" style="display:block;padding:16px">Loading data adapters...</ion-note>
    </div>
    <div v-else style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-bottom:32px">
      <ion-card v-for="adapter in store.dataAdapters" :key="String(adapter['id'])">
        <ion-card-header>
          <ion-card-title style="font-size:1rem;display:flex;align-items:center;gap:8px">
            {{ adapter['name'] }}
            <ion-chip :color="adapter['is_active'] ? 'success' : 'medium'" style="font-size:0.65rem;height:18px">
              {{ adapter['tier'] }}
            </ion-chip>
            <ion-chip color="tertiary" style="font-size:0.65rem;height:18px">
              {{ adapter['rate_limit_per_minute'] }}/min
            </ion-chip>
          </ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div v-if="(adapter['analyst_assignments'] as any[])?.length" style="margin-top:4px">
            <div v-for="(a, i) in (adapter['analyst_assignments'] as any[])" :key="i" style="font-size:0.8rem;margin-bottom:6px">
              <strong>{{ a.analyst_name }}</strong>
              <span style="opacity:0.6;margin-left:4px">{{ (a.data_types as string[])?.join(', ') }}</span>
            </div>
          </div>
          <ion-note v-else style="font-size:0.75rem">No analyst assignments</ion-note>
        </ion-card-content>
      </ion-card>
    </div>

    <!-- Article Sources -->
    <h1 style="margin-bottom:8px">
      <ion-icon :icon="newspaperOutline" style="vertical-align:middle;margin-right:8px" />
      Article Sources
    </h1>
    <ion-note style="display:block;margin-bottom:16px">
      News and article feeds crawled for all analysts. Click to see recent articles.
    </ion-note>

    <ion-list>
      <template v-for="s in store.items" :key="String(s['id'])">
        <ion-item button @click="toggleArticles(String(s['id']))" style="cursor:pointer">
          <ion-label>
            <h3>{{ s['display_name'] }}</h3>
            <p>
              <ion-chip style="font-size:0.65rem;height:18px">{{ s['tier'] }}</ion-chip>
              <span style="font-size:0.75rem;opacity:0.6;margin-left:4px">{{ s['source_origin'] || 'divinr' }}</span>
            </p>
          </ion-label>
          <ion-toggle
            slot="end"
            :checked="Boolean(s['is_enabled'] ?? s['is_global_default'])"
            color="success"
            @ion-change.stop="(e: any) => store.toggleEntitlement(String(s['id']), e.detail.checked)"
          />
        </ion-item>

        <!-- Expanded articles for this source -->
        <div v-if="store.selectedSourceId === String(s['id'])" style="padding:0 16px 16px 32px;background:var(--ion-color-light-tint)">
          <div v-if="store.articles.length === 0" style="padding:12px 0;font-size:0.8rem;opacity:0.5">
            No recent articles from this source.
          </div>
          <div v-for="article in store.articles" :key="String(article['id'])" style="padding:8px 0;border-bottom:1px solid var(--ion-color-light-shade)">
            <div style="display:flex;align-items:baseline;gap:8px">
              <a v-if="article['url']" :href="String(article['url'])" target="_blank" rel="noopener" style="font-size:0.85rem;font-weight:500;text-decoration:none;color:var(--ion-color-primary)">
                {{ article['title'] || '(untitled)' }}
              </a>
              <span v-else style="font-size:0.85rem;font-weight:500">{{ article['title'] || '(untitled)' }}</span>
              <span style="font-size:0.7rem;opacity:0.5;white-space:nowrap">{{ timeAgo(String(article['published_at'] || article['created_at'])) }}</span>
            </div>
            <p v-if="article['summary']" style="font-size:0.75rem;opacity:0.7;margin:4px 0 0 0;line-height:1.4">
              {{ String(article['summary']).slice(0, 200) }}{{ String(article['summary']).length > 200 ? '...' : '' }}
            </p>
          </div>
        </div>
      </template>
    </ion-list>
  </div>
</template>
