<script setup lang="ts">
/**
 * Invite signup page — validates an invite token and creates a beta reader account.
 * Effort: beta-user-share-path.
 */
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardSubtitle,
  IonCardContent, IonItem, IonInput, IonButton, IonIcon, IonText, IonSpinner,
} from '@ionic/vue';
import { analyticsOutline } from 'ionicons/icons';
import { useAuthStore } from '../stores/auth.store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const inviteToken = route.params.token as string;
const validating = ref(true);
const valid = ref(false);
const inviteEmail = ref('');
const inviteError = ref('');

const email = ref('');
const password = ref('');
const displayName = ref('');
const error = ref('');
const loading = ref(false);

onMounted(async () => {
  try {
    const res = await fetch(`/api/auth/invites/${inviteToken}/validate`);
    if (!res.ok) {
      inviteError.value = 'Unable to validate invite';
      return;
    }
    const data = await res.json() as { valid: boolean; email?: string | null; reason?: string };
    if (!data.valid) {
      inviteError.value = data.reason ?? 'This invite is no longer valid';
      return;
    }
    valid.value = true;
    if (data.email) {
      inviteEmail.value = data.email;
      email.value = data.email;
    }
  } catch (err) {
    inviteError.value = err instanceof Error ? err.message : 'Failed to validate invite';
  } finally {
    validating.value = false;
  }
});

async function signup() {
  error.value = '';
  if (!email.value.trim() || !password.value) {
    error.value = 'Email and password are required';
    return;
  }
  loading.value = true;
  try {
    const res = await fetch('/api/auth/signup-with-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: inviteToken,
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

    // Clear any previous session before setting the new one
    auth.clear();

    // Fetch profile to get user id, role, email, and display name
    const meRes = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${signupData.accessToken}` },
    });
    if (meRes.ok) {
      const me = await meRes.json() as { id: string; role?: string; email?: string; displayName?: string; globalRole?: string };
      auth.setAuth(me.id, signupData.accessToken, me.globalRole ?? me.role ?? 'beta_reader', me.email, me.displayName, signupData.refreshToken);
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
            <ion-icon :icon="analyticsOutline" size="large" color="primary" />
            <ion-card-title>Divinr AI</ion-card-title>
            <ion-card-subtitle>Beta Access Signup</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <!-- Validating -->
            <div v-if="validating" class="ion-text-center ion-padding">
              <ion-spinner name="crescent" />
              <p>Validating invite...</p>
            </div>

            <!-- Invalid invite -->
            <div v-else-if="!valid">
              <ion-text color="danger"><p>{{ inviteError }}</p></ion-text>
              <p>Contact the person who shared this link for a new invite.</p>
            </div>

            <!-- Valid invite — show signup form -->
            <template v-else>
              <ion-text v-if="error" color="danger"><p>{{ error }}</p></ion-text>

              <ion-item class="ion-margin-top">
                <ion-input
                  v-model="email"
                  type="email"
                  label="Email"
                  label-placement="floating"
                  autocomplete="email"
                  placeholder="you@example.com"
                  :disabled="!!inviteEmail"
                  @keyup.enter="signup"
                />
              </ion-item>

              <ion-item class="ion-margin-top">
                <ion-input
                  v-model="displayName"
                  type="text"
                  label="Display Name (optional)"
                  label-placement="floating"
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
                :disabled="loading || !email.trim() || !password"
                @click="signup"
              >
                <ion-spinner v-if="loading" name="crescent" />
                <span v-else>Create Account</span>
              </ion-button>

              <p class="ion-text-center" style="margin-top:1rem; font-size:0.85em; color:var(--ion-color-medium)">
                You'll have read-only access to view predictions, analysis, and findings.
              </p>
            </template>
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  </ion-page>
</template>
