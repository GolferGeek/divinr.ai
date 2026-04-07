import { createRouter, createWebHistory } from '@ionic/vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('../layouts/DefaultLayout.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
        { path: 'domain/:domain', name: 'domain-dashboard', component: () => import('../views/DomainDashboardView.vue') },
        { path: 'instruments', name: 'instruments', component: () => import('../views/InstrumentsView.vue') },
        { path: 'instruments/:id', name: 'instrument-detail', component: () => import('../views/InstrumentDetailView.vue') },
        { path: 'analysts', name: 'analysts', component: () => import('../views/AnalystsView.vue') },
        { path: 'analysts/:id/performance', name: 'analyst-performance', component: () => import('../views/AnalystPerformanceView.vue') },
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
      ],
    },
  ],
});

// Auth guard: redirect to login if no tenant configured
router.beforeEach((to) => {
  if (to.meta.public) return true;
  const orgSlug = localStorage.getItem('divinr_org');
  const userId = localStorage.getItem('divinr_user');
  if (!orgSlug || !userId) return '/login';
  return true;
});
