<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardContent, IonChip, IonNote, IonButton } from '@ionic/vue';
import { useClubStore } from '../stores/club.store';
import RankCell from '../components/RankCell.vue';

const store = useClubStore();
const router = useRouter();
const sortBy = ref('ranking_score');

onMounted(() => { store.fetchLeaderboard(sortBy.value); });

function changeSort() { store.fetchLeaderboard(sortBy.value); }

interface RankedClub {
  id: string; name: string; ranking_position: number; ranking_score: number;
  badges: Array<{ badge: string; earned_at: string }>; member_count: number;
  avg_return_pct: number; club_win_rate: number; tournament_count: number;
  prev_rank: number | null; rank_delta: number | null;
}

function badgeColor(badge: string): string {
  const colors: Record<string, string> = { top_10_pct: 'warning', top_25_pct: 'medium', rising_club: 'success', most_improved: 'primary' };
  return colors[badge] ?? 'medium';
}

function badgeLabel(badge: string): string {
  const labels: Record<string, string> = { top_10_pct: 'Top 10%', top_25_pct: 'Top 25%', rising_club: 'Rising', most_improved: 'Most Improved' };
  return labels[badge] ?? badge;
}
</script>

<template>
  <div class="rankings-page">
    <div class="page-header">
      <h1>Club Rankings</h1>
      <select v-model="sortBy" @change="changeSort" class="sort-select">
        <option value="ranking_score">Best Overall</option>
        <option value="return_pct">Best Return</option>
        <option value="win_rate">Best Win Rate</option>
        <option value="member_count">Most Members</option>
      </select>
    </div>

    <table class="rankings-table" v-if="(store.leaderboard as RankedClub[]).length > 0">
      <thead><tr><th>#</th><th>Club</th><th>Score</th><th>Return</th><th>Win Rate</th><th>Members</th><th>Badges</th><th></th></tr></thead>
      <tbody>
        <tr v-for="club in (store.leaderboard as RankedClub[])" :key="club.id" @click="router.push(`/clubs/${club.id}`)">
          <td class="rank"><RankCell :rank="club.ranking_position" :delta="club.rank_delta ?? null" /></td>
          <td><strong>{{ club.name }}</strong></td>
          <td>{{ club.ranking_score.toFixed(1) }}</td>
          <td :class="club.avg_return_pct >= 0 ? 'positive' : 'negative'">{{ club.avg_return_pct }}%</td>
          <td>{{ club.club_win_rate }}%</td>
          <td>{{ club.member_count }}</td>
          <td>
            <IonChip v-for="b in club.badges" :key="b.badge" :color="badgeColor(b.badge)" size="small">{{ badgeLabel(b.badge) }}</IonChip>
          </td>
          <td><IonButton size="small" fill="clear" @click.stop="router.push(`/clubs/compare?a=${club.id}`)">Compare</IonButton></td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">No ranked clubs yet. Public clubs with tournament history appear here.</div>
  </div>
</template>

<style scoped>
.rankings-page { padding: 1rem; max-width: 1000px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.sort-select { padding: 0.4rem; border-radius: 4px; border: 1px solid var(--ion-color-light-shade); }
.rankings-table { width: 100%; border-collapse: collapse; }
.rankings-table th, .rankings-table td { padding: 0.6rem; text-align: left; border-bottom: 1px solid var(--ion-color-light-shade); }
.rankings-table tr { cursor: pointer; }
.rankings-table tr:hover { background: var(--ion-color-light); }
.rank { font-weight: 700; font-size: 1.1rem; }
.positive { color: var(--ion-color-success); }
.negative { color: var(--ion-color-danger); }
.empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
</style>
