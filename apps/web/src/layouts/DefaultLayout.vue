<script setup lang="ts">
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle,
  IonContent, IonIcon, IonLabel, IonChip, IonButton,
  IonButtons, IonRouterOutlet,
} from '@ionic/vue';
import {
  gridOutline, statsChartOutline, peopleOutline, playOutline,
  shieldOutline, briefcaseOutline, newspaperOutline,
  ribbonOutline, bulbOutline, logOutOutline, earthOutline, pulseOutline,
  menuOutline, constructOutline, heartOutline, notificationsOutline,
  warningOutline, gitNetworkOutline, trendingUpOutline,
  chatbubblesOutline, trophyOutline, peopleCircleOutline,
  chevronDownOutline, chevronForwardOutline,
} from 'ionicons/icons';
import { ref, computed } from 'vue';
import { useAuthStore } from '../stores/auth.store';
import { useDomainStore } from '../stores/domain.store';
import { useActivityStore } from '../stores/activity.store';
import { useAffinityStore } from '../stores/affinity.store';
import { useNotificationStore } from '../stores/notification.store';
import { useFearGreedStore } from '../stores/fear-greed.store';
import { useMessagingStore } from '../stores/messaging.store';
import ActivityPanel from '../components/ActivityPanel.vue';

const auth = useAuthStore();
const domain = useDomainStore();
const activity = useActivityStore();
const affinityStore = useAffinityStore();
const notificationStore = useNotificationStore();
const fearGreedStore = useFearGreedStore();
const messagingStore = useMessagingStore();
const router = useRouter();
const sidebarOpen = ref(false);

interface NavItem {
  title: string;
  icon: string;
  to: string;
}

interface NavGroup {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      { title: 'Dashboard', icon: gridOutline, to: '/' },
    ],
  },
  {
    label: 'Markets',
    items: [
      { title: 'Instruments', icon: statsChartOutline, to: '/instruments' },
      { title: 'Portfolios', icon: briefcaseOutline, to: '/portfolios' },
      { title: 'Risk', icon: shieldOutline, to: '/risk' },
    ],
  },
  {
    label: 'AI Analysts',
    items: [
      { title: 'Analysts', icon: peopleOutline, to: '/analysts' },
      { title: 'Performance', icon: trendingUpOutline, to: '/performance' },
      { title: 'Coordination', icon: gitNetworkOutline, to: '/coordination' },
      { title: 'Affinity', icon: heartOutline, to: '/affinity' },
    ],
  },
  {
    label: 'Community',
    items: [
      { title: 'Clubs', icon: peopleCircleOutline, to: '/clubs' },
      { title: 'Tournaments', icon: trophyOutline, to: '/tournaments' },
      { title: 'Messages', icon: chatbubblesOutline, to: '/messages' },
    ],
  },
  {
    label: 'System',
    adminOnly: true,
    items: [
      { title: 'Runs', icon: playOutline, to: '/runs' },
      { title: 'Sources', icon: newspaperOutline, to: '/sources' },
      { title: 'Evaluations', icon: ribbonOutline, to: '/evaluations' },
      { title: 'Learning', icon: bulbOutline, to: '/learning' },
      { title: 'Proposals', icon: constructOutline, to: '/proposals' },
    ],
  },
];

const collapsedGroups = ref<Record<string, boolean>>({});

function toggleGroup(label: string) {
  collapsedGroups.value[label] = !collapsedGroups.value[label];
}

function isGroupCollapsed(label: string): boolean {
  return !!collapsedGroups.value[label];
}

const visibleGroups = computed(() =>
  navGroups.filter(g => !g.adminOnly || auth.isAdmin),
);

// Load contrarian alerts and notification count on mount
affinityStore.fetchContrarianAlerts(true);
notificationStore.fetchUnreadCount();
fearGreedStore.fetchUnreadCount();
messagingStore.fetchUnreadCounts();

function logout() {
  auth.clear();
  router.push('/login');
}
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
                :class="{ active: $route.path === item.to }"
                role="link"
                tabindex="0"
                @click="router.push(item.to); sidebarOpen = false"
                @keyup.enter="router.push(item.to); sidebarOpen = false"
              >
                <ion-icon :icon="item.icon" />
                <span>{{ item.title }}</span>
              </li>
            </template>
          </template>
        </ul>
        <div class="sidebar-footer">
          <button
            class="activity-btn"
            :class="{ active: activity.panelOpen }"
            @click="activity.toggle()"
          >
            <ion-icon :icon="pulseOutline" />
            <span>Activity</span>
            <span v-if="activity.connected" class="live-dot" />
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
              <ion-chip color="medium" outline>
                <ion-icon :icon="earthOutline" />
                <ion-label class="header-universe-label">{{ domain.activeUniverse }}</ion-label>
              </ion-chip>
              <ion-button fill="clear" class="notification-bell fear-greed-bell" @click="router.push('/fear-greed-alerts')" v-if="fearGreedStore.unreadCount > 0">
                <ion-icon :icon="warningOutline" />
                <span class="notification-badge fear-greed-badge">{{ fearGreedStore.unreadCount }}</span>
              </ion-button>
              <ion-button fill="clear" class="notification-bell" @click="router.push('/messages')">
                <ion-icon :icon="chatbubblesOutline" />
                <span v-if="messagingStore.totalUnread > 0" class="notification-badge">{{ messagingStore.totalUnread }}</span>
              </ion-button>
              <ion-button fill="clear" class="notification-bell" @click="router.push('/notifications')">
                <ion-icon :icon="notificationsOutline" />
                <span v-if="notificationStore.unreadCount > 0" class="notification-badge">{{ notificationStore.unreadCount }}</span>
              </ion-button>
              <ion-chip v-if="auth.isBetaReader" color="warning" outline>
                <ion-label>Read Only</ion-label>
              </ion-chip>
              <ion-chip color="medium" class="header-user-chip">
                <ion-label>{{ auth.displayName }}</ion-label>
              </ion-chip>
              <ion-button fill="clear" @click="logout">
                <ion-icon :icon="logOutOutline" />
              </ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
          <router-view />
          <div class="legal-footer">
            Divinr provides AI-generated analysis and signals for educational purposes. Not investment advice.
            <router-link to="/terms" style="margin-left:8px;color:inherit;opacity:0.8">Terms of Service</router-link>
          </div>
        </ion-content>
      </div>
    </div>
    <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
    <ActivityPanel />
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

.sidebar-item ion-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.sidebar-footer {
  padding: 8px 12px;
  border-top: 1px solid #e0e0e0;
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
}

.notification-bell {
  position: relative;
  min-width: 44px;
  min-height: 44px;
}

.notification-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  background: var(--ion-color-danger, #eb445a);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
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
</style>
