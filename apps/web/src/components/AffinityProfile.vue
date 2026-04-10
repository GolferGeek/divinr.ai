<script setup lang="ts">
import { onMounted } from 'vue';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonItem, IonLabel, IonNote, IonChip, IonList,
} from '@ionic/vue';
import { useAffinityStore } from '../stores/affinity.store';

const affinity = useAffinityStore();

onMounted(() => affinity.fetchAffinityProfile());

function formatScore(score: number): string {
  return (score * 100).toFixed(0);
}

function scoreColor(score: number): string {
  if (score >= 0.7) return 'success';
  if (score >= 0.4) return 'warning';
  return 'danger';
}
</script>

<template>
  <div>
    <h1>Analyst Affinity Profile</h1>
    <p style="color:#999;margin-bottom:16px">
      Your learned preferences based on trade decisions, challenge interactions, and browsing patterns.
    </p>

    <div v-if="affinity.loading" style="padding:32px;text-align:center;color:#999">
      Loading affinity data...
    </div>

    <div v-else-if="affinity.affinities.length === 0" style="padding:32px;text-align:center;color:#999">
      No affinity data yet. Make trade decisions and interact with analysts to build your profile.
    </div>

    <ion-list v-else>
      <ion-item v-for="a in affinity.affinities" :key="a.analyst_id" lines="full">
        <div slot="start" style="width:48px;text-align:center">
          <ion-chip :color="scoreColor(a.affinity_score)" style="font-size:0.8rem;height:28px;min-width:48px">
            {{ formatScore(a.affinity_score) }}
          </ion-chip>
        </div>

        <ion-label>
          <h2>{{ a.display_name }}</h2>
          <p style="font-size:0.75rem;color:#999">{{ a.slug }}</p>

          <!-- Affinity bar -->
          <div style="margin-top:6px;background:#333;border-radius:4px;height:8px;overflow:hidden">
            <div
              :style="{
                width: (a.affinity_score * 100) + '%',
                height: '100%',
                borderRadius: '4px',
                background: a.affinity_score >= 0.7 ? '#2dd36f' : a.affinity_score >= 0.4 ? '#ffc409' : '#eb445a',
                transition: 'width 0.3s',
              }"
            />
          </div>

          <!-- Signal breakdown -->
          <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;font-size:0.7rem;color:#aaa">
            <span v-if="a.buy_agreement > 0">Agreements: {{ a.buy_agreement }}</span>
            <span v-if="a.skip_disagreement > 0">Skips: {{ a.skip_disagreement }}</span>
            <span v-if="a.challenge_accept > 0">Challenges accepted: {{ a.challenge_accept }}</span>
            <span v-if="a.challenge_reject > 0">Challenges rejected: {{ a.challenge_reject }}</span>
            <span v-if="a.browse_signals > 0">Browse interest: {{ a.browse_signals }}</span>
            <span v-if="a.signal_count === 0">No signals yet</span>
          </div>
        </ion-label>

        <ion-note slot="end" style="font-size:0.7rem;color:#666">
          {{ a.signal_count }} signals
        </ion-note>
      </ion-item>
    </ion-list>
  </div>
</template>
