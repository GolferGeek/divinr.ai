<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonNote } from '@ionic/vue';
import { useClubStore, type Club } from '../stores/club.store';

const store = useClubStore();
const route = useRoute();
const router = useRouter();
const token = route.params.token as string;
const club = ref<Club | null>(null);
const memberCount = ref(0);
const error = ref('');
const joined = ref(false);

onMounted(async () => {
  try {
    const details = await store.fetchInviteDetails(token);
    club.value = details.club;
    memberCount.value = details.member_count;
  } catch (e: unknown) { error.value = e instanceof Error ? e.message : String(e); }
});

async function join() {
  try {
    await store.acceptInvite(token);
    joined.value = true;
    if (club.value) router.push(`/clubs/${club.value.id}`);
  } catch (e: unknown) { error.value = e instanceof Error ? e.message : String(e); }
}
</script>

<template>
  <div class="invite-page">
    <h1>Club Invitation</h1>
    <p class="disclaimer">Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice.</p>
    <div v-if="error" class="error">{{ error }}</div>
    <IonCard v-else-if="club">
      <IonCardHeader><IonCardTitle>{{ club.name }}</IonCardTitle></IonCardHeader>
      <IonCardContent>
        <p v-if="club.description">{{ club.description }}</p>
        <IonNote>{{ memberCount }} member{{ memberCount !== 1 ? 's' : '' }}</IonNote>
        <IonButton v-if="!joined" expand="block" @click="join" style="margin-top:1rem">Join Club</IonButton>
        <p v-else class="joined">Joined! Redirecting...</p>
      </IonCardContent>
    </IonCard>
    <div v-else class="loading">Loading invitation...</div>
  </div>
</template>

<style scoped>
.invite-page { padding: 1rem; max-width: 500px; margin: 0 auto; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.error { color: var(--ion-color-danger); padding: 1rem; }
.joined { color: var(--ion-color-success); text-align: center; font-weight: 600; }
.loading { text-align: center; padding: 2rem; color: var(--ion-color-medium); }
</style>
