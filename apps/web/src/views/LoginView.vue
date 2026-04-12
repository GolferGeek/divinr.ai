<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle,
  IonCardContent, IonItem, IonInput, IonButton, IonIcon, IonText, IonSpinner,
} from '@ionic/vue';
import { analyticsOutline } from 'ionicons/icons';
import { useAuthStore } from '../stores/auth.store';

const auth = useAuthStore();
const router = useRouter();

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
}

interface MeResponse {
  id: string;
  email?: string;
  role?: string;
  globalRole?: string;
  displayName?: string;
}

async function login() {
  error.value = '';
  if (!email.value.trim() || !password.value) {
    error.value = 'Email and password are required';
    return;
  }
  loading.value = true;
  try {
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim(), password: password.value }),
    });
    if (!loginRes.ok) {
      const text = await loginRes.text();
      try {
        const parsed = JSON.parse(text) as { message?: string };
        error.value = parsed.message ?? `Login failed (${loginRes.status})`;
      } catch {
        error.value = `Login failed (${loginRes.status})`;
      }
      return;
    }
    const loginData = (await loginRes.json()) as LoginResponse;

    const meRes = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${loginData.accessToken}` },
    });
    if (!meRes.ok) {
      error.value = `Could not fetch profile (${meRes.status})`;
      return;
    }
    const me = (await meRes.json()) as MeResponse;

    auth.setAuth(me.id, loginData.accessToken, me.globalRole ?? me.role, me.email, me.displayName, loginData.refreshToken);
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
            <ion-icon :icon="analyticsOutline" size="large" color="primary" />
            <ion-card-title>Divinr AI</ion-card-title>
            <ion-card-subtitle>Market Intelligence Platform</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <ion-text v-if="error" color="danger"><p>{{ error }}</p></ion-text>

            <ion-item class="ion-margin-top">
              <ion-input
                v-model="email"
                type="email"
                label="Email"
                label-placement="floating"
                autocomplete="email"
                placeholder="you@example.com"
                @keyup.enter="login"
              />
            </ion-item>

            <ion-item class="ion-margin-top">
              <ion-input
                v-model="password"
                type="password"
                label="Password"
                label-placement="floating"
                autocomplete="current-password"
                @keyup.enter="login"
              />
            </ion-item>

            <ion-button
              expand="block"
              class="ion-margin-top"
              :disabled="loading || !email.trim() || !password"
              @click="login"
            >
              <ion-spinner v-if="loading" name="crescent" />
              <span v-else>Sign In</span>
            </ion-button>
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  </ion-page>
</template>
