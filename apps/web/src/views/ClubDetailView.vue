<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote, IonSegment, IonSegmentButton, IonLabel } from '@ionic/vue';
import { useClubStore } from '../stores/club.store';

const store = useClubStore();
const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string);
const tab = ref<'members' | 'tournaments' | 'analysts' | 'activities' | 'analytics'>('members');
const inviteCode = ref('');
const showInvite = ref(false);

onMounted(async () => {
  await store.fetchClub(id.value);
  await store.fetchMembers(id.value);
});

function loadTab(t: string) {
  tab.value = t as typeof tab.value;
  if (t === 'analysts') store.fetchAnalysts(id.value);
  if (t === 'activities') { store.fetchChallenges(id.value); store.fetchPolls(id.value); store.fetchJournals(id.value); }
  if (t === 'analytics') store.fetchAnalytics(id.value);
}

async function generateInvite() {
  const result = await store.createInvite(id.value) as { token: string };
  inviteCode.value = `${window.location.origin}/clubs/invite/${result.token}`;
  showInvite.value = true;
}

function copyCode() { navigator.clipboard.writeText(store.activeClub?.invite_code ?? ''); }
function copyInvite() { navigator.clipboard.writeText(inviteCode.value); }
</script>

<template>
  <div class="detail-page" v-if="store.activeClub">
    <div class="page-header">
      <div>
        <h1>{{ store.activeClub.name }}</h1>
        <IonNote>{{ store.activeClub.member_count }} members · Code: <strong>{{ store.activeClub.invite_code }}</strong>
          <IonButton size="small" fill="clear" @click="copyCode">Copy</IonButton>
        </IonNote>
      </div>
      <div class="actions">
        <IonButton size="small" fill="outline" @click="generateInvite">Invite</IonButton>
        <IonButton v-if="store.activeClub.channel_id" size="small" fill="outline"
          @click="router.push(`/messages/${store.activeClub.channel_id}`)">Chat</IonButton>
      </div>
    </div>

    <div v-if="showInvite" class="invite-box">
      <input :value="inviteCode" readonly class="invite-input" />
      <IonButton size="small" @click="copyInvite">Copy</IonButton>
    </div>

    <p class="disclaimer">Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice.</p>

    <IonSegment :value="tab" @ionChange="loadTab(($event.detail.value ?? 'members') as string)">
      <IonSegmentButton value="members"><IonLabel>Members</IonLabel></IonSegmentButton>
      <IonSegmentButton value="analysts"><IonLabel>Analysts</IonLabel></IonSegmentButton>
      <IonSegmentButton value="activities"><IonLabel>Activities</IonLabel></IonSegmentButton>
      <IonSegmentButton value="analytics"><IonLabel>Analytics</IonLabel></IonSegmentButton>
    </IonSegment>

    <!-- Members Tab -->
    <div v-if="tab === 'members'" class="tab-content">
      <IonCard v-for="m in store.members" :key="m.id">
        <IonCardContent class="member-row">
          <strong>{{ m.display_name || m.user_id.slice(0, 8) }}</strong>
          <IonChip :color="m.role === 'owner' ? 'primary' : m.role === 'admin' ? 'tertiary' : 'medium'" size="small">{{ m.role }}</IonChip>
        </IonCardContent>
      </IonCard>
    </div>

    <!-- Analysts Tab -->
    <div v-if="tab === 'analysts'" class="tab-content">
      <IonButton v-if="store.activeClub.my_role === 'owner' || store.activeClub.my_role === 'admin'" size="small" fill="outline" class="mb">Create Analyst</IonButton>
      <div v-if="store.analysts.length === 0" class="empty">No club analysts yet.</div>
      <IonCard v-for="a in store.analysts" :key="a.analyst_id">
        <IonCardContent><strong>{{ a.display_name }}</strong> <IonNote>{{ a.slug }}</IonNote></IonCardContent>
      </IonCard>
    </div>

    <!-- Activities Tab -->
    <div v-if="tab === 'activities'" class="tab-content">
      <h3>Prediction Challenges</h3>
      <div v-if="(store.challenges as Array<{id:string;symbol:string;status:string}>).length === 0" class="empty">No challenges yet.</div>
      <IonCard v-for="c in (store.challenges as Array<{id:string;symbol:string;status:string;response_count:number}>)" :key="c.id">
        <IonCardContent>
          <strong>{{ c.symbol }}</strong> <IonChip size="small">{{ c.status }}</IonChip>
          <IonNote>{{ c.response_count }} responses</IonNote>
        </IonCardContent>
      </IonCard>

      <h3>Consensus Polls</h3>
      <div v-if="(store.polls as Array<{id:string}>).length === 0" class="empty">No polls yet.</div>
      <IonCard v-for="p in (store.polls as Array<{id:string;symbol:string;status:string;bull_count:number;bear_count:number;neutral_count:number}>)" :key="p.id">
        <IonCardContent>
          <strong>{{ p.symbol }}</strong> <IonChip size="small">{{ p.status }}</IonChip>
          <IonNote>Bull: {{ p.bull_count }} · Bear: {{ p.bear_count }} · Neutral: {{ p.neutral_count }}</IonNote>
        </IonCardContent>
      </IonCard>

      <h3>Strategy Journals</h3>
      <div v-if="(store.journals as Array<{id:string}>).length === 0" class="empty">No journal entries yet.</div>
      <IonCard v-for="j in (store.journals as Array<{id:string;entry:string;display_name?:string;symbol?:string;created_at:string}>)" :key="j.id">
        <IonCardContent>
          <strong>{{ j.display_name || 'Member' }}</strong> {{ j.symbol ? `on ${j.symbol}` : '' }}
          <p>{{ j.entry }}</p>
        </IonCardContent>
      </IonCard>
    </div>

    <!-- Analytics Tab -->
    <div v-if="tab === 'analytics'" class="tab-content">
      <div v-if="!store.analytics" class="empty">Loading analytics...</div>
      <div v-else class="analytics-grid">
        <IonCard><IonCardContent><div class="stat-label">Win Rate</div><div class="stat-value">{{ (store.analytics as Record<string,unknown>).club_win_rate }}%</div></IonCardContent></IonCard>
        <IonCard><IonCardContent><div class="stat-label">Avg Return</div><div class="stat-value">{{ (store.analytics as Record<string,unknown>).avg_return_pct }}%</div></IonCardContent></IonCard>
        <IonCard><IonCardContent><div class="stat-label">Club Style</div><div class="stat-value">{{ (store.analytics as Record<string,unknown>).club_style }}</div></IonCardContent></IonCard>
        <IonCard><IonCardContent><div class="stat-label">Tournaments</div><div class="stat-value">{{ (store.analytics as Record<string,unknown>).tournament_count }}</div></IonCardContent></IonCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-page { padding: 1rem; max-width: 900px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.actions { display: flex; gap: 0.5rem; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.tab-content { margin-top: 1rem; }
.empty { text-align: center; padding: 1rem; color: var(--ion-color-medium); }
.member-row { display: flex; align-items: center; gap: 0.5rem; }
.invite-box { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.invite-input { flex: 1; padding: 0.5rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; font-size: 0.85rem; }
.mb { margin-bottom: 1rem; }
.analytics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.stat-label { font-size: 0.8rem; color: var(--ion-color-medium); }
.stat-value { font-size: 1.3rem; font-weight: 700; }
h3 { margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 1.1rem; }
</style>
