<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonInput, IonTextarea, IonToggle } from '@ionic/vue';
import { useClubStore } from '../stores/club.store';

const store = useClubStore();
const router = useRouter();
const name = ref('');
const description = ref('');
const isPublic = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  if (!name.value) { error.value = 'Name is required.'; return; }
  try {
    const result = await store.createClub({ name: name.value, description: description.value || undefined, is_public: isPublic.value });
    router.push(`/clubs/${result.id}`);
  } catch (e: unknown) { error.value = e instanceof Error ? e.message : String(e); }
}
</script>

<template>
  <div class="create-page">
    <h1>Create Investment Learning Club</h1>
    <p class="disclaimer">Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice.</p>
    <IonCard>
      <IonCardHeader><IonCardTitle>Club Details</IonCardTitle></IonCardHeader>
      <IonCardContent>
        <div class="form-group"><label>Name</label><IonInput v-model="name" placeholder="My Learning Club" /></div>
        <div class="form-group"><label>Description</label><IonTextarea v-model="description" placeholder="What does your club study?" :rows="2" /></div>
        <div class="form-group toggle-row"><label>Public (discoverable)</label><IonToggle v-model="isPublic" /></div>
        <p v-if="error" class="error">{{ error }}</p>
        <IonButton expand="block" @click="submit">Create Club</IonButton>
      </IonCardContent>
    </IonCard>
  </div>
</template>

<style scoped>
.create-page { padding: 1rem; max-width: 500px; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.form-group { margin-bottom: 1rem; }
.form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.85rem; }
.toggle-row { display: flex; justify-content: space-between; align-items: center; }
.error { color: var(--ion-color-danger); font-size: 0.85rem; }
</style>
