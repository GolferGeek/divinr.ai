<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle,
  IonContent, IonIcon, IonLabel, IonChip, IonButton,
  IonButtons, IonPopover, IonList, IonItem, IonModal,
} from '@ionic/vue';
import {
  gridOutline, statsChartOutline, peopleOutline, playOutline,
  shieldOutline, briefcaseOutline, newspaperOutline,
  ribbonOutline, bulbOutline, logOutOutline, earthOutline, pulseOutline,
  menuOutline, constructOutline, heartOutline, notificationsOutline,
  warningOutline, gitNetworkOutline, trendingUpOutline,
  chatbubblesOutline, trophyOutline, peopleCircleOutline,
  chevronDownOutline, chevronForwardOutline, compassOutline,
  createOutline, analyticsOutline, ellipsisHorizontalOutline,
  schoolOutline,
} from 'ionicons/icons';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useAuthStore } from '../stores/auth.store';
import { useDomainStore } from '../stores/domain.store';
import { useActivityStore } from '../stores/activity.store';
import { useAffinityStore } from '../stores/affinity.store';
import { useNotificationStore } from '../stores/notification.store';
import { useFearGreedStore } from '../stores/fear-greed.store';
import { useMessagingStore } from '../stores/messaging.store';
import { useOnboardingStore } from '../stores/onboarding.store';
import { useFirstTouchStore } from '../stores/firstTouch.store';
import { useBillingStatusStore } from '../stores/billing-status.store';
import { useMasteryStore } from '../stores/mastery.store';
import ActivityPanel from '../components/ActivityPanel.vue';
import WelcomeModal from '../components/WelcomeModal.vue';
import DocentPanel from '../components/DocentPanel.vue';
import CompletionModal from '../components/CompletionModal.vue';
import ElementHighlighter from '../components/ElementHighlighter.vue';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';
import ReadOnlyBanner from '../components/ReadOnlyBanner.vue';
import TrialCountdown from '../components/TrialCountdown.vue';
import LearningPanelSurface from '../components/LearningPanelSurface.vue';
import { masteryNavGroups } from '../mastery/mastery-config';

const auth = useAuthStore();
const domain = useDomainStore();
const activity = useActivityStore();
const affinityStore = useAffinityStore();
const notificationStore = useNotificationStore();
const fearGreedStore = useFearGreedStore();
const messagingStore = useMessagingStore();
const onboarding = useOnboardingStore();
const firstTouchStore = useFirstTouchStore();
const billing = useBillingStatusStore();
const mastery = useMasteryStore();
const route = useRoute();
const router = useRouter();
const sidebarOpen = ref(false);
const learningPanelOpen = ref(false);
const mobileViewport = ref(typeof window !== 'undefined' ? window.innerWidth < 960 : false);

const collapsedGroups = ref<Record<string, boolean>>({});

function toggleGroup(label: string) {
  collapsedGroups.value[label] = !collapsedGroups.value[label];
}

function isGroupCollapsed(label: string): boolean {
  return !!collapsedGroups.value[label];
}

const visibleGroups = computed(() =>
  masteryNavGroups
    .filter(g => !g.adminOnly || auth.isAdmin)
    .map(g => ({
      ...g,
      items: g.items.filter((i) => {
        if (i.adminOnly && !auth.isAdmin) return false;
        return mastery.canViewLevel(i.minLevel, i.alwaysVisible);
      }),
    }))
    .filter(g => g.items.length > 0),
);
const showActivityFooter = computed(() => mastery.canViewLevel('competitive_participation'));
const showLearningPanelNav = computed(() => mastery.canViewLevel('core_trading'));

// Load contrarian alerts and notification count on mount
affinityStore.fetchContrarianAlerts(true);
notificationStore.fetchUnreadCount();
fearGreedStore.fetchUnreadCount();
messagingStore.fetchUnreadCounts();
onboarding.fetch().catch(() => { /* non-fatal if API down; welcome modal simply stays hidden */ });
firstTouchStore.fetch().catch(() => { /* non-fatal; panels stay hidden */ });
billing.fetch().catch(() => { /* non-fatal; banners stay hidden */ });
mastery.fetch().catch(() => { /* non-fatal; shell falls back to Level 1 visibility */ });
billing.startAutoRefresh();

function logout() {
  auth.clear();
  onboarding.clear();
  firstTouchStore.clear();
  billing.clear();
  mastery.clear();
  router.push('/login');
}

function handleNavClick(path: string) {
  sidebarOpen.value = false;
  if (path === '/chat' && route.path !== '/chat') {
    openLearningPanel();
    return;
  }
  router.push(path);
}

function syncViewport() {
  mobileViewport.value = typeof window !== 'undefined' ? window.innerWidth < 960 : false;
}

const learningPanelSurfaceKey = computed(() => {
  const path = route.path;
  if (path === '/' || path.startsWith('/domain/')) return 'dashboard';
  if (path.startsWith('/predictions')) return 'predictions';
  if (path.startsWith('/risk')) return 'risk-dashboard';
  if (path.startsWith('/portfolios') || path === '/portfolio') return 'portfolios';
  if (path.startsWith('/clubs/')) return 'club.detail';
  if (path.startsWith('/clubs')) return 'clubs';
  if (path.startsWith('/tournaments')) return 'tournaments';
  if (path.startsWith('/messages')) return 'messages';
  if (path.startsWith('/analysts')) return 'analysts';
  if (path.startsWith('/performance')) return 'performance';
  if (path.startsWith('/instruments')) return 'instruments';
  if (path.startsWith('/settings/authored-content')) return 'authored.overview';
  return 'chat';
});

const learningPanelInstrumentId = computed(() => {
  const queryInstrumentId = route.query.instrumentId;
  if (typeof queryInstrumentId === 'string' && queryInstrumentId.length > 0) {
    return queryInstrumentId;
  }
  if (route.path.startsWith('/instruments/')) {
    const routeId = route.params.id;
    if (typeof routeId === 'string' && routeId.length > 0) return routeId;
  }
  return '';
});

function openLearningPanel() {
  sidebarOpen.value = false;
  if (route.path === '/chat') return;
  if (activity.panelOpen) activity.panelOpen = false;
  learningPanelOpen.value = true;
}

function toggleLearningPanel() {
  if (learningPanelOpen.value) {
    learningPanelOpen.value = false;
    return;
  }
  openLearningPanel();
}

function handleActivityToggle() {
  if (!activity.panelOpen && learningPanelOpen.value) {
    learningPanelOpen.value = false;
  }
  activity.toggle();
}

async function retakeOnboarding() {
  if (onboarding.active) {
    if (!window.confirm('Restart the tour? Your current progress will be reset.')) return;
  }
  await onboarding.restart();
  await router.push(onboarding.currentStepPath);
  onboarding.openDocent();
}

async function resetUserOnboarding() {
  const userId = window.prompt('Enter the user ID to reset onboarding for:');
  if (!userId || !userId.trim()) return;
  try {
    await onboarding.resetForUser(userId.trim());
    window.alert(`Onboarding reset for user ${userId.trim()}.`);
  } catch (err) {
    window.alert(`Failed to reset: ${err instanceof Error ? err.message : String(err)}`);
  }
}

onMounted(() => {
  syncViewport();
  window.addEventListener('resize', syncViewport);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport);
});
</script>

<template>
  <ion-page>
    <div class="app-shell">
      <nav class="sidebar" :class="{ 'sidebar-mobile-open': sidebarOpen }">
        <div class="sidebar-header">Divinr AI</div>
        <ul class="sidebar-nav">
          <template v-for="group in visibleGroups" :key="group.label">
            <li
              v-if="group.label"
              class="sidebar-group-header"
              @click="toggleGroup(group.label)"
            >
              <span class="group-label">{{ group.label }}</span>
              <ion-icon
                :icon="isGroupCollapsed(group.label) ? chevronForwardOutline : chevronDownOutline"
                class="group-chevron"
              />
            </li>
            <template v-if="!isGroupCollapsed(group.label)">
              <li
                v-for="item in group.items"
                :key="item.to"
                class="sidebar-item"
                :class="{ active: $route.path === item.to || (item.to === '/chat' && learningPanelOpen) }"
                role="link"
                tabindex="0"
                :aria-label="item.title"
                @click="handleNavClick(item.to)"
                @keyup.enter="handleNavClick(item.to)"
              >
                <ion-icon :icon="item.icon" />
                <span>{{ item.title }}</span>
              </li>
            </template>
          </template>
        </ul>
        <div v-if="showActivityFooter" class="sidebar-footer">
          <button
            class="activity-btn"
            :class="{ active: activity.panelOpen }"
            @click="handleActivityToggle()"
          >
            <ion-icon :icon="pulseOutline" />
            <span>Activity</span>
            <span v-if="activity.connected" class="live-dot" />
          </button>
        </div>
        <div v-if="showLearningPanelNav" class="sidebar-learning">
          <button
            class="learning-nav-btn"
            :class="{ active: learningPanelOpen || route.path === '/chat' }"
            type="button"
            @click="handleNavClick('/chat')"
          >
            <ion-icon :icon="bulbOutline" />
            <span>Learning Panel</span>
          </button>
        </div>
      </nav>
      <div class="main-area">
        <ion-header>
          <ion-toolbar>
            <ion-buttons slot="start" class="hamburger-btn">
              <ion-button @click="sidebarOpen = !sidebarOpen" aria-label="Toggle navigation menu">
                <ion-icon slot="icon-only" :icon="menuOutline" />
              </ion-button>
            </ion-buttons>
            <ion-title>Divinr AI</ion-title>
            <ion-buttons slot="end">
              <ion-chip color="medium" outline class="chrome-desktop-only">
                <ion-icon :icon="earthOutline" />
                <ion-label class="header-universe-label">{{ domain.activeUniverse }}</ion-label>
              </ion-chip>
              <ion-button fill="clear" class="notification-bell fear-greed-bell chrome-desktop-only" @click="router.push('/fear-greed-alerts')" v-if="fearGreedStore.unreadCount > 0" title="Fear & Greed alerts — unread market-sentiment signals">
                <ion-icon :icon="warningOutline" />
                <span class="notification-badge fear-greed-badge">{{ fearGreedStore.unreadCount > 9 ? '9+' : fearGreedStore.unreadCount }}</span>
              </ion-button>
              <ion-button fill="clear" class="notification-bell chrome-desktop-only" @click="router.push('/messages')" title="Messages — unread DMs and club chats">
                <ion-icon :icon="chatbubblesOutline" />
                <span v-if="messagingStore.totalUnread > 0" class="notification-badge">{{ messagingStore.totalUnread > 9 ? '9+' : messagingStore.totalUnread }}</span>
              </ion-button>
              <ion-button fill="clear" class="notification-bell chrome-desktop-only" @click="router.push('/notifications')" title="Notifications — rank changes, mentor activity, system updates">
                <ion-icon :icon="notificationsOutline" />
                <span v-if="notificationStore.unreadCount > 0" class="notification-badge">{{ notificationStore.unreadCount > 9 ? '9+' : notificationStore.unreadCount }}</span>
              </ion-button>
              <ion-button
                fill="clear"
                class="notification-bell chrome-desktop-only"
                aria-label="Open Learning Panel"
                title="Open Learning Panel"
                @click="toggleLearningPanel"
              >
                <ion-icon :icon="bulbOutline" />
              </ion-button>
              <ion-button
                fill="clear"
                id="mobile-chrome-trigger"
                class="notification-bell chrome-mobile-only chrome-mobile-overflow-btn"
                aria-label="Open notifications menu"
              >
                <ion-icon :icon="ellipsisHorizontalOutline" />
                <span
                  v-if="(fearGreedStore.unreadCount + messagingStore.totalUnread + notificationStore.unreadCount) > 0"
                  class="notification-badge"
                >{{ Math.min(fearGreedStore.unreadCount + messagingStore.totalUnread + notificationStore.unreadCount, 99) > 9 ? '9+' : (fearGreedStore.unreadCount + messagingStore.totalUnread + notificationStore.unreadCount) }}</span>
              </ion-button>
              <ion-popover trigger="mobile-chrome-trigger" trigger-action="click" dismiss-on-select>
                <ion-content>
                  <ion-list>
                    <ion-item :detail="false">
                      <ion-icon slot="start" :icon="earthOutline" />
                      <ion-label>Universe: {{ domain.activeUniverse }}</ion-label>
                    </ion-item>
                    <ion-item v-if="fearGreedStore.unreadCount > 0" button :detail="false" @click="router.push('/fear-greed-alerts')">
                      <ion-icon slot="start" :icon="warningOutline" />
                      <ion-label>Fear &amp; Greed</ion-label>
                      <span class="chrome-mobile-popover-badge warning">{{ fearGreedStore.unreadCount > 9 ? '9+' : fearGreedStore.unreadCount }}</span>
                    </ion-item>
                    <ion-item button :detail="false" @click="router.push('/messages')">
                      <ion-icon slot="start" :icon="chatbubblesOutline" />
                      <ion-label>Messages</ion-label>
                      <span v-if="messagingStore.totalUnread > 0" class="chrome-mobile-popover-badge">{{ messagingStore.totalUnread > 9 ? '9+' : messagingStore.totalUnread }}</span>
                    </ion-item>
                    <ion-item button :detail="false" @click="router.push('/notifications')">
                      <ion-icon slot="start" :icon="notificationsOutline" />
                      <ion-label>Notifications</ion-label>
                      <span v-if="notificationStore.unreadCount > 0" class="chrome-mobile-popover-badge">{{ notificationStore.unreadCount > 9 ? '9+' : notificationStore.unreadCount }}</span>
                    </ion-item>
                    <ion-item button :detail="false" @click="toggleLearningPanel">
                      <ion-icon slot="start" :icon="bulbOutline" />
                      <ion-label>Learning Panel</ion-label>
                    </ion-item>
                  </ion-list>
                </ion-content>
              </ion-popover>
              <ion-chip v-if="auth.isBetaReader" color="warning" outline>
                <ion-label>Read Only</ion-label>
              </ion-chip>
              <TrialCountdown />
              <ion-button
                v-if="onboarding.active"
                fill="clear"
                class="tour-compass-btn"
                aria-label="Reopen onboarding tour"
                @click="onboarding.openDocent()"
              >
                <ion-icon :icon="compassOutline" />
                <span v-if="!onboarding.docentVisible" class="tour-progress-badge">
                  {{ onboarding.progress.done }}/{{ onboarding.progress.total }}
                </span>
              </ion-button>
              <ion-chip
                id="user-menu-trigger"
                color="medium"
                class="header-user-chip"
                role="button"
                tabindex="0"
              >
                <ion-label>{{ auth.displayName }}</ion-label>
                <ion-icon :icon="chevronDownOutline" />
              </ion-chip>
              <ion-popover trigger="user-menu-trigger" trigger-action="click" dismiss-on-select>
                <ion-content>
                  <ion-list>
                    <ion-item button :detail="false" @click="retakeOnboarding">
                      <ion-icon slot="start" :icon="compassOutline" />
                      <ion-label>Retake onboarding tour</ion-label>
                    </ion-item>
                    <ion-item
                      v-if="auth.isSuperAdmin"
                      button
                      :detail="false"
                      @click="resetUserOnboarding"
                    >
                      <ion-icon slot="start" :icon="constructOutline" />
                      <ion-label>Reset onboarding for user…</ion-label>
                    </ion-item>
                    <ion-item button :detail="false" @click="logout">
                      <ion-icon slot="start" :icon="logOutOutline" />
                      <ion-label>Log out</ion-label>
                    </ion-item>
                  </ion-list>
                </ion-content>
              </ion-popover>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
          <ReadOnlyBanner />
          <router-view />
          <div class="legal-footer">
            <LegalDisclaimer variant="short" />
            <router-link to="/terms" style="margin-left:8px;color:inherit;opacity:0.8">Terms of Service</router-link>
          </div>
        </ion-content>
      </div>
    </div>
    <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
    <ActivityPanel />
    <button
      v-if="route.path !== '/chat'"
      class="learning-panel-fab"
      :class="{ active: learningPanelOpen }"
      type="button"
      aria-label="Open Learning Panel quick access"
      title="Open Learning Panel"
      @click="toggleLearningPanel"
    >
      <ion-icon :icon="bulbOutline" />
    </button>
    <IonModal
      :is-open="learningPanelOpen"
      @did-dismiss="learningPanelOpen = false"
      :breakpoints="mobileViewport ? [0, 0.72, 1] : undefined"
      :initial-breakpoint="mobileViewport ? 0.72 : undefined"
      class="learning-panel-modal"
    >
      <LearningPanelSurface
        embedded
        show-close
        :surface-key="learningPanelSurfaceKey"
        :instrument-id="learningPanelInstrumentId"
        @close="learningPanelOpen = false"
      />
    </IonModal>
    <WelcomeModal />
    <DocentPanel />
    <CompletionModal />
    <ElementHighlighter />
  </ion-page>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
  width: 100%;
}

.sidebar {
  width: 220px;
  min-width: 220px;
  background: #fff;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar-header {
  padding: 16px 20px;
  padding-top: calc(16px + env(safe-area-inset-top, 0px));
  font-size: 1.2rem;
  font-weight: 700;
  color: #fff;
  background: var(--ion-color-primary, #3880ff);
}

.sidebar-nav {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  flex: 1;
}

.sidebar-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 4px;
  margin-top: 4px;
  cursor: pointer;
  user-select: none;
}

.group-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #999;
}

.group-chevron {
  font-size: 0.7rem;
  color: #bbb;
}

.sidebar-group-header:hover .group-label {
  color: #666;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  min-height: 44px;
  cursor: pointer;
  color: #333;
  font-size: 0.93rem;
  transition: background 0.15s;
}

.sidebar-item:hover {
  background: #f0f0f0;
}

.sidebar-item.active {
  background: #e8f0fe;
  color: var(--ion-color-primary, #3880ff);
  font-weight: 600;
}

.tour-compass-btn {
  position: relative;
}

.header-user-chip {
  cursor: pointer;
}

.learning-panel-modal {
  --width: min(100vw, 460px);
  --max-width: 460px;
  --height: 100%;
  --border-radius: 18px 0 0 18px;
}

.learning-panel-modal::part(content) {
  overflow: hidden;
}

.learning-panel-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 54px;
  height: 54px;
  border: none;
  border-radius: 50%;
  background: var(--ion-color-primary, #3880ff);
  color: #fff;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.24);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  cursor: pointer;
}

.learning-panel-fab ion-icon {
  font-size: 1.3rem;
}

.learning-panel-fab.active {
  background: var(--ion-color-primary-shade, #3171e0);
}

.tour-progress-badge {
  position: absolute;
  top: 4px;
  right: 2px;
  background: var(--ion-color-primary, #3880ff);
  color: #fff;
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 8px;
  font-weight: 600;
  line-height: 1.2;
}

.sidebar-item ion-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.sidebar-footer {
  padding: 8px 12px;
  border-top: 1px solid #e0e0e0;
}

.sidebar-learning {
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid #e0e0e0;
}

.learning-nav-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 12px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #333;
  cursor: pointer;
  font-size: 0.93rem;
  text-align: left;
}

.learning-nav-btn:hover {
  background: #f0f0f0;
}

.learning-nav-btn.active {
  background: #e8f0fe;
  color: var(--ion-color-primary, #3880ff);
  font-weight: 600;
}

.learning-nav-btn ion-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.activity-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 8px;
  min-height: 44px;
  border: none;
  border-radius: 6px;
  background: #1a1a2e;
  color: #ccc;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.15s;
}

.activity-btn:hover {
  background: #16213e;
  color: #fff;
}

.activity-btn.active {
  background: #0f3460;
  color: #43a047;
}

.activity-btn ion-icon {
  font-size: 1.1rem;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #43a047;
  margin-left: auto;
  animation: pulse-dot 2s infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}

.hamburger-btn {
  display: none;
}

@media (max-width: 768px) {
  .hamburger-btn {
    display: flex;
  }

  .sidebar {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 1000;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.2);
  }

  .sidebar.sidebar-mobile-open {
    display: flex;
  }

  .sidebar-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 999;
  }

  .learning-panel-fab {
    right: 14px;
    bottom: 14px;
    width: 50px;
    height: 50px;
  }
}

.notification-bell {
  position: relative;
  min-width: 44px;
  min-height: 44px;
}

.notification-badge {
  position: absolute;
  top: -2px;
  right: -6px;
  background: var(--ion-color-danger, #eb445a);
  color: #fff;
  font-size: 0.6rem;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  pointer-events: none;
  box-shadow: 0 0 0 2px #fff;
}

.fear-greed-bell ion-icon {
  color: var(--ion-color-warning, #ffc409);
}

.fear-greed-badge {
  background: var(--ion-color-warning, #ffc409) !important;
  color: #000 !important;
}

.legal-footer {
  text-align: center;
  font-size: 0.7rem;
  opacity: 0.4;
  padding: 24px 16px 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  margin-top: 40px;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

ion-toolbar {
  padding-top: env(safe-area-inset-top, 0px);
}

@media (max-width: 414px) {
  .header-universe-label {
    display: none;
  }

  .header-user-chip ion-label {
    max-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  ion-toolbar ion-buttons[slot="end"] {
    gap: 0;
  }

  ion-toolbar ion-buttons[slot="end"] ion-chip {
    padding: 0 4px;
    font-size: 0.75rem;
  }
}

@media (max-width: 600px) {
  .main-area ion-title { display: none; }
  .chrome-desktop-only { display: none !important; }
}

@media (min-width: 601px) {
  .chrome-mobile-only { display: none !important; }
}

@media (max-width: 959px) {
  .learning-panel-modal {
    --width: 100vw;
    --max-width: 100vw;
    --height: min(92vh, 900px);
    --border-radius: 18px 18px 0 0;
  }
}

.chrome-mobile-overflow-btn {
  position: relative;
  min-width: 44px;
  min-height: 44px;
}

.chrome-mobile-popover-item {
  position: relative;
}

.chrome-mobile-popover-badge {
  background: var(--ion-color-danger, #eb445a);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  margin-left: auto;
}

.chrome-mobile-popover-badge.warning {
  background: var(--ion-color-warning, #ffc409);
  color: #000;
}
</style>
