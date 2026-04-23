<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonBadge, IonSpinner } from '@ionic/vue';
import { useFirstTouch } from '../composables/useFirstTouch';
import { useApi } from '../composables/useApi';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';

useFirstTouch('admin.user-billing');

interface Subscription {
  user_id: string;
  status: 'trial' | 'active' | 'past_due' | 'canceled' | 'dormant';
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  expired_at: string | null;
  purge_scheduled_at: string | null;
}

interface AuthoredItem {
  id: string;
  item_kind: string;
  item_id: string | null;
  monthly_usd_cents: number;
  status: string;
  activated_at: string;
  canceled_at: string | null;
}

interface SubEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  reason: string;
  triggered_by: string;
  created_at: string;
}

interface AdminBillingView {
  subscription: Subscription | null;
  authored_items: AuthoredItem[];
  events: SubEvent[];
  preview: {
    basicMonthlyUsd: number;
    authoredAnalysts: Array<{ id: string | null; displayName: string; monthlyUsd: number }>;
    authoredInstruments: Array<{ id: string | null; displayName: string; monthlyUsd: number }>;
    byoPlatformFeeUsd: number;
    totalMonthlyUsd: number;
  };
}

const route = useRoute();
const api = useApi('/api');
const loading = ref(true);
const error = ref<string | null>(null);
const data = ref<AdminBillingView | null>(null);

async function load() {
  const id = String(route.params.id);
  loading.value = true;
  error.value = null;
  try {
    const resp = await api.get<AdminBillingView>(`/admin/users/${id}/billing`);
    data.value = resp;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <div data-testid="admin-user-billing" style="padding: 16px; max-width: 1100px; margin: 0 auto;">
    <h2 style="margin: 0 0 8px;">User billing</h2>
    <p style="color: var(--ion-color-medium); font-size: 13px;">
      Read-only analyst view. Subscription state, authored items, events, and the itemized monthly total.
    </p>

    <div v-if="loading" style="text-align: center; padding: 32px;">
      <IonSpinner name="dots" />
    </div>

    <div v-else-if="error" style="padding: 16px; color: var(--ion-color-danger);">
      Could not load billing data: {{ error }}
    </div>

    <div v-else-if="data">
      <IonCard data-testid="admin-billing-subscription" style="margin-bottom: 16px;">
        <IonCardHeader><IonCardTitle>Subscription</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div v-if="!data.subscription" style="color: var(--ion-color-medium);">No subscription row.</div>
          <div v-else>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <strong>Status:</strong>
              <IonBadge :color="data.subscription.status === 'active' || data.subscription.status === 'trial' ? 'success' : 'warning'">
                {{ data.subscription.status }}
              </IonBadge>
            </div>
            <div style="font-size: 13px; color: var(--ion-color-medium);">
              Trial: {{ fmtDate(data.subscription.trial_started_at) }} → {{ fmtDate(data.subscription.trial_ends_at) }}<br>
              <template v-if="data.subscription.expired_at">Expired: {{ fmtDate(data.subscription.expired_at) }}<br></template>
              <template v-if="data.subscription.purge_scheduled_at">Purge scheduled: {{ fmtDate(data.subscription.purge_scheduled_at) }}<br></template>
            </div>
          </div>
        </IonCardContent>
      </IonCard>

      <IonCard data-testid="admin-billing-items" style="margin-bottom: 16px;">
        <IonCardHeader><IonCardTitle>Authored items</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div v-if="data.authored_items.length === 0" style="color: var(--ion-color-medium);">No authored items.</div>
          <table v-else style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; border-bottom: 1px solid var(--ion-color-light);">
                <th style="padding: 6px;">Kind</th>
                <th style="padding: 6px;">Item ID</th>
                <th style="padding: 6px;">Monthly</th>
                <th style="padding: 6px;">Status</th>
                <th style="padding: 6px;">Activated</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in data.authored_items" :key="item.id" data-testid="admin-billing-item-row" style="border-bottom: 1px solid var(--ion-color-light);">
                <td style="padding: 6px;">{{ item.item_kind }}</td>
                <td style="padding: 6px; font-family: monospace; font-size: 12px;">{{ item.item_id ?? '—' }}</td>
                <td style="padding: 6px;">${{ (item.monthly_usd_cents / 100).toFixed(2) }}</td>
                <td style="padding: 6px;">{{ item.status }}</td>
                <td style="padding: 6px;">{{ fmtDate(item.activated_at) }}</td>
              </tr>
            </tbody>
          </table>
        </IonCardContent>
      </IonCard>

      <IonCard data-testid="admin-billing-events" style="margin-bottom: 16px;">
        <IonCardHeader><IonCardTitle>Events</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div v-if="data.events.length === 0" style="color: var(--ion-color-medium);">No events.</div>
          <table v-else style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; border-bottom: 1px solid var(--ion-color-light);">
                <th style="padding: 6px;">When</th>
                <th style="padding: 6px;">From</th>
                <th style="padding: 6px;">To</th>
                <th style="padding: 6px;">Reason</th>
                <th style="padding: 6px;">By</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ev in data.events" :key="ev.id" data-testid="admin-billing-event-row" style="border-bottom: 1px solid var(--ion-color-light);">
                <td style="padding: 6px;">{{ fmtDate(ev.created_at) }}</td>
                <td style="padding: 6px;">{{ ev.from_status ?? '—' }}</td>
                <td style="padding: 6px;">{{ ev.to_status }}</td>
                <td style="padding: 6px;">{{ ev.reason }}</td>
                <td style="padding: 6px;">{{ ev.triggered_by }}</td>
              </tr>
            </tbody>
          </table>
        </IonCardContent>
      </IonCard>

      <IonCard data-testid="admin-billing-preview">
        <IonCardHeader><IonCardTitle>Monthly total</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div style="display: flex; justify-content: space-between; padding: 4px 0;">
            <span>Basic</span><span>${{ data.preview.basicMonthlyUsd.toFixed(2) }}</span>
          </div>
          <div v-if="data.preview.authoredAnalysts.length > 0" style="padding: 4px 0; border-top: 1px dashed var(--ion-color-light); margin-top: 4px;">
            <div style="font-weight: 600; margin-bottom: 4px;">Authored analysts</div>
            <div v-for="row in data.preview.authoredAnalysts" :key="row.id || row.displayName" style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>{{ row.displayName }}</span><span>${{ row.monthlyUsd.toFixed(2) }}</span>
            </div>
          </div>
          <div v-if="data.preview.authoredInstruments.length > 0" style="padding: 4px 0; border-top: 1px dashed var(--ion-color-light); margin-top: 4px;">
            <div style="font-weight: 600; margin-bottom: 4px;">Authored instruments</div>
            <div v-for="row in data.preview.authoredInstruments" :key="row.id || row.displayName" style="display: flex; justify-content: space-between; font-size: 13px;">
              <span>{{ row.displayName }}</span><span>${{ row.monthlyUsd.toFixed(2) }}</span>
            </div>
          </div>
          <div v-if="data.preview.byoPlatformFeeUsd > 0" style="display: flex; justify-content: space-between; padding: 4px 0;">
            <span>BYO platform fee</span><span>${{ data.preview.byoPlatformFeeUsd.toFixed(2) }}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 8px 0; border-top: 2px solid var(--ion-color-medium); margin-top: 8px; font-weight: 700;">
            <span>Total</span><span>${{ data.preview.totalMonthlyUsd.toFixed(2) }}</span>
          </div>
        </IonCardContent>
      </IonCard>
    </div>

    <LegalDisclaimer variant="short" style="margin-top: 24px;" />
  </div>
</template>
