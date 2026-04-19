<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote, IonInput, IonTextarea } from '@ionic/vue';
import { useCurriculumStore } from '../stores/curriculum.store';
import { useAuthStore } from '../stores/auth.store';
import { useClubStore } from '../stores/club.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const store = useCurriculumStore();
const authStore = useAuthStore();
const clubStore = useClubStore();
const route = useRoute();
const router = useRouter();
const clubId = computed(() => route.params.clubId as string);
const curriculumId = computed(() => route.params.id as string);

const editingWeek = ref<number | null>(null);
const editTheme = ref('');
const editJournalPrompt = ref('');
const editInstruments = ref('');
const saving = ref(false);
const enrolling = ref(false);

const isAdmin = computed(() => {
  const role = clubStore.activeClub?.my_role;
  return role === 'owner' || role === 'admin';
});

const isEnrolled = computed(() => store.enrollment !== null);

onMounted(async () => {
  await store.fetchCurriculum(curriculumId.value);
  if (!clubStore.activeClub || clubStore.activeClub.id !== clubId.value) {
    await clubStore.fetchClub(clubId.value);
  }
  // Try to load progress for current user
  try { await store.fetchProgress(curriculumId.value); } catch { /* not enrolled */ }
});

function startEdit(weekNumber: number) {
  const mod = store.activeCurriculum?.modules?.find(m => m.week_number === weekNumber);
  if (!mod) return;
  editingWeek.value = weekNumber;
  editTheme.value = mod.theme;
  editJournalPrompt.value = mod.journal_prompt ?? '';
  editInstruments.value = mod.instruments.map(i => i.symbol).join(', ');
}

async function saveModule() {
  if (editingWeek.value === null) return;
  saving.value = true;
  try {
    const instruments = editInstruments.value.split(',').map(s => s.trim()).filter(Boolean).map(symbol => ({ symbol }));
    await store.updateModule(curriculumId.value, editingWeek.value, {
      theme: editTheme.value,
      journal_prompt: editJournalPrompt.value || undefined,
      instruments,
    });
    editingWeek.value = null;
  } catch { /* error handled by store */ }
  finally { saving.value = false; }
}

async function updateStatus(status: string) {
  await store.updateCurriculum(curriculumId.value, { status });
  await store.fetchCurriculum(curriculumId.value);
}

async function handleEnroll() {
  enrolling.value = true;
  try {
    await store.enroll(curriculumId.value);
    await store.fetchProgress(curriculumId.value);
  } catch { /* error */ }
  finally { enrolling.value = false; }
}

async function handleCompleteActivity(weekNumber: number, activity: string) {
  try {
    await store.completeActivity(curriculumId.value, weekNumber, activity);
    await store.fetchProgress(curriculumId.value);
  } catch { /* error */ }
}

function getModuleProgress(moduleId: string) {
  return store.moduleProgress.find(p => p.module_id === moduleId);
}
</script>

<template>
  <div class="detail-page" v-if="store.activeCurriculum">
    <div class="page-header">
      <div>
        <IonButton size="small" fill="clear" @click="router.push(`/clubs/${clubId}`)">Back to Club</IonButton>
        <h1>{{ store.activeCurriculum.name }}</h1>
        <IonNote>
          {{ store.activeCurriculum.week_count }} weeks ·
          {{ store.activeCurriculum.enrolled_count ?? 0 }} enrolled
        </IonNote>
      </div>
      <div class="actions">
        <IonChip :color="store.activeCurriculum.status === 'active' ? 'success' : store.activeCurriculum.status === 'draft' ? 'warning' : 'medium'">
          {{ store.activeCurriculum.status }}
        </IonChip>
        <template v-if="isAdmin">
          <IonButton v-if="store.activeCurriculum.status === 'draft'" size="small" fill="outline" @click="updateStatus('active')">Publish</IonButton>
          <IonButton v-if="store.activeCurriculum.status === 'active'" size="small" fill="outline" @click="updateStatus('archived')">Archive</IonButton>
          <IonButton v-if="store.activeCurriculum.status === 'active'" size="small" fill="outline"
            @click="router.push(`/clubs/${clubId}/curricula/${curriculumId}/dashboard`)">Dashboard
  </IonButton>
        </template>
      </div>
    </div>

    <p v-if="store.activeCurriculum.description" class="description">{{ store.activeCurriculum.description }}</p>

    <!-- Student: Enroll button -->
    <div v-if="!isAdmin && !isEnrolled && store.activeCurriculum.status === 'active'" class="enroll-section">
      <IonButton expand="block" @click="handleEnroll" :disabled="enrolling">
        {{ enrolling ? 'Enrolling...' : 'Enroll in Curriculum' }}
      </IonButton>
    </div>

    <!-- Student: Progress view -->
    <div v-if="!isAdmin && isEnrolled" class="progress-section">
      <IonNote>Your progress: {{ store.enrollment?.completion_pct }}% complete · Week {{ store.enrollment?.current_week }}</IonNote>
    </div>

    <!-- Modules list -->
    <div class="modules-list">
      <IonCard v-for="mod in store.activeCurriculum.modules" :key="mod.id" class="module-card">
        <IonCardHeader>
          <IonCardTitle class="module-title">
            Week {{ mod.week_number }}: {{ mod.theme || '(no theme)' }}
            <!-- Student: lock/unlock indicator -->
            <template v-if="!isAdmin && isEnrolled">
              <IonChip v-if="store.enrollment && mod.week_number > store.enrollment.current_week" color="medium" size="small">Locked</IonChip>
              <IonChip v-else-if="getModuleProgress(mod.id)?.completed_at" color="success" size="small">Complete</IonChip>
              <IonChip v-else color="primary" size="small">Current</IonChip>
            </template>
          </IonCardTitle>
        </IonCardHeader>
        <IonCardContent>
          <!-- Admin: Edit mode -->
          <template v-if="isAdmin && editingWeek === mod.week_number">
            <div class="form-group">
              <label>Theme</label>
              <IonInput v-model="editTheme" placeholder="Week theme" />
            </div>
            <div class="form-group">
              <label>Instruments (comma-separated symbols)</label>
              <IonInput v-model="editInstruments" placeholder="AAPL, MSFT, SPY" />
            </div>
            <div class="form-group">
              <label>Journal Prompt</label>
              <IonTextarea v-model="editJournalPrompt" placeholder="What should students write about?" :rows="2" />
            </div>
            <div class="edit-actions">
              <IonButton size="small" @click="saveModule" :disabled="saving">{{ saving ? 'Saving...' : 'Save' }}</IonButton>
              <IonButton size="small" fill="clear" @click="editingWeek = null">Cancel</IonButton>
            <FirstTouchPanel surface-key="curriculum.detail" />
  </div>
          </template>

          <!-- Admin: Display mode -->
          <template v-else-if="isAdmin">
            <div v-if="mod.instruments.length > 0" class="module-info">
              <IonNote>Instruments: {{ mod.instruments.map((i: {symbol: string}) => i.symbol).join(', ') }}</IonNote>
            </div>
            <div v-if="mod.journal_prompt" class="module-info">
              <IonNote>Journal: {{ mod.journal_prompt }}</IonNote>
            </div>
            <div class="module-info">
              <IonNote>
                Challenge: {{ mod.challenge_id ? 'Linked' : 'None' }} ·
                Poll: {{ mod.poll_id ? 'Linked' : 'None' }} ·
                Tournament: {{ mod.tournament_id ? 'Linked' : 'None' }}
              </IonNote>
            </div>
            <IonButton size="small" fill="clear" @click="startEdit(mod.week_number)">Edit</IonButton>
          </template>

          <!-- Student: Activity status -->
          <template v-else-if="isEnrolled && store.enrollment && mod.week_number <= store.enrollment.current_week">
            <div class="activity-list">
              <div v-if="mod.challenge_id" class="activity-row">
                <span>Challenge</span>
                <IonChip v-if="getModuleProgress(mod.id)?.challenge_completed" color="success" size="small">Done</IonChip>
                <IonButton v-else size="small" fill="outline" @click="handleCompleteActivity(mod.week_number, 'challenge')">Mark Complete</IonButton>
              </div>
              <div v-if="mod.poll_id" class="activity-row">
                <span>Poll</span>
                <IonChip v-if="getModuleProgress(mod.id)?.poll_completed" color="success" size="small">Done</IonChip>
                <IonButton v-else size="small" fill="outline" @click="handleCompleteActivity(mod.week_number, 'poll')">Mark Complete</IonButton>
              </div>
              <div v-if="mod.journal_prompt" class="activity-row">
                <span>Journal</span>
                <IonChip v-if="getModuleProgress(mod.id)?.journal_completed" color="success" size="small">Done</IonChip>
                <IonButton v-else size="small" fill="outline" @click="handleCompleteActivity(mod.week_number, 'journal')">Mark Complete</IonButton>
              </div>
              <div v-if="mod.tournament_id" class="activity-row">
                <span>Tournament</span>
                <IonChip v-if="getModuleProgress(mod.id)?.tournament_completed" color="success" size="small">Done</IonChip>
                <IonButton v-else size="small" fill="outline" @click="handleCompleteActivity(mod.week_number, 'tournament')">Mark Complete</IonButton>
              </div>
            </div>
          </template>
        </IonCardContent>
      </IonCard>
    </div>
  </div>
</template>

<style scoped>
.detail-page { padding: 1rem; max-width: 900px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.description { color: var(--ion-color-medium); margin-bottom: 1rem; }
.enroll-section { margin: 1rem 0; }
.progress-section { margin: 1rem 0; padding: 0.75rem; background: var(--ion-color-light); border-radius: 8px; }
.modules-list { margin-top: 1rem; }
.module-title { font-size: 1rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.module-info { margin-bottom: 0.5rem; }
.form-group { margin-bottom: 0.75rem; }
.form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.85rem; }
.edit-actions { display: flex; gap: 0.5rem; }
.activity-list { display: flex; flex-direction: column; gap: 0.5rem; }
.activity-row { display: flex; justify-content: space-between; align-items: center; }
</style>
