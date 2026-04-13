<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote, IonSegment, IonSegmentButton, IonLabel } from '@ionic/vue';
import { useTournamentStore } from '../stores/tournament.store';

const store = useTournamentStore();
const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string);
const tab = ref<'leaderboard' | 'positions' | 'trade' | 'info'>('leaderboard');
const tradeSymbol = ref('');
const tradeDirection = ref<'long' | 'short'>('long');
const tradeQuantity = ref(1);
const inviteToken = ref('');
const showInvite = ref(false);

onMounted(async () => {
  await store.fetchTournament(id.value);
  await store.fetchLeaderboard(id.value);
  await store.fetchPositions(id.value, 'open');
});

async function queueTrade() {
  if (!tradeSymbol.value || tradeQuantity.value <= 0) return;
  try {
    await store.queueTrade(id.value, {
      symbol: tradeSymbol.value.toUpperCase(),
      direction: tradeDirection.value,
      quantity: tradeQuantity.value,
    });
    tradeSymbol.value = '';
    tradeQuantity.value = 1;
    await store.fetchPositions(id.value, 'open');
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : String(e));
  }
}

async function closePos(positionId: string) {
  await store.closePosition(id.value, positionId);
  await store.fetchPositions(id.value, 'open');
  await store.fetchLeaderboard(id.value);
}

async function generateInvite() {
  const result = await store.createInvite(id.value) as { token: string };
  inviteToken.value = `${window.location.origin}/tournaments/invite/${result.token}`;
  showInvite.value = true;
}

function copyInvite() {
  navigator.clipboard.writeText(inviteToken.value);
}

function typeLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
</script>

<template>
  <div class="detail-page" v-if="store.activeTournament">
    <div class="page-header">
      <div>
        <h1>{{ store.activeTournament.name }}</h1>
        <div class="meta">
          <IonChip :color="store.activeTournament.status === 'active' ? 'success' : 'medium'">{{ store.activeTournament.status }}</IonChip>
          <IonChip color="tertiary">{{ typeLabel(store.activeTournament.tournament_type) }}</IonChip>
        </div>
      </div>
      <div class="actions">
        <IonButton v-if="store.activeTournament.scope === 'invitation'" size="small" fill="outline" @click="generateInvite">
          Share Invite Link
        </IonButton>
        <IonButton v-if="store.activeTournament.status === 'completed'" size="small" @click="router.push(`/tournaments/${id}/results`)">
          View Results
        </IonButton>
        <IonButton v-if="store.activeTournament.channel_id" size="small" fill="outline"
          @click="router.push(`/messages/${store.activeTournament.channel_id}`)">
          Chat
        </IonButton>
      </div>
    </div>

    <div v-if="showInvite" class="invite-box">
      <input :value="inviteToken" readonly class="invite-input" />
      <IonButton size="small" @click="copyInvite">Copy</IonButton>
    </div>

    <p class="disclaimer">
      Divinr is an AI analysis game. Virtual portfolios use simulated trades for educational and entertainment purposes. Not investment advice.
    </p>

    <IonSegment v-model="tab">
      <IonSegmentButton value="leaderboard"><IonLabel>Leaderboard</IonLabel></IonSegmentButton>
      <IonSegmentButton value="positions"><IonLabel>My Positions</IonLabel></IonSegmentButton>
      <IonSegmentButton value="trade"><IonLabel>Trade</IonLabel></IonSegmentButton>
      <IonSegmentButton value="info"><IonLabel>Info</IonLabel></IonSegmentButton>
    </IonSegment>

    <!-- Leaderboard Tab -->
    <div v-if="tab === 'leaderboard'" class="tab-content">
      <table class="leaderboard-table" v-if="store.leaderboard.length > 0">
        <thead><tr><th>Rank</th><th>Player</th><th>Return %</th><th>PnL</th><th>Win Rate</th><th>Sharpe</th></tr></thead>
        <tbody>
          <tr v-for="entry in store.leaderboard" :key="entry.user_id">
            <td>{{ entry.rank }}</td>
            <td>{{ entry.display_name || 'Player' }}</td>
            <td :class="entry.return_pct >= 0 ? 'positive' : 'negative'">{{ entry.return_pct }}%</td>
            <td :class="entry.total_pnl >= 0 ? 'positive' : 'negative'">${{ entry.total_pnl.toLocaleString() }}</td>
            <td>{{ entry.win_rate }}%</td>
            <td>{{ entry.sharpe_ratio ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">No players yet.</p>
    </div>

    <!-- Positions Tab -->
    <div v-if="tab === 'positions'" class="tab-content">
      <div v-if="store.positions.length === 0" class="empty">No open positions.</div>
      <IonCard v-for="pos in store.positions" :key="pos.id" class="position-card">
        <IonCardContent>
          <div class="pos-row">
            <strong>{{ pos.symbol }}</strong>
            <IonChip :color="pos.direction === 'long' ? 'success' : 'danger'">{{ pos.direction }}</IonChip>
            <span>Qty: {{ pos.quantity }}</span>
            <span>Entry: ${{ pos.entry_price }}</span>
            <span :class="pos.unrealized_pnl >= 0 ? 'positive' : 'negative'">
              PnL: ${{ Number(pos.unrealized_pnl).toFixed(2) }}
            </span>
            <IonButton size="small" fill="outline" color="danger" @click="closePos(pos.id)">Close</IonButton>
          </div>
        </IonCardContent>
      </IonCard>
    </div>

    <!-- Trade Tab -->
    <div v-if="tab === 'trade'" class="tab-content">
      <IonCard v-if="store.activeTournament.status === 'active'">
        <IonCardHeader><IonCardTitle>Queue Trade</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div class="trade-form">
            <input v-model="tradeSymbol" placeholder="Symbol (e.g. AAPL)" class="trade-input" />
            <select v-model="tradeDirection" class="trade-input">
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            <input v-model.number="tradeQuantity" type="number" min="1" placeholder="Quantity" class="trade-input" />
            <IonButton @click="queueTrade">Queue Trade</IonButton>
          </div>
        </IonCardContent>
      </IonCard>
      <p v-else class="empty">Trades can only be queued during active games.</p>
    </div>

    <!-- Info Tab -->
    <div v-if="tab === 'info'" class="tab-content">
      <IonCard>
        <IonCardContent>
          <p v-if="store.activeTournament.description">{{ store.activeTournament.description }}</p>
          <div class="info-grid">
            <div><strong>Virtual Balance:</strong> ${{ Number(store.activeTournament.starting_balance).toLocaleString() }}</div>
            <div><strong>Type:</strong> {{ typeLabel(store.activeTournament.tournament_type) }}</div>
            <div><strong>Scope:</strong> {{ store.activeTournament.scope }}</div>
            <div><strong>Start:</strong> {{ new Date(store.activeTournament.starts_at).toLocaleString() }}</div>
            <div><strong>End:</strong> {{ new Date(store.activeTournament.ends_at).toLocaleString() }}</div>
          </div>
        </IonCardContent>
      </IonCard>
    </div>
  </div>
</template>

<style scoped>
.detail-page { padding: 1rem; max-width: 900px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.page-header h1 { margin: 0; font-size: 1.4rem; }
.meta { display: flex; gap: 0.25rem; margin-top: 0.25rem; }
.actions { display: flex; gap: 0.5rem; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.tab-content { margin-top: 1rem; }
.leaderboard-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.leaderboard-table th, .leaderboard-table td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--ion-color-light-shade); }
.positive { color: var(--ion-color-success); }
.negative { color: var(--ion-color-danger); }
.empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
.pos-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
.trade-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.trade-input { padding: 0.5rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem; }
.invite-box { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.invite-input { flex: 1; padding: 0.5rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; font-size: 0.85rem; }
.position-card { margin-bottom: 0.5rem; }
</style>
