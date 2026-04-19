<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote, IonSegment, IonSegmentButton, IonLabel } from '@ionic/vue';
import { useClubStore } from '../stores/club.store';
import { useTournamentStore } from '../stores/tournament.store';
import { useCanWrite } from '../composables/useCanWrite';
import { pluralize, formatBadge } from '../utils/format';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useClubStore();
const tstore = useTournamentStore();
const { canWrite } = useCanWrite();
const router = useRouter();
const tab = ref<'mine' | 'discover'>('mine');
const discoverSort = ref('ranking_score');

onMounted(async () => {
  store.fetchMyClubs();
  store.fetchPublicClubs();
  await tstore.fetchTournaments({ scope: 'club' });
});

function changeSortDiscover() { store.fetchPublicClubs(); }

function sprintInfo(clubId: string): { status: 'active' | 'upcoming'; startsAt?: string } | null {
  const active = tstore.tournaments.find(t => t.scope === 'club' && t.scope_id === clubId && t.status === 'active');
  if (active) return { status: 'active' };
  const upcoming = tstore.tournaments
    .filter(t => t.scope === 'club' && t.scope_id === clubId && t.status === 'upcoming')
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
  if (upcoming) return { status: 'upcoming', startsAt: upcoming.starts_at };
  return null;
}

function formatStartShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
</script>

<template>
  <div class="clubs-page">
    <div class="page-header">
      <h1>Clubs</h1>
      <div class="header-actions">
        <IonButton size="small" fill="outline" title="Cross-club leaderboard across all members." @click="router.push('/clubs/rankings')">Rankings</IonButton>
        <IonButton v-if="canWrite" size="small" @click="router.push('/clubs/create')">Create Club</IonButton>
      </div>
    </div>
    <IonSegment v-model="tab">
      <IonSegmentButton value="mine"><IonLabel>My Clubs</IonLabel></IonSegmentButton>
      <IonSegmentButton value="discover"><IonLabel>Discover</IonLabel></IonSegmentButton>
    </IonSegment>

    <div v-if="tab === 'mine'" class="tab-content">
      <div v-if="store.myClubs.length === 0" class="empty">No clubs yet. Create one or join with an invite code!</div>
      <IonCard v-for="c in store.myClubs" :key="c.id" @click="router.push(`/clubs/${c.id}`)">
        <IonCardHeader>
          <div class="my-club-header-row">
            <IonCardTitle>{{ c.name }}</IonCardTitle>
            <div class="header-chips">
              <IonChip v-if="sprintInfo(c.id)?.status === 'active'" color="success" class="sprint-chip">Sprint active</IonChip>
              <IonChip v-else-if="sprintInfo(c.id)?.status === 'upcoming'" color="warning" class="sprint-chip">
                Sprint starts {{ formatStartShort(sprintInfo(c.id)!.startsAt!) }}
              </IonChip>
              <IonChip color="tertiary">{{ c.my_role }}</IonChip>
            </div>
          </div>
        </IonCardHeader>
        <IonCardContent>
          <p v-if="c.description" class="club-description">{{ c.description }}</p>
          <IonNote>{{ pluralize(c.member_count, 'member') }}</IonNote>
          <span
            v-if="c.unread_count && c.unread_count > 0"
            class="unread-badge"
            :aria-label="`${c.unread_count} unread activities`"
          >({{ formatBadge(c.unread_count) }})</span>
        </IonCardContent>
      </IonCard>
    </div>

    <div v-if="tab === 'discover'" class="tab-content">
      <div v-if="store.publicClubs.length === 0" class="empty">No public clubs yet.</div>
      <IonCard v-for="c in store.publicClubs" :key="c.id" @click="router.push(`/clubs/${c.id}`)">
        <IonCardHeader><IonCardTitle>{{ c.name }}</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <IonNote>{{ pluralize(c.member_count, 'member') }} · {{ pluralize(c.tournament_count, 'tournament') }}</IonNote>
        </IonCardContent>
      </IonCard>
    </div>
  
  <FirstTouchPanel surface-key="clubs" />
  </div>
</template>

<style scoped>
.clubs-page { padding: 1rem; max-width: 900px; }
.page-header { display: flex; justify-content: space-between; align-items: center; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.tab-content { margin-top: 1rem; }
.empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
ion-card { cursor: pointer; }
.my-club-header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap; }
.header-chips { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.sprint-chip { height: 22px; font-size: 0.75rem; font-weight: 500; }
.club-description { font-size: 0.9rem; color: var(--ion-color-medium); margin: 0 0 0.5rem 0; }
.unread-badge { margin-left: 0.4rem; font-size: 0.875rem; color: var(--ion-color-primary); font-weight: 600; }
</style>
