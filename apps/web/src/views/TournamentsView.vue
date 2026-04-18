<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote } from '@ionic/vue';
import { useTournamentStore } from '../stores/tournament.store';
import { useCanWrite } from '../composables/useCanWrite';

const store = useTournamentStore();
const { canWrite } = useCanWrite();
const router = useRouter();
const scopeFilter = ref<string>('');
const statusFilter = ref<string>('');
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  store.fetchTournaments();
  tick = setInterval(() => { now.value = Date.now(); }, 60_000);
});

onUnmounted(() => { if (tick) clearInterval(tick); });

function applyFilters() {
  store.fetchTournaments({
    scope: scopeFilter.value || undefined,
    status: statusFilter.value || undefined,
  });
}

function enter(id: string) {
  store.enterTournament(id).then(() => {
    router.push(`/tournaments/${id}`);
  }).catch((e: Error) => alert(e.message));
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function typeLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatCountdown(startIso: string): string {
  const diffMs = new Date(startIso).getTime() - now.value;
  if (diffMs <= 0) return 'Starting now';
  const totalMin = Math.floor(diffMs / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `Starts in ${d}d ${h}h`;
  if (h > 0) return `Starts in ${h}h ${m}m`;
  return `Starts in ${m}m`;
}

function pluralPlayers(n: number): string {
  return `${n} ${n === 1 ? 'player' : 'players'}`;
}
</script>

<template>
  <div class="tournaments-page">
    <div class="page-header">
      <h1>Tournaments</h1>
      <IonButton v-if="canWrite" size="small" @click="router.push('/tournaments/create')">Create Tournament</IonButton>
    </div>

    <p class="disclaimer">
      Divinr is an AI analysis game. Virtual portfolios only.
      <router-link to="/terms" class="learn-more">Learn more</router-link>
    </p>

    <div class="filters">
      <select v-model="scopeFilter" @change="applyFilters">
        <option value="">All Scopes</option>
        <option value="system">System</option>
        <option value="invitation">Invitation</option>
      </select>
      <select v-model="statusFilter" @change="applyFilters">
        <option value="">All Statuses</option>
        <option value="upcoming">Upcoming</option>
        <option value="active">Active</option>
        <option value="completed">Completed</option>
      </select>
    </div>

    <div v-if="store.loading" class="loading">Loading tournaments...</div>

    <div v-else-if="store.tournaments.length === 0" class="empty">
      No tournaments found. Create one to get started!
    </div>

    <div v-else class="tournament-list">
      <IonCard v-for="t in store.tournaments" :key="t.id" class="tournament-card" @click="router.push(`/tournaments/${t.id}`)">
        <IonCardHeader>
          <IonCardTitle>{{ t.name }}</IonCardTitle>
          <div class="card-meta">
            <IonChip :color="t.status === 'active' ? 'success' : t.status === 'upcoming' ? 'warning' : 'medium'">
              {{ t.status }}
            </IonChip>
            <IonChip color="tertiary">{{ typeLabel(t.tournament_type) }}</IonChip>
            <IonChip>{{ t.scope }}</IonChip>
          </div>
        </IonCardHeader>
        <IonCardContent>
          <p v-if="t.description">{{ t.description }}</p>
          <div v-if="t.status === 'upcoming'" class="countdown-line">{{ formatCountdown(t.starts_at) }}</div>
          <div class="roster-line">
            <span class="roster-text">{{ pluralPlayers(t.player_count ?? 0) }}</span>
          </div>
          <p class="prize-line">Prize: Bragging rights + Sprint Champion badge on your profile.</p>
          <div class="card-details">
            <IonNote>Virtual Balance: ${{ Number(t.starting_balance).toLocaleString() }}</IonNote>
            <IonNote>{{ relativeDate(t.starts_at) }} - {{ relativeDate(t.ends_at) }}</IonNote>
          </div>
          <IonButton v-if="canWrite && (t.status === 'upcoming' || t.status === 'active')" size="small" fill="outline" @click.stop="enter(t.id)">
            Enter Game
          </IonButton>
        </IonCardContent>
      </IonCard>
    </div>
  </div>
</template>

<style scoped>
.tournaments-page { padding: 1rem; max-width: 900px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.page-header h1 { margin: 0; font-size: 1.5rem; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.learn-more { color: inherit; text-decoration: underline; font-style: normal; margin-left: 0.25rem; }
.learn-more:hover { color: var(--ion-color-primary); }
.filters { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.filters select { padding: 0.4rem; border-radius: 4px; border: 1px solid var(--ion-color-light-shade); }
.loading, .empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
.tournament-card { cursor: pointer; }
.card-meta { display: flex; gap: 0.25rem; margin-top: 0.5rem; }
.card-details { display: flex; justify-content: space-between; margin: 0.5rem 0; }
.countdown-line { font-size: 0.85rem; font-weight: 500; color: var(--ion-color-warning-shade); margin: 0.35rem 0; }
.roster-line { display: flex; align-items: center; gap: 0.5rem; margin: 0.35rem 0; font-size: 0.85rem; color: var(--ion-color-medium); }
.roster-text { font-weight: 500; }
.prize-line { font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.35rem 0; font-style: italic; }
</style>
