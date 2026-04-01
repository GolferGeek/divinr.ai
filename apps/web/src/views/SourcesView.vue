<script setup lang="ts">
import { onMounted } from 'vue';
import { useSourcesStore } from '../stores/sources.store';
import {
  IonList, IonItem, IonLabel, IonChip, IonToggle,
} from '@ionic/vue';

const store = useSourcesStore();
onMounted(() => store.fetch());
</script>

<template>
  <div>
    <h1 style="margin-bottom:16px">Sources &amp; Entitlements</h1>
    <ion-list>
      <ion-item v-for="s in store.items" :key="String(s['id'])">
        <ion-label>
          <h3>{{ s['display_name'] }}</h3>
          <p>
            <ion-chip style="font-size:0.7rem;height:20px">{{ s['tier'] }}</ion-chip>
            {{ s['source_origin'] || 'divinr' }}
          </p>
        </ion-label>
        <ion-toggle
          slot="end"
          :checked="Boolean(s['is_enabled'] ?? s['is_global_default'])"
          color="success"
          @ion-change="(e: any) => store.toggleEntitlement(String(s['id']), e.detail.checked)"
        />
      </ion-item>
    </ion-list>
  </div>
</template>
