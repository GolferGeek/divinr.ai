<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote, IonSegment, IonSegmentButton, IonLabel } from '@ionic/vue';
import { useClubStore } from '../stores/club.store';
import { useCanWrite } from '../composables/useCanWrite';

const store = useClubStore();
const { canWrite } = useCanWrite();
const router = useRouter();
const tab = ref<'mine' | 'discover'>('mine');
const discoverSort = ref('ranking_score');

onMounted(() => { store.fetchMyClubs(); store.fetchPublicClubs(); });

function changeSortDiscover() { store.fetchPublicClubs(); }
</script>

<template>
  <div class="clubs-page">
    <div class="page-header">
      <h1>Investment Learning Clubs</h1>
      <div class="header-actions">
        <IonButton size="small" fill="outline" @click="router.push('/clubs/rankings')">Rankings</IonButton>
        <IonButton v-if="canWrite" size="small" @click="router.push('/clubs/create')">Create Club</IonButton>
      </div>
    </div>
    <p class="disclaimer">Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice.</p>

    <IonSegment v-model="tab">
      <IonSegmentButton value="mine"><IonLabel>My Clubs</IonLabel></IonSegmentButton>
      <IonSegmentButton value="discover"><IonLabel>Discover</IonLabel></IonSegmentButton>
    </IonSegment>

    <div v-if="tab === 'mine'" class="tab-content">
      <div v-if="store.myClubs.length === 0" class="empty">No clubs yet. Create one or join with an invite code!</div>
      <IonCard v-for="c in store.myClubs" :key="c.id" @click="router.push(`/clubs/${c.id}`)">
        <IonCardHeader>
          <IonCardTitle>{{ c.name }}</IonCardTitle>
          <IonChip color="tertiary">{{ c.my_role }}</IonChip>
        </IonCardHeader>
        <IonCardContent>
          <IonNote>{{ c.member_count }} member{{ c.member_count !== 1 ? 's' : '' }}</IonNote>
        </IonCardContent>
      </IonCard>
    </div>

    <div v-if="tab === 'discover'" class="tab-content">
      <div v-if="store.publicClubs.length === 0" class="empty">No public clubs yet.</div>
      <IonCard v-for="c in store.publicClubs" :key="c.id" @click="router.push(`/clubs/${c.id}`)">
        <IonCardHeader><IonCardTitle>{{ c.name }}</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <IonNote>{{ c.member_count }} members · {{ c.tournament_count }} tournaments</IonNote>
        </IonCardContent>
      </IonCard>
    </div>
  </div>
</template>

<style scoped>
.clubs-page { padding: 1rem; max-width: 900px; }
.page-header { display: flex; justify-content: space-between; align-items: center; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.tab-content { margin-top: 1rem; }
.empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
ion-card { cursor: pointer; }
</style>
