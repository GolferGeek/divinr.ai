<script setup lang="ts">
import { ref } from 'vue';
import { IonButton, IonIcon } from '@ionic/vue';
import { closeOutline, searchOutline } from 'ionicons/icons';
import { useApi } from '../../composables/useApi';

const emit = defineEmits<{
  select: [type: string, id: string, label: string];
  close: [];
}>();

const entityType = ref('instrument');
const searchQuery = ref('');
const results = ref<Array<{ id: string; label: string }>>([]);
const searching = ref(false);

const types = [
  { value: 'instrument', label: 'Instruments' },
  { value: 'analyst', label: 'Analysts' },
  { value: 'prediction', label: 'Analyses' },
  { value: 'position', label: 'Positions' },
];

async function search() {
  const api = useApi();
  searching.value = true;
  results.value = [];

  try {
    switch (entityType.value) {
      case 'instrument': {
        const res = await api.get<{ instruments: Array<{ id: string; symbol: string; name: string }> }>('/instruments');
        results.value = (res.instruments ?? [])
          .filter(i => !searchQuery.value || i.symbol.toLowerCase().includes(searchQuery.value.toLowerCase()) || i.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
          .slice(0, 20)
          .map(i => ({ id: i.id, label: `${i.symbol} — ${i.name}` }));
        break;
      }
      case 'analyst': {
        const res = await api.get<{ analysts: Array<{ id: string; display_name: string; analyst_type: string }> }>('/analysts');
        results.value = (res.analysts ?? [])
          .filter(a => !searchQuery.value || a.display_name.toLowerCase().includes(searchQuery.value.toLowerCase()))
          .slice(0, 20)
          .map(a => ({ id: a.id, label: `${a.display_name} (${a.analyst_type})` }));
        break;
      }
      default:
        results.value = [];
    }
  } catch {
    // Silently fail
  } finally {
    searching.value = false;
  }
}

function selectEntity(id: string, label: string) {
  emit('select', entityType.value, id, label);
}
</script>

<template>
  <div class="picker-overlay" @click.self="emit('close')">
    <div class="picker-panel">
      <div class="picker-header">
        <span class="picker-title">Attach Entity</span>
        <ion-button fill="clear" size="small" @click="emit('close')">
          <ion-icon :icon="closeOutline" />
        </ion-button>
      </div>

      <div class="picker-tabs">
        <button
          v-for="t in types"
          :key="t.value"
          class="tab-btn"
          :class="{ active: entityType === t.value }"
          @click="entityType = t.value; results = []"
        >{{ t.label }}</button>
      </div>

      <div class="picker-search">
        <input
          v-model="searchQuery"
          class="search-input"
          placeholder="Search..."
          @keyup.enter="search"
        />
        <ion-button fill="clear" size="small" @click="search">
          <ion-icon :icon="searchOutline" />
        </ion-button>
      </div>

      <div class="picker-results">
        <div v-if="searching" class="picker-empty">Searching...</div>
        <div v-else-if="results.length === 0" class="picker-empty">
          Click search to find {{ entityType }}s
        </div>
        <div
          v-for="r in results"
          :key="r.id"
          class="result-row"
          @click="selectEntity(r.id, r.label)"
        >
          {{ r.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.picker-panel {
  background: #fff;
  border-radius: 12px;
  width: 420px;
  max-width: 95vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
  font-weight: 600;
}

.picker-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid #e0e0e0;
}

.tab-btn {
  background: none;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 0.8rem;
  cursor: pointer;
}

.tab-btn.active {
  background: var(--ion-color-primary, #3880ff);
  color: #fff;
  border-color: var(--ion-color-primary, #3880ff);
}

.picker-search {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  gap: 4px;
}

.search-input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.9rem;
  outline: none;
}

.picker-results {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 12px;
}

.picker-empty {
  text-align: center;
  padding: 24px;
  color: #888;
  font-size: 0.85rem;
}

.result-row {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.15s;
}

.result-row:hover {
  background: #f0f0f0;
}
</style>
