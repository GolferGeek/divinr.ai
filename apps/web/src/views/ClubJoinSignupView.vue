<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle,
  IonCardContent, IonItem, IonInput, IonButton, IonIcon, IonText, IonSpinner,
} from '@ionic/vue';
import { peopleCircleOutline } from 'ionicons/icons';
import { useAuthStore } from '../stores/auth.store';

import FirstTouchPanel from '../components/FirstTouchPanel.vue';
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const clubCode = ref((route.params.code as string) || '');
const email = ref('');
const password = ref('');
const displayName = ref('');
const error = ref('');
const loading = ref(false);

async function signup() {
  error.value = '';
  if (!clubCode.value.trim()) {
    error.value = 'Club code is required';
    return;
  }
  if (!email.value.trim() || !password.value) {
    error.value = 'Email and password are required';
    return;
  }
  loading.value = true;
  try {
    const res = await fetch('/api/auth/signup-with-club-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clubCode: clubCode.value.trim().toUpperCase(),
        email: email.value.trim(),
        password: password.value,
        displayName: displayName.value.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string };
      error.value = data.message ?? `Signup failed (${res.status})`;
      return;
    }
    const signupData = await res.json() as { accessToken: string; refreshToken?: string };

    auth.clear();

    const meRes = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${signupData.accessToken}` },
    });
    if (meRes.ok) {
      const me = await meRes.json() as { id: string; role?: string; email?: string; displayName?: string; globalRole?: string };
      auth.setAuth(me.id, signupData.accessToken, me.globalRole ?? me.role ?? 'member', me.email, me.displayName, signupData.refreshToken);
    }

    await router.push('/');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <ion-page>
    <ion-content class="ion-padding" :fullscreen="true">
      <div style="display:flex; justify-content:center; align-items:center; min-height:100vh">
        <ion-card style="max-width:450px; width:100%">
          <ion-card-header class="ion-text-center">
            <ion-icon :icon="peopleCircleOutline" size="large" color="primary" />
            <ion-card-title>Join a Club</ion-card-title>
            <ion-card-subtitle>Create your account and join an investment learning club</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <ion-text v-if="error" color="danger"><p>{{ error }}</p></ion-text>

            <ion-item class="ion-margin-top">
              <ion-input
                v-model="clubCode"
                type="text"
                label="Club Code"
                label-placement="floating"
                placeholder="e.g. J5M36WG2"
                style="text-transform: uppercase"
                @keyup.enter="signup"
              />
            </ion-item>

            <ion-item class="ion-margin-top">
              <ion-input
                v-model="email"
                type="email"
                label="Email"
                label-placement="floating"
                autocomplete="email"
                placeholder="you@example.com"
                @keyup.enter="signup"
              />
            </ion-item>

            <ion-item class="ion-margin-top">
              <ion-input
                v-model="displayName"
                type="text"
                label="Display Name"
                label-placement="floating"
                placeholder="What should we call you?"
                @keyup.enter="signup"
              />
            </ion-item>

            <ion-item class="ion-margin-top">
              <ion-input
                v-model="password"
                type="password"
                label="Password"
                label-placement="floating"
                autocomplete="new-password"
                @keyup.enter="signup"
              />
            </ion-item>

            <ion-button
              expand="block"
              class="ion-margin-top"
              :disabled="loading || !clubCode.trim() || !email.trim() || !password"
              @click="signup"
            >
              <ion-spinner v-if="loading" name="crescent" />
              <span v-else>Create Account & Join Club</span>
            </ion-button>

            <p class="ion-text-center" style="margin-top:1rem; font-size:0.85em; color:var(--ion-color-medium)">
              Already have an account?
              <a href="/login" style="color:var(--ion-color-primary)">Log in</a>
              and join from the Clubs page.
            </p>

            <p class="ion-text-center" style="margin-top:0.5rem; font-size:0.75em; color:var(--ion-color-medium)">
              Divinr provides AI-generated analysis for educational purposes. Not investment advice.
            </p>
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  
  <FirstTouchPanel surface-key="club.join-signup" />
  </ion-page>
</template>
