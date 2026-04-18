<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonButton, IonChip, IonIcon } from '@ionic/vue';
import { timeOutline, radioButtonOnOutline } from 'ionicons/icons';
import { useTournamentStore } from '../stores/tournament.store';

const props = defineProps<{ clubId: string }>();
const router = useRouter();
const tstore = useTournamentStore();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  if (!tstore.tournaments.length) {
    await tstore.fetchTournaments({ scope: 'club' });
  }
  timer = setInterval(() => { now.value = Date.now(); }, 60_000);
});

onUnmounted(() => { if (timer) clearInterval(timer); });

const tournament = computed(() => {
  const candidates = tstore.getByClub(props.clubId, ['active', 'upcoming']);
  const active = candidates.find(t => t.status === 'active');
  if (active) return active;
  return candidates
    .filter(t => t.status === 'upcoming')
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0] ?? null;
});

const countdownText = computed(() => {
  const t = tournament.value;
  if (!t || t.status !== 'upcoming') return '';
  const diffMs = new Date(t.starts_at).getTime() - now.value;
  if (diffMs <= 0) return 'Starting now';
  const totalMin = Math.floor(diffMs / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `Starts in ${d}d ${h}h`;
  if (h > 0) return `Starts in ${h}h ${m}m`;
  return `Starts in ${m}m`;
});

function enterGame() {
  if (tournament.value) router.push(`/tournaments/${tournament.value.id}`);
}
</script>

<template>
  <div v-if="tournament" class="active-tournament-banner" role="region" aria-label="Active tournament">
    <div class="banner-left">
      <div class="banner-title-row">
        <span class="banner-name">{{ tournament.name }}</span>
        <IonChip
          :color="tournament.status === 'active' ? 'success' : 'warning'"
          class="banner-status"
        >
          <IonIcon
            v-if="tournament.status === 'active'"
            :icon="radioButtonOnOutline"
            class="status-icon pulse"
          />
          <IonIcon v-else :icon="timeOutline" class="status-icon" />
          <span>{{ tournament.status === 'active' ? 'Live now' : countdownText }}</span>
        </IonChip>
      </div>
      <div v-if="tournament.status === 'active'" class="banner-sub">
        Trading is open — submit positions and track the leaderboard.
      </div>
      <div v-else class="banner-sub">
        Draft your roster and be ready when the sprint opens.
      </div>
    </div>
    <IonButton size="default" color="primary" @click="enterGame" class="enter-cta">
      ENTER GAME
    </IonButton>
  </div>
</template>

<style scoped>
.active-tournament-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  margin-bottom: 16px;
  border-radius: 10px;
  background: linear-gradient(90deg, rgba(88, 86, 214, 0.12) 0%, rgba(52, 199, 89, 0.08) 100%);
  border: 1px solid rgba(88, 86, 214, 0.35);
}

.banner-left {
  flex: 1;
  min-width: 0;
}

.banner-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.banner-name {
  font-weight: 600;
  font-size: 1.05rem;
}

.banner-status {
  height: 24px;
  font-size: 0.8rem;
}

.status-icon {
  font-size: 0.9rem;
  margin-right: 4px;
}

.banner-sub {
  margin-top: 4px;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.enter-cta {
  flex-shrink: 0;
  --padding-start: 18px;
  --padding-end: 18px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.pulse {
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (max-width: 600px) {
  .active-tournament-banner {
    flex-direction: column;
    align-items: stretch;
  }
  .enter-cta {
    width: 100%;
  }
}
</style>
