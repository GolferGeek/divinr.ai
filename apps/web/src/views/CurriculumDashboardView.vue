<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonChip, IonNote } from '@ionic/vue';
import { useCurriculumStore } from '../stores/curriculum.store';

const store = useCurriculumStore();
const route = useRoute();
const router = useRouter();
const clubId = computed(() => route.params.clubId as string);
const curriculumId = computed(() => route.params.id as string);
const expandedStudent = ref<string | null>(null);
const studentDetail = ref<Record<string, unknown> | null>(null);

onMounted(async () => {
  await store.fetchDashboard(curriculumId.value);
});

async function toggleStudent(userId: string) {
  if (expandedStudent.value === userId) {
    expandedStudent.value = null;
    studentDetail.value = null;
    return;
  }
  expandedStudent.value = userId;
  try {
    studentDetail.value = await store.fetchStudentDetail(curriculumId.value, userId) as Record<string, unknown>;
  } catch { studentDetail.value = null; }
}
</script>

<template>
  <div class="detail-page" v-if="store.dashboard">
    <IonButton size="small" fill="clear" @click="router.push(`/clubs/${clubId}/curricula/${curriculumId}`)">Back to Curriculum</IonButton>
    <h1>{{ store.dashboard.curriculum.name }} — Dashboard</h1>
    <IonNote>{{ store.dashboard.students.length }} enrolled students</IonNote>

    <div class="dashboard-table" v-if="store.dashboard.students.length > 0">
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th v-for="w in store.dashboard.curriculum.week_count" :key="w">W{{ w }}</th>
            <th>Overall</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in store.dashboard.students" :key="s.user_id" @click="toggleStudent(s.user_id)" style="cursor:pointer">
            <td><strong>{{ s.display_name || s.user_id.slice(0, 8) }}</strong></td>
            <td v-for="w in store.dashboard.curriculum.week_count" :key="w">
              <template v-if="s.module_progress.find((p: {module_id: string}) => {
                const mod = store.dashboard?.curriculum.modules?.find(m => m.id === p.module_id);
                return mod && mod.week_number === w;
              })">
                <IonChip v-if="s.module_progress.find((p: {module_id: string; completed_at: string|null}) => {
                  const mod = store.dashboard?.curriculum.modules?.find(m => m.id === p.module_id);
                  return mod && mod.week_number === w && p.completed_at;
                })" color="success" size="small">Done</IonChip>
                <IonChip v-else color="warning" size="small">In Progress</IonChip>
              </template>
              <template v-else>
                <IonChip color="medium" size="small">--</IonChip>
              </template>
            </td>
            <td><strong>{{ s.enrollment.completion_pct }}%</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="empty">No students enrolled yet.</div>

    <!-- Expanded student detail -->
    <IonCard v-if="expandedStudent && studentDetail" class="student-detail">
      <IonCardHeader><IonCardTitle>Student Detail</IonCardTitle></IonCardHeader>
      <IonCardContent>
        <div v-for="mod in (studentDetail as Record<string,unknown>).modules as Array<{module: {week_number: number; theme: string}; progress: {challenge_completed: boolean; poll_completed: boolean; journal_completed: boolean; tournament_completed: boolean; completed_at: string|null} | null; activities: {challenge_response: Record<string,unknown>|null; poll_vote: Record<string,unknown>|null; journal_entry: Record<string,unknown>|null; tournament_entry: Record<string,unknown>|null}}>" :key="mod.module.week_number" class="week-detail">
          <h4>Week {{ mod.module.week_number }}: {{ mod.module.theme }}</h4>
          <div v-if="mod.activities.challenge_response" class="activity-detail">
            Challenge: {{ (mod.activities.challenge_response as Record<string,unknown>).direction }} — {{ (mod.activities.challenge_response as Record<string,unknown>).thesis }}
          </div>
          <div v-if="mod.activities.poll_vote" class="activity-detail">
            Poll vote: {{ (mod.activities.poll_vote as Record<string,unknown>).direction }}
          </div>
          <div v-if="mod.activities.journal_entry" class="activity-detail">
            Journal: {{ (mod.activities.journal_entry as Record<string,unknown>).entry }}
          </div>
          <div v-if="mod.activities.tournament_entry" class="activity-detail">
            Tournament rank: {{ (mod.activities.tournament_entry as Record<string,unknown>).final_rank ?? 'In progress' }}
          </div>
          <div v-if="!mod.activities.challenge_response && !mod.activities.poll_vote && !mod.activities.journal_entry && !mod.activities.tournament_entry" class="activity-detail empty-detail">
            No activity responses yet
          </div>
        </div>
      </IonCardContent>
    </IonCard>
  </div>
</template>

<style scoped>
.detail-page { padding: 1rem; max-width: 1100px; }
.dashboard-table { margin-top: 1rem; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { padding: 0.5rem; text-align: center; border-bottom: 1px solid var(--ion-color-light-shade); }
th { font-weight: 600; background: var(--ion-color-light); }
td:first-child, th:first-child { text-align: left; }
.empty { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
.student-detail { margin-top: 1rem; }
.week-detail { margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--ion-color-light-shade); }
.week-detail h4 { margin: 0 0 0.5rem; font-size: 0.95rem; }
.activity-detail { font-size: 0.85rem; margin-bottom: 0.25rem; color: var(--ion-color-dark); }
.empty-detail { color: var(--ion-color-medium); font-style: italic; }
</style>
