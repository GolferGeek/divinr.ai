<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote } from '@ionic/vue';
import { useMentorStore } from '../stores/mentor.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useMentorStore();
const route = useRoute();
const router = useRouter();
const clubId = computed(() => route.params.clubId as string);

onMounted(async () => {
  await store.fetchDashboard(clubId.value);
});
</script>

<template>
  <div class="detail-page">
    <IonButton size="small" fill="clear" @click="router.push(`/clubs/${clubId}`)">Back to Club</IonButton>
    <h1>Mentor Dashboard</h1>

    <div v-if="store.loading" class="empty">Loading...</div>
    <div v-else-if="!store.dashboard || (store.dashboard as {mentees: unknown[]}).mentees.length === 0" class="empty">No active mentees</div>

    <div v-else>
      <IonCard v-for="mentee in (store.dashboard as {mentees: Array<{user_id: string; display_name: string|null; dm_channel_id: string|null; challenges: Array<{direction?: string; thesis?: string; symbol?: string; submitted_at?: string}>; journals: Array<{entry: string; created_at: string}>; tournaments: Array<{tournament_name?: string; final_rank?: number; total_realized_pnl?: number; initial_balance?: number}>}>}).mentees" :key="mentee.user_id" class="mentee-card">
        <IonCardHeader>
          <IonCardTitle class="mentee-header">
            {{ mentee.display_name || mentee.user_id.slice(0, 8) }}
            <IonButton v-if="mentee.dm_channel_id" size="small" fill="outline"
              @click="router.push(`/messages/${mentee.dm_channel_id}`)">Message</IonButton>
          </IonCardTitle>
        </IonCardHeader>
        <IonCardContent>
          <h4>Challenge Responses</h4>
          <div v-if="mentee.challenges.length === 0" class="empty-small">No challenges yet</div>
          <div v-for="(c, i) in mentee.challenges.slice(0, 5)" :key="i" class="activity-item">
            <IonChip :color="c.direction === 'bull' ? 'success' : c.direction === 'bear' ? 'danger' : 'medium'" size="small">{{ c.direction }}</IonChip>
            <span>{{ c.symbol }} — {{ c.thesis?.slice(0, 80) }}</span>
          </div>

          <h4>Journal Entries</h4>
          <div v-if="mentee.journals.length === 0" class="empty-small">No journals yet</div>
          <div v-for="(j, i) in mentee.journals.slice(0, 5)" :key="i" class="activity-item">
            <p>{{ j.entry.slice(0, 120) }}{{ j.entry.length > 120 ? '...' : '' }}</p>
            <IonNote>{{ new Date(j.created_at).toLocaleDateString() }}</IonNote>
          </div>

          <h4>Tournament Performance</h4>
          <div v-if="mentee.tournaments.length === 0" class="empty-small">No tournaments yet</div>
          <div v-for="(t, i) in mentee.tournaments.slice(0, 5)" :key="i" class="activity-item">
            <strong>{{ t.tournament_name }}</strong>
            <IonNote>Rank: {{ t.final_rank ?? 'In progress' }} · PnL: {{ ((t.total_realized_pnl ?? 0) / (t.initial_balance ?? 1) * 100).toFixed(1) }}%</IonNote>
          </div>
        </IonCardContent>
      </IonCard>
    </div>
  
  <FirstTouchPanel surface-key="mentor.dashboard" />
  </div>
</template>

<style scoped>
.detail-page { padding: 1rem; max-width: 900px; }
.empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
.empty-small { text-align: center; padding: 0.5rem; color: var(--ion-color-medium); font-size: 0.85rem; }
.mentee-header { display: flex; justify-content: space-between; align-items: center; }
.mentee-card { margin-bottom: 1rem; }
h4 { margin: 1rem 0 0.5rem; font-size: 0.95rem; border-bottom: 1px solid var(--ion-color-light-shade); padding-bottom: 0.25rem; }
.activity-item { margin-bottom: 0.5rem; font-size: 0.9rem; }
.activity-item p { margin: 0; }
</style>
