<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonInput, IonSelect, IonSelectOption, IonTextarea } from '@ionic/vue';
import { useTournamentStore } from '../stores/tournament.store';
import { useCanWrite } from '../composables/useCanWrite';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';
const store = useTournamentStore();
const router = useRouter();
const { canWrite } = useCanWrite();
if (!canWrite.value) router.replace('/tournaments');
const error = ref('');

const name = ref('');
const description = ref('');
const scope = ref<'invitation' | 'system'>('invitation');
const tournamentType = ref<'weekly_sprint' | 'sector_challenge' | 'analyst_draft'>('weekly_sprint');
const startingBalance = ref(100000);
const startsAt = ref('');
const endsAt = ref('');

async function submit() {
  error.value = '';
  if (!name.value || !startsAt.value || !endsAt.value) {
    error.value = 'Name, start date, and end date are required.';
    return;
  }
  try {
    const result = await store.createTournament({
      name: name.value,
      description: description.value || undefined,
      scope: scope.value,
      tournament_type: tournamentType.value,
      starting_balance: startingBalance.value,
      starts_at: new Date(startsAt.value).toISOString(),
      ends_at: new Date(endsAt.value).toISOString(),
    });
    router.push(`/tournaments/${result.id}`);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <div class="create-page">
    <h1>Create Tournament</h1>
    <LegalDisclaimer variant="tournament" />

    <IonCard>
      <IonCardHeader><IonCardTitle>Game Details</IonCardTitle></IonCardHeader>
      <IonCardContent>
        <div class="form-group">
          <label>Name</label>
          <IonInput v-model="name" placeholder="Weekly Sprint #1" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <IonTextarea v-model="description" placeholder="Optional description..." :rows="2" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Scope</label>
            <IonSelect v-model="scope" interface="popover">
              <IonSelectOption value="invitation">Invitation</IonSelectOption>
              <IonSelectOption value="system">System (Admin)</IonSelectOption>
            </IonSelect>
          </div>
          <div class="form-group">
            <label>Type</label>
            <IonSelect v-model="tournamentType" interface="popover">
              <IonSelectOption value="weekly_sprint">Weekly Sprint</IonSelectOption>
              <IonSelectOption value="sector_challenge">Sector Challenge</IonSelectOption>
              <IonSelectOption value="analyst_draft">Analyst Draft</IonSelectOption>
            </IonSelect>
          </div>
        </div>
        <div class="form-group">
          <label>Virtual Starting Balance</label>
          <IonInput v-model.number="startingBalance" type="number" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Start Date</label>
            <input v-model="startsAt" type="datetime-local" class="date-input" />
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input v-model="endsAt" type="datetime-local" class="date-input" />
          </div>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <IonButton expand="block" @click="submit">Create Game</IonButton>
      </IonCardContent>
    </IonCard>
  
  <FirstTouchPanel surface-key="tournament.create" />
  </div>
</template>

<style scoped>
.create-page { padding: 1rem; max-width: 600px; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.form-group { margin-bottom: 1rem; }
.form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.85rem; }
.form-row { display: flex; gap: 1rem; }
.form-row .form-group { flex: 1; }
.date-input { width: 100%; padding: 0.5rem; border: 1px solid var(--ion-color-light-shade); border-radius: 4px; }
.error { color: var(--ion-color-danger); font-size: 0.85rem; }
</style>
