<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonChip,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonToggle,
} from '@ionic/vue';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import { useAnalystsStore } from '../stores/analysts.store';
import { useInstrumentsStore } from '../stores/instruments.store';
import { useAnalysisPreferencesStore, type AnalysisPreferences, type DashboardPriorityMode } from '../stores/analysis-preferences.store';

const analysts = useAnalystsStore();
const instruments = useInstrumentsStore();
const prefs = useAnalysisPreferencesStore();

const draft = ref<AnalysisPreferences>({
  followed_analyst_ids: [],
  watched_instrument_ids: [],
  muted_instrument_ids: [],
  priority_mode: 'balanced',
});
const analystSearch = ref('');
const instrumentSearch = ref('');
const saved = ref(false);

const followed = computed(() => new Set(draft.value.followed_analyst_ids));
const watched = computed(() => new Set(draft.value.watched_instrument_ids));
const muted = computed(() => new Set(draft.value.muted_instrument_ids));

function clonePreferences(value: AnalysisPreferences): AnalysisPreferences {
  return {
    followed_analyst_ids: [...value.followed_analyst_ids],
    watched_instrument_ids: [...value.watched_instrument_ids],
    muted_instrument_ids: [...value.muted_instrument_ids],
    priority_mode: value.priority_mode,
  };
}

onMounted(async () => {
  await Promise.all([
    analysts.fetch().catch(() => {}),
    instruments.fetch().catch(() => {}),
    prefs.fetch().catch(() => {}),
  ]);
  draft.value = clonePreferences(prefs.preferences);
});

watch(() => prefs.preferences, (next) => {
  draft.value = clonePreferences(next);
}, { deep: true });

const filteredAnalysts = computed(() => {
  const q = analystSearch.value.trim().toLowerCase();
  return analysts.items
    .filter((row) => {
      if (!q) return true;
      return `${row['display_name'] ?? ''} ${row['slug'] ?? ''}`.toLowerCase().includes(q);
    })
    .slice(0, 20);
});

const filteredInstruments = computed(() => {
  const q = instrumentSearch.value.trim().toLowerCase();
  return instruments.items
    .filter((row) => {
      if (!q) return true;
      return `${row['symbol'] ?? ''} ${row['name'] ?? ''}`.toLowerCase().includes(q);
    })
    .slice(0, 24);
});

function toggleId(field: 'followed_analyst_ids' | 'watched_instrument_ids' | 'muted_instrument_ids', id: string, enabled: boolean) {
  const current = new Set(draft.value[field]);
  if (enabled) current.add(id);
  else current.delete(id);
  draft.value = { ...draft.value, [field]: [...current] };
}

function setPriority(value: DashboardPriorityMode) {
  draft.value = { ...draft.value, priority_mode: value };
}

async function savePreferences() {
  saved.value = false;
  await prefs.save(clonePreferences(draft.value));
  saved.value = true;
  window.setTimeout(() => { saved.value = false; }, 1800);
}
</script>

<template>
  <div class="analysis-preferences">
    <div class="page-header">
      <div>
        <h1>Analysis Preferences</h1>
        <ion-note>Choose what the dashboard should pay attention to first.</ion-note>
      </div>
      <ion-button
        data-testid="analysis-preferences-save"
        :disabled="prefs.saving"
        @click="savePreferences"
      >
        {{ prefs.saving ? 'Saving...' : 'Save' }}
      </ion-button>
    </div>

    <ion-note v-if="prefs.error" color="danger" class="status-note">{{ prefs.error }}</ion-note>
    <ion-note v-if="saved" color="success" class="status-note">Saved.</ion-note>

    <ion-spinner v-if="prefs.loading || analysts.loading || instruments.loading" name="crescent" />

    <ion-card>
      <ion-card-header>
        <ion-card-title>Dashboard Priority</ion-card-title>
      </ion-card-header>
      <ion-card-content>
        <ion-segment
          :value="draft.priority_mode"
          data-testid="dashboard-priority-mode"
          @ion-change="(event: CustomEvent) => setPriority((event.detail as { value: DashboardPriorityMode }).value)"
        >
          <ion-segment-button value="balanced" @click="setPriority('balanced')">Balanced</ion-segment-button>
          <ion-segment-button value="portfolio_first" @click="setPriority('portfolio_first')">Portfolio</ion-segment-button>
          <ion-segment-button value="tournaments_first" @click="setPriority('tournaments_first')">Tournaments</ion-segment-button>
        </ion-segment>
      </ion-card-content>
    </ion-card>

    <div class="prefs-grid">
      <ion-card>
        <ion-card-header>
          <ion-card-title>Follow Analysts</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-input
            v-model="analystSearch"
            data-testid="analyst-preference-search"
            label="Search analysts"
            label-placement="stacked"
            placeholder="Name or slug"
          />
          <ion-list>
            <ion-item v-for="analyst in filteredAnalysts" :key="String(analyst['id'])">
              <ion-label class="ion-text-wrap">
                <h3>{{ analyst['display_name'] }}</h3>
                <p>{{ analyst['slug'] }}</p>
              </ion-label>
              <ion-toggle
                slot="end"
                :checked="followed.has(String(analyst['id']))"
                :data-testid="`follow-analyst-${String(analyst['id'])}`"
                @ion-change="(event: CustomEvent) => toggleId('followed_analyst_ids', String(analyst['id']), (event.detail as { checked: boolean }).checked)"
              />
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header>
          <ion-card-title>Watch Or Mute Instruments</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-input
            v-model="instrumentSearch"
            data-testid="instrument-preference-search"
            label="Search instruments"
            label-placement="stacked"
            placeholder="Symbol or name"
          />
          <ion-list>
            <ion-item v-for="instrument in filteredInstruments" :key="String(instrument['id'])">
              <ion-label class="ion-text-wrap">
                <h3>
                  {{ instrument['symbol'] }}
                  <ion-chip v-if="watched.has(String(instrument['id']))" color="primary">Watched</ion-chip>
                  <ion-chip v-if="muted.has(String(instrument['id']))" color="medium">Muted</ion-chip>
                </h3>
                <p>{{ instrument['name'] }}</p>
              </ion-label>
              <div slot="end" class="instrument-actions">
                <ion-toggle
                  aria-label="Watch instrument"
                  :checked="watched.has(String(instrument['id']))"
                  :disabled="muted.has(String(instrument['id']))"
                  :data-testid="`watch-instrument-${String(instrument['id'])}`"
                  @ion-change="(event: CustomEvent) => toggleId('watched_instrument_ids', String(instrument['id']), (event.detail as { checked: boolean }).checked)"
                />
                <ion-toggle
                  aria-label="Mute instrument"
                  color="medium"
                  :checked="muted.has(String(instrument['id']))"
                  :data-testid="`mute-instrument-${String(instrument['id'])}`"
                  @ion-change="(event: CustomEvent) => {
                    const checked = (event.detail as { checked: boolean }).checked;
                    toggleId('muted_instrument_ids', String(instrument['id']), checked);
                    if (checked) toggleId('watched_instrument_ids', String(instrument['id']), false);
                  }"
                />
              </div>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>
    </div>

    <FirstTouchPanel surface-key="settings.analysis-preferences" />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-header h1 {
  margin: 0 0 4px;
}

.status-note {
  display: block;
  margin-bottom: 12px;
}

.prefs-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  gap: 16px;
}

.instrument-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

@media (max-width: 820px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }

  .prefs-grid {
    grid-template-columns: 1fr;
  }

  .instrument-actions {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
