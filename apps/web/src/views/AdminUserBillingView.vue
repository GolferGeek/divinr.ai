<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonBadge, IonSpinner, IonModal, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonItem, IonLabel, IonInput, IonTextarea, toastController } from '@ionic/vue';
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

interface PaymentMethod {
  id: string; last4: string; expMonth: number; expYear: number; brand: string; isDefault: boolean;
}
interface Invoice {
  invoiceId: string; amount: number; status: string; invoiceUrl: string | null; createdAt: string;
}
interface UpcomingInvoiceLine {
  description: string; amountCents: number; priceId: string | null;
}
interface UpcomingInvoice {
  amountDue: number; currency: string; dueDate: string | null; lineItems: UpcomingInvoiceLine[];
}
interface StripeWebhookEvent {
  event_id: string; event_type: string; received_at: string; processed_at: string | null; handler_error: string | null;
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
  paymentMethods: PaymentMethod[];
  invoiceHistory: Invoice[];
  upcomingInvoicePreview: UpcomingInvoice | null;
  stripeEvents: StripeWebhookEvent[];
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

function fmtCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// ─── Action modals (Refund / Credit / Comp) ──────────────────────────

const refundModal = ref(false);
const creditModal = ref(false);
const compModal = ref(false);
const submitting = ref(false);

const refundForm = ref({ invoiceId: '', amountCents: '', reason: '', confirmed: false });
const creditForm = ref({ amountCents: '', reason: '', confirmed: false });
const compForm = ref({ periodsCount: '1', reason: '', confirmed: false });

function openRefund(invoiceId = '') {
  refundForm.value = { invoiceId, amountCents: '', reason: '', confirmed: false };
  refundModal.value = true;
}
function openCredit() {
  creditForm.value = { amountCents: '', reason: '', confirmed: false };
  creditModal.value = true;
}
function openComp() {
  compForm.value = { periodsCount: '1', reason: '', confirmed: false };
  compModal.value = true;
}

async function showToast(message: string, color: 'success' | 'warning' = 'success') {
  const t = await toastController.create({ message, duration: 3000, color, position: 'top' });
  await t.present();
}

async function postAdmin<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const data = await api.post<T>(path, body);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function submitRefund() {
  if (!refundForm.value.confirmed || !refundForm.value.invoiceId || !refundForm.value.reason) return;
  submitting.value = true;
  const id = String(route.params.id);
  const amountCents = refundForm.value.amountCents ? Number(refundForm.value.amountCents) : undefined;
  const result = await postAdmin<{ refundId: string }>(`/admin/users/${id}/billing/refund`, {
    invoiceId: refundForm.value.invoiceId,
    amountCents,
    reason: refundForm.value.reason,
  });
  submitting.value = false;
  if (result.ok) {
    refundModal.value = false;
    await showToast(`Refund issued: ${result.data.refundId}`);
    await load();
  } else {
    await showToast(`Refund failed: ${result.error}`, 'warning');
  }
}

async function submitCredit() {
  if (!creditForm.value.confirmed || !creditForm.value.amountCents || !creditForm.value.reason) return;
  submitting.value = true;
  const id = String(route.params.id);
  const result = await postAdmin<{ ok: true }>(`/admin/users/${id}/billing/credit`, {
    amountCents: Number(creditForm.value.amountCents),
    reason: creditForm.value.reason,
  });
  submitting.value = false;
  if (result.ok) {
    creditModal.value = false;
    await showToast('Credit applied');
    await load();
  } else {
    await showToast(`Credit failed: ${result.error}`, 'warning');
  }
}

async function submitComp() {
  if (!compForm.value.confirmed || !compForm.value.reason) return;
  submitting.value = true;
  const id = String(route.params.id);
  const result = await postAdmin<{ ok: true }>(`/admin/users/${id}/billing/comp`, {
    periodsCount: Number(compForm.value.periodsCount),
    reason: compForm.value.reason,
  });
  submitting.value = false;
  if (result.ok) {
    compModal.value = false;
    await showToast('Comp coupon applied');
    await load();
  } else {
    await showToast(`Comp failed: ${result.error}`, 'warning');
  }
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
      <div data-testid="admin-billing-actions" style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
        <IonButton size="small" color="warning" data-testid="admin-billing-action-refund" @click="openRefund()">Refund…</IonButton>
        <IonButton size="small" color="primary" fill="outline" data-testid="admin-billing-action-credit" @click="openCredit">Credit…</IonButton>
        <IonButton size="small" color="primary" fill="outline" data-testid="admin-billing-action-comp" @click="openComp">Comp…</IonButton>
      </div>

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

      <IonCard data-testid="admin-billing-payment-methods" style="margin-bottom: 16px;">
        <IonCardHeader><IonCardTitle>Payment methods</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div v-if="data.paymentMethods.length === 0" style="color: var(--ion-color-medium);">
            No payment methods on file (or Stripe not configured).
          </div>
          <div v-else>
            <div v-for="pm in data.paymentMethods" :key="pm.id" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--ion-color-light);">
              <div>
                <strong>{{ pm.brand }}</strong> •••• {{ pm.last4 }}
                <IonBadge v-if="pm.isDefault" color="success" style="margin-left: 8px; font-size: 10px;">default</IonBadge>
              </div>
              <div style="color: var(--ion-color-medium); font-size: 13px;">exp {{ pm.expMonth }}/{{ pm.expYear }}</div>
            </div>
          </div>
        </IonCardContent>
      </IonCard>

      <IonCard data-testid="admin-billing-invoices" style="margin-bottom: 16px;">
        <IonCardHeader><IonCardTitle>Invoice history (last 10)</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div v-if="data.invoiceHistory.length === 0" style="color: var(--ion-color-medium);">
            No invoices yet.
          </div>
          <table v-else style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; border-bottom: 1px solid var(--ion-color-light);">
                <th style="padding: 6px;">When</th>
                <th style="padding: 6px;">Invoice</th>
                <th style="padding: 6px; text-align: right;">Amount</th>
                <th style="padding: 6px;">Status</th>
                <th style="padding: 6px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="inv in data.invoiceHistory" :key="inv.invoiceId" data-testid="admin-billing-invoice-row" style="border-bottom: 1px solid var(--ion-color-light);">
                <td style="padding: 6px;">{{ fmtDate(inv.createdAt) }}</td>
                <td style="padding: 6px; font-family: monospace; font-size: 12px;">
                  <a v-if="inv.invoiceUrl" :href="inv.invoiceUrl" target="_blank" rel="noopener noreferrer">{{ inv.invoiceId }}</a>
                  <span v-else>{{ inv.invoiceId }}</span>
                </td>
                <td style="padding: 6px; text-align: right;">{{ fmtCents(inv.amount) }}</td>
                <td style="padding: 6px;">{{ inv.status }}</td>
                <td style="padding: 6px;">
                  <IonButton size="small" fill="clear" color="warning" @click="openRefund(inv.invoiceId)">Refund</IonButton>
                </td>
              </tr>
            </tbody>
          </table>
        </IonCardContent>
      </IonCard>

      <IonCard data-testid="admin-billing-stripe-events" style="margin-bottom: 16px;">
        <IonCardHeader><IonCardTitle>Stripe events (last 50)</IonCardTitle></IonCardHeader>
        <IonCardContent>
          <div v-if="data.stripeEvents.length === 0" style="color: var(--ion-color-medium);">
            No Stripe webhook events for this user.
          </div>
          <table v-else style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="text-align: left; border-bottom: 1px solid var(--ion-color-light);">
                <th style="padding: 6px;">When</th>
                <th style="padding: 6px;">Event</th>
                <th style="padding: 6px;">Type</th>
                <th style="padding: 6px;">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ev in data.stripeEvents" :key="ev.event_id" data-testid="admin-billing-stripe-event-row" style="border-bottom: 1px solid var(--ion-color-light);">
                <td style="padding: 6px;">{{ fmtDate(ev.received_at) }}</td>
                <td style="padding: 6px; font-family: monospace; font-size: 11px;">{{ ev.event_id }}</td>
                <td style="padding: 6px;">{{ ev.event_type }}</td>
                <td style="padding: 6px;">
                  <IonBadge v-if="ev.handler_error" color="danger">failed</IonBadge>
                  <IonBadge v-else-if="ev.processed_at" color="success">processed</IonBadge>
                  <IonBadge v-else color="warning">pending</IonBadge>
                </td>
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

    <!-- Refund modal -->
    <IonModal :is-open="refundModal" @did-dismiss="refundModal = false" data-testid="refund-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Refund a Stripe invoice</IonTitle>
          <IonButtons slot="end"><IonButton @click="refundModal = false">Cancel</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent class="ion-padding">
        <p style="color: var(--ion-color-medium); font-size: 13px;">
          Issues a Stripe refund. Leave Amount blank for a full refund. Reason is recorded in the
          subscription_events audit trail (triggered_by='admin').
        </p>
        <IonItem>
          <IonLabel position="stacked">Stripe invoice id (e.g., <code>in_1Ab…</code>)</IonLabel>
          <IonInput v-model="refundForm.invoiceId" data-testid="refund-invoice-id" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Amount in cents (optional — full refund if blank)</IonLabel>
          <IonInput v-model="refundForm.amountCents" type="number" inputmode="numeric" data-testid="refund-amount" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Reason (required)</IonLabel>
          <IonTextarea v-model="refundForm.reason" :rows="2" data-testid="refund-reason" />
        </IonItem>
        <IonItem lines="none">
          <input type="checkbox" v-model="refundForm.confirmed" id="refund-confirm" data-testid="refund-confirm" />
          <label for="refund-confirm" style="margin-left: 8px;">I confirm this refund is authorized.</label>
        </IonItem>
        <IonButton
          color="warning"
          :disabled="submitting || !refundForm.confirmed || !refundForm.invoiceId || !refundForm.reason"
          data-testid="refund-submit"
          @click="submitRefund"
        >Issue refund</IonButton>
      </IonContent>
    </IonModal>

    <!-- Credit modal -->
    <IonModal :is-open="creditModal" @did-dismiss="creditModal = false" data-testid="credit-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Apply a one-time credit</IonTitle>
          <IonButtons slot="end"><IonButton @click="creditModal = false">Cancel</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent class="ion-padding">
        <p style="color: var(--ion-color-medium); font-size: 13px;">
          Reduces the customer's running Stripe balance, applied to the next invoice.
        </p>
        <IonItem>
          <IonLabel position="stacked">Amount in cents (positive — Stripe stores as negative balance)</IonLabel>
          <IonInput v-model="creditForm.amountCents" type="number" inputmode="numeric" data-testid="credit-amount" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Reason (required)</IonLabel>
          <IonTextarea v-model="creditForm.reason" :rows="2" data-testid="credit-reason" />
        </IonItem>
        <IonItem lines="none">
          <input type="checkbox" v-model="creditForm.confirmed" id="credit-confirm" data-testid="credit-confirm" />
          <label for="credit-confirm" style="margin-left: 8px;">I confirm this credit is authorized.</label>
        </IonItem>
        <IonButton
          color="primary"
          :disabled="submitting || !creditForm.confirmed || !creditForm.amountCents || !creditForm.reason"
          data-testid="credit-submit"
          @click="submitCredit"
        >Apply credit</IonButton>
      </IonContent>
    </IonModal>

    <!-- Comp modal -->
    <IonModal :is-open="compModal" @did-dismiss="compModal = false" data-testid="comp-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Comp the customer</IonTitle>
          <IonButtons slot="end"><IonButton @click="compModal = false">Cancel</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent class="ion-padding">
        <p style="color: var(--ion-color-medium); font-size: 13px;">
          Applies a 100%-off coupon for the next N billing cycles.
        </p>
        <IonItem>
          <IonLabel position="stacked">Periods (months)</IonLabel>
          <IonInput v-model="compForm.periodsCount" type="number" inputmode="numeric" data-testid="comp-periods" />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Reason (required)</IonLabel>
          <IonTextarea v-model="compForm.reason" :rows="2" data-testid="comp-reason" />
        </IonItem>
        <IonItem lines="none">
          <input type="checkbox" v-model="compForm.confirmed" id="comp-confirm" data-testid="comp-confirm" />
          <label for="comp-confirm" style="margin-left: 8px;">I confirm this comp is authorized.</label>
        </IonItem>
        <IonButton
          color="primary"
          :disabled="submitting || !compForm.confirmed || !compForm.reason"
          data-testid="comp-submit"
          @click="submitComp"
        >Apply comp</IonButton>
      </IonContent>
    </IonModal>
  </div>
</template>
