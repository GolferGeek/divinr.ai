<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonInput, IonTextarea, IonNote } from '@ionic/vue';
import { useCurriculumStore } from '../stores/curriculum.store';

const store = useCurriculumStore();
const route = useRoute();
const router = useRouter();
const clubId = computed(() => route.params.clubId as string);

const name = ref('');
const description = ref('');
const weekCount = ref(6);
const selectedTemplate = ref('');
const error = ref('');

onMounted(async () => {
  await store.fetchTemplates();
});

function selectTemplate(slug: string) {
  selectedTemplate.value = slug;
  const tmpl = store.templates.find(t => t.slug === slug);
  if (tmpl) {
    name.value = tmpl.name;
    description.value = tmpl.description;
    weekCount.value = tmpl.week_count;
  }
}

async function submit() {
  error.value = '';
  if (!name.value) { error.value = 'Name is required.'; return; }
  if (weekCount.value < 1 || weekCount.value > 52) { error.value = 'Week count must be between 1 and 52.'; return; }

  try {
    let result;
    if (selectedTemplate.value) {
      result = await store.createFromTemplate(clubId.value, selectedTemplate.value);
    } else {
      result = await store.createCurriculum({
        club_id: clubId.value,
        name: name.value,
        description: description.value || undefined,
        week_count: weekCount.value,
      });
    }
    router.push(`/clubs/${clubId.value}/curricula/${result.id}`);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <div class="create-page">
    <h1>Create Curriculum</h1>
    <p class="disclaimer">Structured multi-week learning path for club members. Educational use only — not financial advice.</p>

    <IonCard v-if="store.templates.length > 0">
      <IonCardHeader><IonCardTitle>Start from Template</IonCardTitle></IonCardHeader>
      <IonCardContent>
        <div class="template-grid">
          <div v-for="t in store.templates" :key="t.slug"
            class="template-card" :class="{ selected: selectedTemplate === t.slug }"
            @click="selectTemplate(t.slug)">
            <strong>{{ t.name }}</strong>
            <IonNote>{{ t.week_count }} weeks</IonNote>
            <p class="template-desc">{{ t.description }}</p>
          </div>
        </div>
        <IonButton v-if="selectedTemplate" size="small" fill="clear" @click="selectedTemplate = ''">Clear selection</IonButton>
      </IonCardContent>
    </IonCard>

    <IonCard>
      <IonCardHeader><IonCardTitle>Details</IonCardTitle></IonCardHeader>
      <IonCardContent>
        <div class="form-group">
          <label>Name</label>
          <IonInput v-model="name" placeholder="e.g. Intro to Technical Analysis" />
        </div>

        <div class="form-group">
          <label>Description</label>
          <IonTextarea v-model="description" placeholder="What will students learn?" :rows="2" />
        </div>

        <div class="form-group" v-if="!selectedTemplate">
          <label>Number of Weeks</label>
          <IonInput v-model.number="weekCount" type="number" :min="1" :max="52" />
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <IonButton expand="block" @click="submit">Create Curriculum</IonButton>
      </IonCardContent>
    </IonCard>
  </div>
</template>

<style scoped>
.create-page { padding: 1rem; max-width: 600px; }
.disclaimer { font-size: 0.75rem; color: var(--ion-color-medium); font-style: italic; margin-bottom: 1rem; }
.form-group { margin-bottom: 1rem; }
.form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.85rem; }
.error { color: var(--ion-color-danger); font-size: 0.85rem; }
.template-grid { display: grid; grid-template-columns: 1fr; gap: 0.5rem; }
.template-card { padding: 0.75rem; border: 2px solid var(--ion-color-light-shade); border-radius: 8px; cursor: pointer; }
.template-card.selected { border-color: var(--ion-color-primary); background: var(--ion-color-primary-tint); }
.template-card strong { display: block; margin-bottom: 0.25rem; }
.template-desc { font-size: 0.8rem; color: var(--ion-color-medium); margin: 0.25rem 0 0; }
</style>
