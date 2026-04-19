<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonModal, IonButton, IonIcon, IonSpinner, IonNote } from '@ionic/vue';
import { closeOutline, chatbubbleEllipsesOutline, trendingUpOutline } from 'ionicons/icons';
import { useAuthStore } from '../stores/auth.store';

interface MemberDetail {
  user: { id: string; display_name: string | null };
  role: string;
  joined_at: string;
  active_positions_count: number;
  accuracy_pct: number | null;
  last_active_at: string | null;
}

const props = defineProps<{
  open: boolean;
  clubId: string;
  userId: string;
}>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const auth = useAuthStore();

const detail = ref<MemberDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const isSelf = computed(() => detail.value?.user.id === auth.userId);

async function load() {
  detail.value = null;
  error.value = null;
  loading.value = true;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
    const res = await fetch(`/api/clubs/${props.clubId}/members/${props.userId}`, { headers });
    if (!res.ok) throw new Error(`${res.status}`);
    detail.value = await res.json() as MemberDetail;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.userId] as const,
  ([isOpen]) => { if (isOpen && props.userId) load(); },
  { immediate: true },
);

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v}%`;
}

function messageUser() {
  router.push({ path: '/messages', query: { to: props.userId } });
  emit('close');
}

function viewPredictions() {
  router.push(`/clubs/${props.clubId}?tab=members`);
  emit('close');
}
</script>

<template>
  <IonModal
    :is-open="open"
    @did-dismiss="emit('close')"
    :breakpoints="[0, 0.45, 0.9]"
    :initial-breakpoint="0.45"
    class="member-drawer-modal"
  >
    <div class="drawer">
      <div class="drawer-head">
        <h3 class="drawer-title">Member Profile</h3>
        <IonButton fill="clear" size="small" @click="emit('close')" aria-label="Close">
          <IonIcon :icon="closeOutline" />
        </IonButton>
      </div>

      <div v-if="loading" class="drawer-state"><IonSpinner name="dots" /></div>
      <div v-else-if="error" class="drawer-state error">Failed to load ({{ error }}).</div>
      <div v-else-if="detail" class="drawer-body">
        <div class="identity-row">
          <div class="avatar">{{ (detail.user.display_name ?? detail.user.id).slice(0, 1).toUpperCase() }}</div>
          <div class="identity-text">
            <div class="display-name">
              {{ detail.user.display_name || detail.user.id.slice(0, 8) }}
              <span v-if="isSelf" class="you-badge-inline">YOU</span>
            </div>
            <IonNote class="role-note">{{ detail.role }} · joined {{ formatDate(detail.joined_at) }}</IonNote>
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat">
            <span class="stat-label">Active positions</span>
            <span class="stat-value">{{ detail.active_positions_count }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Accuracy</span>
            <span class="stat-value">{{ fmtPct(detail.accuracy_pct) }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Last active</span>
            <span class="stat-value">{{ formatRelative(detail.last_active_at) }}</span>
          </div>
        </div>

        <div class="drawer-actions">
          <IonButton v-if="!isSelf" size="small" fill="outline" @click="messageUser">
            <IonIcon slot="start" :icon="chatbubbleEllipsesOutline" />
            Message
          </IonButton>
          <IonButton v-else size="small" fill="outline" disabled title="You can't message yourself">
            <IonIcon slot="start" :icon="chatbubbleEllipsesOutline" />
            Message
          </IonButton>
          <IonButton size="small" fill="outline" @click="viewPredictions">
            <IonIcon slot="start" :icon="trendingUpOutline" />
            View all analyses
          </IonButton>
        </div>
      </div>
    </div>
  </IonModal>
</template>

<style scoped>
.drawer { padding: 18px 20px 26px; }
.drawer-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.drawer-title { margin: 0; font-size: 1.05rem; font-weight: 600; }
.drawer-state { padding: 24px; text-align: center; color: var(--ion-color-medium); }
.drawer-state.error { color: var(--ion-color-danger); }
.drawer-body { display: flex; flex-direction: column; gap: 18px; }
.identity-row { display: flex; align-items: center; gap: 12px; }
.avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: rgba(88, 86, 214, 0.15);
  color: var(--ion-color-primary);
  display: grid; place-items: center;
  font-weight: 700; font-size: 1.25rem;
}
.display-name { font-weight: 600; font-size: 1rem; display: flex; align-items: center; gap: 6px; }
.you-badge-inline {
  font-size: 0.65rem; font-weight: 700; letter-spacing: 0.05em;
  padding: 2px 5px; border-radius: 4px;
  background: rgba(88, 86, 214, 0.18); color: var(--ion-color-primary);
}
.role-note { font-size: 0.8rem; text-transform: capitalize; }
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.stat {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px;
  background: var(--ion-color-light);
  border-radius: 8px;
  font-size: 0.85rem;
}
.stat-label { color: var(--ion-color-medium); font-size: 0.75rem; }
.stat-value { font-weight: 600; font-size: 1rem; }
.drawer-actions { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
