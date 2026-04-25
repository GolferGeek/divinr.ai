<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useApi } from '../composables/useApi';
import { useFirstTouch } from '../composables/useFirstTouch';
import FirstTouchPanel from '../components/FirstTouchPanel.vue';

useFirstTouch('admin.billing-webhook-health');

interface DayRow { day: string; processed: number; failed: number; pending: number }
const days = ref<DayRow[]>([]);
const loading = ref(false);
const errorMsg = ref<string | null>(null);

async function load() {
  loading.value = true;
  errorMsg.value = null;
  try {
    const api = useApi('/api/admin/billing');
    const res = await api.get<{ days: DayRow[] }>('/webhook-health');
    days.value = res.days ?? [];
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div style="padding: 16px; max-width: 1100px; margin: 0 auto;">
    <h2>Stripe webhook health</h2>
    <p style="color: var(--ion-color-medium); font-size: 14px;">
      Last 7 days of webhook delivery counts. Non-zero <strong>failed</strong> means a handler threw —
      check the per-user Stripe Events panel under <code>/admin/users/:id/billing</code> for the specific
      <code>handler_error</code>. <strong>Pending</strong> rows are events received but not yet processed
      (the webhook controller writes <code>processed_at</code> on success).
    </p>

    <button
      style="margin: 0 0 16px; padding: 6px 12px; cursor: pointer;"
      :disabled="loading"
      data-testid="webhook-health-refresh"
      @click="load"
    >{{ loading ? 'Loading…' : 'Refresh' }}</button>

    <div v-if="errorMsg" style="padding: 12px; background: var(--ion-color-warning-tint, #fff3e0); border-radius: 8px; margin-bottom: 16px;">
      Failed to load: {{ errorMsg }}
    </div>

    <table v-if="days.length > 0" data-testid="webhook-health-table" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="text-align: left; border-bottom: 2px solid var(--ion-color-medium);">
          <th style="padding: 8px;">Date</th>
          <th style="padding: 8px; text-align: right;">Processed</th>
          <th style="padding: 8px; text-align: right;">Failed</th>
          <th style="padding: 8px; text-align: right;">Pending</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in days" :key="row.day" style="border-bottom: 1px solid var(--ion-color-light);">
          <td style="padding: 8px; font-family: monospace;">{{ row.day }}</td>
          <td style="padding: 8px; text-align: right; color: var(--ion-color-success);">{{ row.processed }}</td>
          <td style="padding: 8px; text-align: right;" :style="{ color: row.failed > 0 ? 'var(--ion-color-danger)' : 'inherit', fontWeight: row.failed > 0 ? 'bold' : 'normal' }">{{ row.failed }}</td>
          <td style="padding: 8px; text-align: right;" :style="{ color: row.pending > 0 ? 'var(--ion-color-warning)' : 'inherit' }">{{ row.pending }}</td>
        </tr>
      </tbody>
    </table>
    <div
      v-else-if="!loading && !errorMsg"
      style="padding: 32px; text-align: center; color: var(--ion-color-medium);"
      data-testid="webhook-health-empty"
    >
      No Stripe webhook events received in the last 7 days. (Either Stripe is not configured, or no traffic — see <code>/api/config/public</code>.)
    </div>

    <FirstTouchPanel surface-key="admin.billing-webhook-health" />
  </div>
</template>
