<script setup lang="ts">
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonProgressBar, IonNote, IonChip } from '@ionic/vue';
import { ref } from 'vue';

defineProps<{
  assessments: Record<string, unknown>[];
}>();

const expanded = ref<Set<string>>(new Set());

function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
}

function scoreColor(score: number): string {
  if (score <= 33) return 'success';
  if (score <= 66) return 'warning';
  return 'danger';
}

function verdictLabel(score: number): string {
  if (score <= 33) return 'LOW';
  if (score <= 66) return 'MEDIUM';
  return 'HIGH';
}
</script>

<template>
  <div>
    <div v-for="a in assessments" :key="String(a['id'])" style="margin-bottom:16px">
      <ion-card button @click="toggle(String(a['id']))" style="cursor:pointer">
        <ion-card-header>
          <ion-card-title style="display:flex;align-items:center;font-size:1.1rem">
            {{ a['dimension_name'] || a['dimension_slug'] }}
            <span style="flex:1" />
            <span :style="{ fontSize: '1.5rem', fontWeight: 'bold', color: `var(--ion-color-${scoreColor(Number(a['score']))})` }">
              {{ a['score'] }}
            </span>
            <span style="font-size:0.75rem;opacity:0.5;margin-left:4px">/100</span>
          </ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <ion-progress-bar
              :value="Number(a['score']) / 100"
              :color="scoreColor(Number(a['score']))"
              style="flex:1;height:12px"
            />
            <ion-chip :color="scoreColor(Number(a['score']))" style="font-size:0.7rem;height:22px">
              {{ verdictLabel(Number(a['score'])) }}
            </ion-chip>
            <span style="font-size:0.75rem;opacity:0.6">{{ (Number(a['confidence']) * 100).toFixed(0) }}% conf</span>
          </div>

          <!-- Always show reasoning -->
          <p style="font-size:0.85rem;line-height:1.5;margin-bottom:8px">{{ a['reasoning'] }}</p>

          <!-- Expanded: evidence -->
          <template v-if="expanded.has(String(a['id']))">
            <div v-if="(a['evidence'] as string[])?.length" style="margin-top:12px">
              <div style="font-size:0.8rem;font-weight:600;margin-bottom:4px">Key Evidence</div>
              <ul style="margin:0;padding-left:20px">
                <li v-for="(e, i) in (a['evidence'] as string[])" :key="i" style="font-size:0.8rem;margin-bottom:4px;opacity:0.8">
                  {{ e }}
                </li>
              </ul>
            </div>
            <div style="margin-top:8px;font-size:0.7rem;opacity:0.4">
              Model: {{ a['model_provider'] }}/{{ a['model_name'] }}
            </div>
          </template>
          <div v-else style="font-size:0.75rem;color:var(--ion-color-primary);margin-top:4px">
            Click to expand evidence
          </div>
        </ion-card-content>
      </ion-card>
    </div>
    <ion-note v-if="assessments.length === 0" color="primary" style="display:block;padding:16px">
      No dimension assessments available.
    </ion-note>
  </div>
</template>
