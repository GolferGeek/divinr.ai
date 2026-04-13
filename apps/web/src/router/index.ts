import { createRouter, createWebHistory } from '@ionic/vue-router';
import { useAuthStore } from '../stores/auth.store';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/welcome',
      name: 'landing',
      component: () => import('../views/LandingView.vue'),
      meta: { public: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/signup/:token',
      name: 'invite-signup',
      component: () => import('../views/InviteSignupView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('../layouts/DefaultLayout.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
        { path: 'performance', name: 'performance', component: () => import('../views/PerformanceDashboardView.vue') },
        { path: 'domain/:domain', name: 'domain-dashboard', component: () => import('../views/DomainDashboardView.vue') },
        { path: 'instruments', name: 'instruments', component: () => import('../views/InstrumentsView.vue') },
        { path: 'instruments/:id', name: 'instrument-detail', component: () => import('../views/InstrumentDetailView.vue') },
        { path: 'analysts', name: 'analysts', component: () => import('../views/AnalystsView.vue') },
        { path: 'analysts/:id/performance', name: 'analyst-performance', component: () => import('../views/AnalystPerformanceView.vue') },
        { path: 'analysts/:id/contract', name: 'analyst-contract', component: () => import('../views/ContractEditorView.vue') },
        { path: 'runs', name: 'runs', component: () => import('../views/RunsView.vue') },
        { path: 'runs/:id', name: 'run-detail', component: () => import('../views/RunDetailView.vue') },
        { path: 'risk', name: 'risk', component: () => import('../views/RiskDashboardView.vue') },
        { path: 'sources', name: 'sources', component: () => import('../views/SourcesView.vue') },
        { path: 'portfolios', name: 'portfolios', component: () => import('../views/PortfolioDashboardView.vue') },
        { path: 'portfolio', redirect: '/portfolios' },
        { path: 'evaluations', name: 'evaluations', component: () => import('../views/EvaluationsView.vue') },
        { path: 'learning', name: 'learning', component: () => import('../views/LearningDashboardView.vue') },
        { path: 'predictions', name: 'predictions', component: () => import('../views/PredictionsView.vue') },
        { path: 'terms', name: 'terms', component: () => import('../views/TermsOfServiceView.vue') },
        { path: 'learning/canonical/:id', name: 'canonical-day', component: () => import('../views/CanonicalDayDetailView.vue') },
        { path: 'findings', name: 'findings', component: () => import('../views/AuditFindingsView.vue') },
        { path: 'affinity', name: 'affinity', component: () => import('../views/AffinityView.vue') },
        { path: 'proposals', name: 'proposals', component: () => import('../views/ProposalsView.vue') },
        { path: 'notifications', name: 'notifications', component: () => import('../views/NotificationsView.vue') },
        { path: 'fear-greed-alerts', name: 'fearGreedAlerts', component: () => import('../views/FearGreedAlertsView.vue') },
        { path: 'coordination', name: 'coordination', component: () => import('../views/CoordinationView.vue') },
        { path: 'messages', name: 'messages', component: () => import('../views/MessagesView.vue') },
        { path: 'messages/:channelId', name: 'messages-channel', component: () => import('../views/MessagesView.vue') },
        { path: 'clubs', name: 'clubs', component: () => import('../views/ClubsView.vue') },
        { path: 'clubs/create', name: 'club-create', component: () => import('../views/ClubCreateView.vue') },
        { path: 'clubs/rankings', name: 'club-rankings', component: () => import('../views/ClubRankingsView.vue') },
        { path: 'clubs/compare', name: 'club-compare', component: () => import('../views/ClubCompareView.vue') },
        { path: 'clubs/invite/:token', name: 'club-invite', component: () => import('../views/ClubInviteView.vue') },
        { path: 'clubs/:id', name: 'club-detail', component: () => import('../views/ClubDetailView.vue') },
        { path: 'clubs/:clubId/curricula/create', name: 'curriculum-create', component: () => import('../views/CurriculumCreateView.vue') },
        { path: 'clubs/:clubId/curricula/:id', name: 'curriculum-detail', component: () => import('../views/CurriculumDetailView.vue') },
        { path: 'clubs/:clubId/curricula/:id/dashboard', name: 'curriculum-dashboard', component: () => import('../views/CurriculumDashboardView.vue') },
        { path: 'clubs/:clubId/mentoring/dashboard', name: 'mentor-dashboard', component: () => import('../views/MentorDashboardView.vue') },
        { path: 'tournaments', name: 'tournaments', component: () => import('../views/TournamentsView.vue') },
        { path: 'tournaments/create', name: 'tournament-create', component: () => import('../views/TournamentCreateView.vue') },
        { path: 'tournaments/history', name: 'tournament-history', component: () => import('../views/TournamentHistoryView.vue') },
        { path: 'tournaments/invite/:token', name: 'tournament-invite', component: () => import('../views/TournamentInviteView.vue') },
        { path: 'tournaments/:id', name: 'tournament-detail', component: () => import('../views/TournamentDetailView.vue') },
        { path: 'tournaments/:id/results', name: 'tournament-results', component: () => import('../views/TournamentResultsView.vue') },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      redirect: '/',
    },
  ],
});

// Auth guard: redirect to login if no user configured.
// Uses the auth Pinia store so the localStorage key name is encapsulated in one place.
router.beforeEach((to) => {
  if (to.meta.public) return true;
  const auth = useAuthStore();
  if (!auth.isConfigured()) return '/welcome';
  return true;
});
