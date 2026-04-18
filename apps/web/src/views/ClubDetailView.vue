<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote, IonSegment, IonSegmentButton, IonLabel, IonIcon, IonPopover, IonContent, IonList, IonItem } from '@ionic/vue';
import { trophyOutline, journalOutline, chatbubblesOutline, bulbOutline, ellipsisHorizontalOutline, personAddOutline } from 'ionicons/icons';
import { useClubStore } from '../stores/club.store';
import { useCurriculumStore } from '../stores/curriculum.store';
import { useMentorStore } from '../stores/mentor.store';
import ClubPreviewPanel from '../components/ClubPreviewPanel.vue';
import ActiveTournamentBanner from '../components/ActiveTournamentBanner.vue';
import MemberProfileDrawer from '../components/MemberProfileDrawer.vue';
import { formatBadge } from '../utils/format';

const store = useClubStore();
const curriculumStore = useCurriculumStore();
const mentorStore = useMentorStore();
const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string);
const isMember = computed(() => !!store.activeClub?.my_role);
const isClubAdmin = computed(() => store.activeClub?.my_role === 'owner' || store.activeClub?.my_role === 'admin');
type ClubTab = 'members' | 'tournaments' | 'analysts' | 'activities' | 'analytics' | 'curriculum' | 'mentoring';
const VALID_TABS: ReadonlyArray<ClubTab> = ['members', 'tournaments', 'analysts', 'activities', 'analytics', 'curriculum', 'mentoring'];
const initialTab: ClubTab = (() => {
  const q = route.query.tab;
  const v = Array.isArray(q) ? q[0] : q;
  return typeof v === 'string' && (VALID_TABS as ReadonlyArray<string>).includes(v) ? (v as ClubTab) : 'activities';
})();
const tab = ref<ClubTab>(initialTab);
const feedbackRatings = ref<Record<string, number>>({});
const feedbackComments = ref<Record<string, string>>({});
const selectedMentorForPairing = ref<Record<string, string>>({});
const inviteCode = ref('');
const showInvite = ref(false);

onMounted(async () => {
  await store.fetchClub(id.value);
  if (isMember.value) {
    await store.fetchMembers(id.value);
    mentorStore.fetchLeaderboard(id.value);
    loadTab(tab.value);
  }
});

function loadTab(t: string) {
  tab.value = t as ClubTab;
  if (route.query.tab !== t) {
    router.replace({ query: { ...route.query, tab: t } });
  }
  if (t === 'analysts') store.fetchAnalysts(id.value);
  if (t === 'activities') {
    store.fetchChallenges(id.value); store.fetchPolls(id.value); store.fetchJournals(id.value);
    if (store.activeClub?.unread_count && store.activeClub.unread_count > 0) {
      store.markActivitiesViewed(id.value);
    }
  }
  if (t === 'analytics') store.fetchAnalytics(id.value);
  if (t === 'curriculum') curriculumStore.fetchCurricula(id.value);
  if (t === 'mentoring') { mentorStore.fetchStatus(id.value); mentorStore.fetchLeaderboard(id.value); mentorStore.checkEligibility(id.value); mentorStore.fetchPendingFeedback(id.value); }
}

async function applyMentor() {
  try { await mentorStore.applyToMentor(id.value); } catch { /* error in store */ }
}
async function requestMentorAction() {
  try { await mentorStore.requestMentor(id.value); } catch { /* error in store */ }
}
async function submitFeedbackAction(pairingId: string) {
  const rating = feedbackRatings.value[pairingId] ?? 0;
  if (rating < 1) return;
  try {
    await mentorStore.submitFeedback(id.value, pairingId, rating, feedbackComments.value[pairingId] || undefined);
    delete feedbackRatings.value[pairingId];
    delete feedbackComments.value[pairingId];
  } catch { /* error in store */ }
}
async function pairMentorAction(menteeUserId: string) {
  const mentorId = selectedMentorForPairing.value[menteeUserId];
  if (!mentorId) return;
  try {
    await mentorStore.pairMentor(id.value, mentorId, menteeUserId);
    delete selectedMentorForPairing.value[menteeUserId];
  } catch { /* error in store */ }
}

async function generateInvite() {
  const result = await store.createInvite(id.value) as { token: string };
  inviteCode.value = `${window.location.origin}/clubs/invite/${result.token}`;
  showInvite.value = true;
}

function copyCode() { navigator.clipboard.writeText(store.activeClub?.invite_code ?? ''); }
function copyInvite() { navigator.clipboard.writeText(inviteCode.value); }

const drawerOpen = ref(false);
const drawerUserId = ref<string | null>(null);
function openMember(userId: string) { drawerUserId.value = userId; drawerOpen.value = true; }
function closeDrawer() { drawerOpen.value = false; drawerUserId.value = null; }

function startChallenge() { console.info('[coming-soon] start challenge'); }
function startJournal() { console.info('[coming-soon] start journal'); }
function startPoll() { console.info('[coming-soon] start poll'); }

function fmtAnalyticsPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v}%`;
}
</script>

<template>
  <div class="detail-page" v-if="store.activeClub">
    <!-- Non-member preview -->
    <template v-if="!isMember">
      <div class="page-header">
        <div>
          <h1>{{ store.activeClub.name }}</h1>
        </div>
      </div>
      <p class="disclaimer">Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice.</p>
      <ClubPreviewPanel :club="store.activeClub as any" />
    </template>

    <!-- Full member view -->
    <template v-else>
    <div class="page-header">
      <div>
        <h1>{{ store.activeClub.name }}</h1>
        <IonNote>{{ store.activeClub.member_count }} members · Code: <strong>{{ store.activeClub.invite_code }}</strong>
          <IonButton size="small" fill="clear" @click="copyCode">Copy</IonButton>
        </IonNote>
      </div>
      <div class="actions actions-desktop">
        <IonButton size="small" fill="outline" @click="generateInvite">Invite</IonButton>
        <IonButton v-if="store.activeClub.channel_id" size="small" fill="outline"
          @click="router.push(`/messages/${store.activeClub.channel_id}`)">Chat</IonButton>
      </div>
      <div class="actions-mobile">
        <IonButton id="club-actions-trigger" size="small" fill="outline" aria-label="Club actions">
          <IonIcon slot="icon-only" :icon="ellipsisHorizontalOutline" />
        </IonButton>
        <IonPopover trigger="club-actions-trigger" trigger-action="click" dismiss-on-select>
          <IonContent>
            <IonList>
              <IonItem button :detail="false" @click="generateInvite">
                <IonIcon slot="start" :icon="personAddOutline" />
                <IonLabel>Invite</IonLabel>
              </IonItem>
              <IonItem v-if="store.activeClub.channel_id" button :detail="false"
                @click="router.push(`/messages/${store.activeClub.channel_id}`)">
                <IonIcon slot="start" :icon="chatbubblesOutline" />
                <IonLabel>Chat</IonLabel>
              </IonItem>
            </IonList>
          </IonContent>
        </IonPopover>
      </div>
    </div>

    <div v-if="showInvite" class="invite-box">
      <input :value="inviteCode" readonly class="invite-input" />
      <IonButton size="small" @click="copyInvite">Copy</IonButton>
    </div>

    <p class="disclaimer">Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice.</p>

    <ActiveTournamentBanner :clubId="id" />

    <IonSegment class="club-tabs" scrollable :value="tab" @ionChange="loadTab(($event.detail.value ?? 'members') as string)">
      <IonSegmentButton value="members"><IonLabel>Members</IonLabel></IonSegmentButton>
      <IonSegmentButton value="analysts"><IonLabel>Analysts</IonLabel></IonSegmentButton>
      <IonSegmentButton value="activities">
        <IonLabel>
          Activities<span
            v-if="store.activeClub?.unread_count && store.activeClub.unread_count > 0"
            class="unread-badge"
            :aria-label="`${store.activeClub.unread_count} unread activities`"
          >({{ formatBadge(store.activeClub.unread_count) }})</span>
        </IonLabel>
      </IonSegmentButton>
      <IonSegmentButton value="analytics"><IonLabel>Analytics</IonLabel></IonSegmentButton>
      <IonSegmentButton value="curriculum"><IonLabel>Curriculum</IonLabel></IonSegmentButton>
      <IonSegmentButton value="mentoring"><IonLabel>Mentoring</IonLabel></IonSegmentButton>
    </IonSegment>

    <!-- Members Tab -->
    <div v-if="tab === 'members'" class="tab-content">
      <IonCard v-for="m in store.members" :key="m.id" class="clickable-member" @click="openMember(m.user_id)">
        <IonCardContent class="member-row">
          <div class="member-avatar">{{ (m.display_name ?? m.user_id).slice(0, 1).toUpperCase() }}</div>
          <strong class="member-name">{{ m.display_name || m.user_id.slice(0, 8) }}</strong>
          <IonChip :color="m.role === 'owner' ? 'primary' : m.role === 'admin' ? 'tertiary' : 'medium'" size="small">{{ m.role }}</IonChip>
          <IonChip v-if="mentorStore.leaderboard.some(mt => mt.user_id === m.user_id)" color="success" size="small">Mentor</IonChip>
          <span class="member-chevron">›</span>
        </IonCardContent>
      </IonCard>
    </div>

    <MemberProfileDrawer
      v-if="drawerUserId"
      :open="drawerOpen"
      :club-id="id"
      :user-id="drawerUserId"
      @close="closeDrawer"
    />

    <!-- Analysts Tab -->
    <div v-if="tab === 'analysts'" class="tab-content">
      <p class="explainer">
        Club analysts are shared across every member of this club. You already have access to the base analysts (left nav → AI Analysts) and your own custom analysts. Create a club analyst when you want the whole group to study a specific style together.
      </p>
      <IonButton v-if="isClubAdmin" size="small" fill="outline" class="mb">Create Analyst</IonButton>
      <div v-if="store.analysts.length === 0" class="empty">No club analysts yet.</div>
      <IonCard v-for="a in store.analysts" :key="a.analyst_id">
        <IonCardContent><strong>{{ a.display_name }}</strong> <IonNote>{{ a.slug }}</IonNote></IonCardContent>
      </IonCard>
    </div>

    <!-- Activities Tab -->
    <div v-if="tab === 'activities'" class="tab-content">
      <h3>Prediction Challenges</h3>
      <div v-if="(store.challenges as Array<{id:string;symbol:string;status:string}>).length === 0" class="empty-block">
        <IonIcon :icon="trophyOutline" class="empty-icon" />
        <p class="empty-explainer">Prediction challenges are quick head-to-head calls on a symbol. Owner picks the ticker, members submit a direction, everyone sees the reveal.</p>
        <IonButton size="small" fill="outline" @click="startChallenge">Start a Challenge</IonButton>
      </div>
      <IonCard v-for="c in (store.challenges as Array<{id:string;symbol:string;status:string;response_count:number}>)" :key="c.id">
        <IonCardContent>
          <strong>{{ c.symbol }}</strong> <IonChip size="small">{{ c.status }}</IonChip>
          <IonNote>{{ c.response_count }} responses</IonNote>
        </IonCardContent>
      </IonCard>

      <h3>Strategy Journals</h3>
      <div v-if="(store.journals as Array<{id:string}>).length === 0" class="empty-block">
        <IonIcon :icon="journalOutline" class="empty-icon" />
        <p class="empty-explainer">Journals are short notes members post about their thesis or what they learned. Build the habit of writing down *why* before the market proves you right or wrong.</p>
        <IonButton size="small" fill="outline" @click="startJournal">Write a Journal Entry</IonButton>
      </div>
      <IonCard v-for="j in (store.journals as Array<{id:string;entry:string;display_name?:string;symbol?:string;created_at:string}>)" :key="j.id">
        <IonCardContent>
          <strong>{{ j.display_name || 'Member' }}</strong> {{ j.symbol ? `on ${j.symbol}` : '' }}
          <p>{{ j.entry }}</p>
        </IonCardContent>
      </IonCard>

      <h3>Consensus Polls</h3>
      <div v-if="(store.polls as Array<{id:string}>).length === 0" class="empty-block">
        <IonIcon :icon="chatbubblesOutline" class="empty-icon" />
        <p class="empty-explainer">Consensus polls let the club vote bull/bear/neutral on a ticker. Contrarian picks get spotlighted when the market agrees with you — and not the crowd.</p>
        <IonButton size="small" fill="outline" @click="startPoll">Start a Poll</IonButton>
      </div>
      <IonCard v-for="p in (store.polls as Array<{id:string;symbol:string;status:string;bull_count:number;bear_count:number;neutral_count:number}>)" :key="p.id">
        <IonCardContent>
          <strong>{{ p.symbol }}</strong> <IonChip size="small">{{ p.status }}</IonChip>
          <IonNote>Bull: {{ p.bull_count }} · Bear: {{ p.bear_count }} · Neutral: {{ p.neutral_count }}</IonNote>
        </IonCardContent>
      </IonCard>
    </div>

    <!-- Analytics Tab -->
    <div v-if="tab === 'analytics'" class="tab-content">
      <div class="analytics-header">
        <select class="time-window" disabled title="Time-window filter coming soon">
          <option>All time ▾</option>
        </select>
      </div>
      <div v-if="!store.analytics" class="empty">Loading analytics...</div>
      <div v-else class="analytics-grid">
        <IonCard><IonCardContent>
          <div class="stat-label">Win Rate</div>
          <div class="stat-value">{{ fmtAnalyticsPct((store.analytics as Record<string, unknown>).club_win_rate as number | null) }}</div>
        </IonCardContent></IonCard>
        <IonCard><IonCardContent>
          <div class="stat-label">Avg Return</div>
          <div class="stat-value">{{ fmtAnalyticsPct((store.analytics as Record<string, unknown>).avg_return_pct as number | null) }}</div>
        </IonCardContent></IonCard>
        <IonCard><IonCardContent>
          <div class="stat-label" title="Derived from member trade distribution. Balanced = no single sector > 40%.">
            Club Style
            <IonIcon :icon="bulbOutline" class="info-icon" />
          </div>
          <div class="stat-value">{{ (store.analytics as Record<string,unknown>).club_style || '—' }}</div>
        </IonCardContent></IonCard>
        <IonCard><IonCardContent>
          <div class="stat-label">Tournaments</div>
          <div class="stat-value">{{ (store.analytics as Record<string,unknown>).tournament_count }}</div>
        </IonCardContent></IonCard>
      </div>
    </div>

    <!-- Curriculum Tab -->
    <div v-if="tab === 'curriculum'" class="tab-content">
      <p class="explainer">
        A curriculum is a reading list or module plan your club owner pins. Members see new modules as they're added.
      </p>
      <IonButton v-if="isClubAdmin" size="small" fill="outline" class="mb"
        @click="router.push(`/clubs/${id}/curricula/create`)">Create Curriculum</IonButton>
      <div v-if="curriculumStore.curricula.length === 0" class="empty">No curricula yet.</div>
      <IonCard v-for="c in curriculumStore.curricula" :key="c.id" @click="router.push(`/clubs/${id}/curricula/${c.id}`)" style="cursor:pointer">
        <IonCardHeader>
          <IonCardTitle>{{ c.name }}</IonCardTitle>
        </IonCardHeader>
        <IonCardContent>
          <IonChip :color="c.status === 'active' ? 'success' : c.status === 'draft' ? 'warning' : 'medium'" size="small">{{ c.status }}</IonChip>
          <IonNote>{{ c.week_count }} weeks · {{ c.enrolled_count ?? 0 }} enrolled</IonNote>
        </IonCardContent>
      </IonCard>
    </div>

    <!-- Mentoring Tab -->
    <div v-if="tab === 'mentoring'" class="tab-content">
      <!-- Status Section -->
      <div v-if="mentorStore.status" class="mentoring-status">
        <!-- Active Mentor -->
        <div v-if="mentorStore.status.is_mentor" class="status-card">
          <IonChip color="primary">Mentor</IonChip>
          <IonNote>{{ mentorStore.status.mentees.length }} active mentee(s)</IonNote>
          <IonButton size="small" fill="outline" @click="router.push(`/clubs/${id}/mentoring/dashboard`)">Mentor Dashboard</IonButton>
        </div>

        <!-- Active Mentee -->
        <div v-if="mentorStore.status.is_mentee && mentorStore.status.my_mentor" class="status-card">
          <IonChip color="tertiary">Mentee</IonChip>
          <IonNote>Mentor: <strong>{{ mentorStore.status.my_mentor.mentor_display_name || 'Mentor' }}</strong></IonNote>
          <IonButton v-if="mentorStore.status.my_mentor.dm_channel_id" size="small" fill="outline"
            @click="router.push(`/messages/${mentorStore.status.my_mentor.dm_channel_id}`)">Message Mentor</IonButton>
        </div>

        <!-- Pending Application -->
        <div v-if="mentorStore.status.pending_application" class="status-card">
          <IonChip color="warning">Application Pending</IonChip>
          <IonNote>Waiting for admin approval</IonNote>
        </div>

        <!-- Pending Request -->
        <div v-if="mentorStore.status.pending_request" class="status-card">
          <IonChip color="warning">Mentor Request Pending</IonChip>
        </div>

        <!-- Actions for uninvolved members -->
        <div v-if="!mentorStore.status.is_mentor && !mentorStore.status.pending_application && !mentorStore.status.is_mentee && !mentorStore.status.pending_request" class="action-buttons">
          <IonButton v-if="mentorStore.eligibility?.eligible" size="small" fill="outline" @click="applyMentor">Apply to Mentor</IonButton>
          <IonNote v-else-if="mentorStore.eligibility" class="eligibility-note">
            Not yet eligible: {{ mentorStore.eligibility.reasons.join(', ') }}
          </IonNote>
          <IonButton
            size="small"
            fill="outline"
            :disabled="!!(mentorStore.eligibility && !mentorStore.eligibility.eligible)"
            :title="mentorStore.eligibility && !mentorStore.eligibility.eligible ? 'Unlocks after 2 completed tournaments.' : undefined"
            @click="requestMentorAction"
          >Request a Mentor</IonButton>
        </div>
      </div>

      <!-- Feedback Prompt -->
      <IonCard v-for="fb in mentorStore.pendingFeedback" :key="fb.pairing_id" class="feedback-card">
        <IonCardContent>
          <strong>Rate your mentor {{ fb.mentor_display_name || '' }} ({{ fb.current_quarter }})</strong>
          <div class="rating-row">
            <IonButton v-for="n in 5" :key="n" size="small"
              :fill="(feedbackRatings[fb.pairing_id] ?? 0) >= n ? 'solid' : 'outline'"
              @click="feedbackRatings[fb.pairing_id] = n">{{ n }}</IonButton>
          </div>
          <input :value="feedbackComments[fb.pairing_id] ?? ''" @input="feedbackComments[fb.pairing_id] = ($event.target as unknown as {value: string}).value" placeholder="Optional comment" class="feedback-input" />
          <IonButton size="small" @click="submitFeedbackAction(fb.pairing_id)" :disabled="(feedbackRatings[fb.pairing_id] ?? 0) < 1">Submit</IonButton>
        </IonCardContent>
      </IonCard>

      <!-- Admin Section -->
      <div v-if="isClubAdmin" class="admin-section">
        <h3>Mentor Applications</h3>
        <IonButton size="small" fill="clear" @click="mentorStore.fetchApplications(id)">Refresh</IonButton>
        <div v-if="mentorStore.applications.length === 0" class="empty">No pending applications</div>
        <IonCard v-for="app in mentorStore.applications" :key="app.id">
          <IonCardContent class="app-row">
            <strong>{{ app.display_name || app.user_id.slice(0, 8) }}</strong>
            <IonNote>{{ app.tournament_count }} tournaments · {{ app.win_rate?.toFixed(1) ?? '?' }}% win rate</IonNote>
            <div>
              <IonButton size="small" color="success" @click="mentorStore.approveApplication(id, app.id)">Approve</IonButton>
              <IonButton size="small" color="danger" fill="outline" @click="mentorStore.rejectApplication(id, app.id)">Reject</IonButton>
            </div>
          </IonCardContent>
        </IonCard>

        <h3>Mentee Requests</h3>
        <IonButton size="small" fill="clear" @click="mentorStore.fetchRequests(id)">Refresh</IonButton>
        <div v-if="mentorStore.requests.length === 0" class="empty">No pending requests</div>
        <IonCard v-for="req in mentorStore.requests" :key="req.id">
          <IonCardContent class="app-row">
            <strong>{{ req.display_name || req.user_id.slice(0, 8) }}</strong>
            <IonNote>Requested {{ new Date(req.requested_at).toLocaleDateString() }}</IonNote>
            <div class="pair-controls">
              <select class="mentor-select" :value="selectedMentorForPairing[req.user_id] ?? ''" @change="selectedMentorForPairing[req.user_id] = ($event.target as HTMLSelectElement).value">
                <option value="">Select mentor...</option>
                <option v-for="m in mentorStore.leaderboard" :key="m.mentor_id" :value="m.mentor_id">
                  {{ m.display_name || m.user_id.slice(0, 8) }} ({{ m.mentee_count }}/3)
                </option>
              </select>
              <IonButton size="small" color="primary" :disabled="!selectedMentorForPairing[req.user_id]" @click="pairMentorAction(req.user_id)">Pair</IonButton>
            </div>
          </IonCardContent>
        </IonCard>
      </div>

      <!-- Mentor Leaderboard (only when there are mentors) -->
      <template v-if="mentorStore.leaderboard.length > 0">
        <h3>Mentor Leaderboard</h3>
        <IonCard v-for="m in mentorStore.leaderboard" :key="m.mentor_id">
          <IonCardContent class="mentor-row">
            <strong>{{ m.display_name || m.user_id.slice(0, 8) }}</strong>
            <IonChip color="primary" size="small">Mentor</IonChip>
            <IonNote>{{ m.mentee_count }} mentee(s) · Rating: {{ m.avg_rating?.toFixed(1) ?? 'N/A' }}</IonNote>
          </IonCardContent>
        </IonCard>
      </template>
    </div>
    </template>
  </div>
</template>

<style scoped>
.detail-page { padding: 1rem; max-width: 900px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.actions { display: flex; gap: 0.5rem; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.tab-content { margin-top: 1rem; }
.empty { text-align: center; padding: 1rem; color: var(--ion-color-medium); }
.member-row { display: flex; align-items: center; gap: 0.6rem; }
.clickable-member { cursor: pointer; transition: transform 0.1s ease, box-shadow 0.1s ease; }
.clickable-member:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.member-avatar { width: 32px; height: 32px; border-radius: 50%; background: rgba(88, 86, 214, 0.15); color: var(--ion-color-primary); display: grid; place-items: center; font-weight: 700; font-size: 0.9rem; flex-shrink: 0; }
.member-name { flex: 1; }
.member-chevron { color: var(--ion-color-medium); font-size: 1.25rem; font-weight: 300; }
.invite-box { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.invite-input { flex: 1; padding: 0.5rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; font-size: 0.85rem; }
.mb { margin-bottom: 1rem; }
.analytics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.stat-label { font-size: 0.8rem; color: var(--ion-color-medium); }
.stat-value { font-size: 1.3rem; font-weight: 700; }
h3 { margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 1.1rem; }
.mentoring-status { margin-bottom: 1rem; }
.status-card { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
.action-buttons { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
.eligibility-note { font-size: 0.85rem; color: var(--ion-color-medium); }
.admin-section { margin-top: 1rem; }
.app-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.mentor-row { display: flex; align-items: center; gap: 0.5rem; }
.feedback-card { border-left: 3px solid var(--ion-color-primary); }
.rating-row { display: flex; gap: 0.25rem; margin: 0.5rem 0; }
.feedback-input { width: 100%; padding: 0.5rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; margin-bottom: 0.5rem; }
.pair-controls { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
.mentor-select { padding: 0.4rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; font-size: 0.85rem; }
.empty-block { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 1.5rem 1rem; border: 1px dashed var(--ion-color-light-shade); border-radius: 8px; text-align: center; margin-bottom: 0.5rem; }
.empty-icon { font-size: 1.75rem; color: var(--ion-color-medium); }
.empty-explainer { font-size: 0.85rem; color: var(--ion-color-medium); margin: 0; max-width: 42rem; }
.explainer { font-size: 0.85rem; color: var(--ion-color-medium); margin: 0 0 0.75rem; max-width: 42rem; }
.analytics-header { display: flex; justify-content: flex-end; margin-bottom: 0.5rem; }
.time-window { padding: 0.4rem 0.6rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; background: transparent; color: var(--ion-color-medium); font-size: 0.85rem; cursor: not-allowed; }
.info-icon { font-size: 0.8rem; vertical-align: middle; margin-left: 0.25rem; color: var(--ion-color-medium); }
.actions-mobile { display: none; }
.unread-badge { margin-left: 0.3rem; font-size: inherit; color: var(--ion-color-primary); font-weight: 600; }

@media (max-width: 600px) {
  .actions-desktop { display: none; }
  .actions-mobile { display: flex; }
  .detail-page { padding: 0.75rem; }
  .page-header h1 { font-size: 1.2rem; }
  .member-row { flex-wrap: wrap; }
}
</style>
