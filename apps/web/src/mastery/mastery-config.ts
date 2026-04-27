import {
  analyticsOutline,
  briefcaseOutline,
  bulbOutline,
  cashOutline,
  chatbubblesOutline,
  compassOutline,
  constructOutline,
  createOutline,
  gitNetworkOutline,
  gridOutline,
  heartOutline,
  newspaperOutline,
  peopleCircleOutline,
  peopleOutline,
  playOutline,
  ribbonOutline,
  schoolOutline,
  shieldOutline,
  statsChartOutline,
  trendingUpOutline,
  trophyOutline,
} from 'ionicons/icons';

export type MasteryLevel =
  | 'core_trading'
  | 'competitive_participation'
  | 'community_creation'
  | 'builder'
  | 'operator';

export interface MasteryNavItem {
  title: string;
  icon: string;
  to: string;
  minLevel: MasteryLevel;
  adminOnly?: boolean;
  alwaysVisible?: boolean;
}

export interface MasteryNavGroup {
  label: string;
  adminOnly?: boolean;
  items: MasteryNavItem[];
}

export interface MasteryRoutePolicy {
  path: string;
  minLevel: MasteryLevel;
  adminOnly?: boolean;
  alwaysVisible?: boolean;
  notes?: string;
}

export interface MasteryRouteFallback {
  path: string;
  query?: Record<string, string>;
}

export const MASTERY_LEVEL_ORDER: MasteryLevel[] = [
  'core_trading',
  'competitive_participation',
  'community_creation',
  'builder',
  'operator',
];

export const masteryNavGroups: MasteryNavGroup[] = [
  {
    label: '',
    items: [
      { title: 'Dashboard', icon: gridOutline, to: '/', minLevel: 'core_trading' },
      { title: 'Learning Panel', icon: bulbOutline, to: '/chat', minLevel: 'core_trading' },
      { title: 'Trade', icon: cashOutline, to: '/tournaments', minLevel: 'core_trading' },
    ],
  },
  {
    label: 'Markets',
    items: [
      { title: 'Analyses', icon: statsChartOutline, to: '/predictions', minLevel: 'core_trading' },
      { title: 'Portfolios', icon: briefcaseOutline, to: '/portfolios', minLevel: 'core_trading' },
      { title: 'Risk', icon: shieldOutline, to: '/risk', minLevel: 'core_trading' },
    ],
  },
  {
    label: 'AI Analysts',
    items: [
      { title: 'Research', icon: compassOutline, to: '/instruments', minLevel: 'builder' },
      { title: 'Analysts', icon: peopleOutline, to: '/analysts', minLevel: 'builder' },
      { title: 'Performance', icon: trendingUpOutline, to: '/performance', minLevel: 'core_trading' },
      { title: 'Coordination', icon: gitNetworkOutline, to: '/coordination', minLevel: 'operator' },
      { title: 'Affinity', icon: heartOutline, to: '/affinity', minLevel: 'operator' },
    ],
  },
  {
    label: 'Community',
    items: [
      { title: 'Clubs', icon: peopleCircleOutline, to: '/clubs', minLevel: 'competitive_participation' },
      { title: 'Tournaments', icon: trophyOutline, to: '/tournaments', minLevel: 'competitive_participation' },
      { title: 'Messages', icon: chatbubblesOutline, to: '/messages', minLevel: 'community_creation' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { title: 'Your Content', icon: createOutline, to: '/settings/authored-content', minLevel: 'builder' },
      { title: 'Onboarding', icon: schoolOutline, to: '/settings/onboarding', minLevel: 'core_trading', alwaysVisible: true },
      { title: 'Visibility & Social', icon: shieldOutline, to: '/settings/social-opt-outs', minLevel: 'competitive_participation', alwaysVisible: true },
      { title: 'My Attribution', icon: trendingUpOutline, to: '/attribution/mine', minLevel: 'operator', adminOnly: true },
      { title: 'Billing Summary', icon: analyticsOutline, to: '/billing/summary', minLevel: 'core_trading', alwaysVisible: true },
    ],
  },
  {
    label: 'System',
    adminOnly: true,
    items: [
      { title: 'Runs', icon: playOutline, to: '/runs', minLevel: 'operator', adminOnly: true },
      { title: 'Sources', icon: newspaperOutline, to: '/sources', minLevel: 'operator', adminOnly: true },
      { title: 'Evaluations', icon: ribbonOutline, to: '/evaluations', minLevel: 'operator', adminOnly: true },
      { title: 'Learning', icon: bulbOutline, to: '/learning', minLevel: 'operator', adminOnly: true },
      { title: 'Proposals', icon: constructOutline, to: '/proposals', minLevel: 'operator', adminOnly: true },
      { title: 'LLM Usage', icon: analyticsOutline, to: '/usage', minLevel: 'operator', adminOnly: true },
    ],
  },
  {
    label: 'Cost Modeling',
    adminOnly: true,
    items: [
      { title: 'Calibration', icon: analyticsOutline, to: '/admin/cost/calibration', minLevel: 'operator', adminOnly: true },
      { title: 'Defensibility', icon: analyticsOutline, to: '/admin/cost/defensibility', minLevel: 'operator', adminOnly: true },
      { title: 'Experiments', icon: analyticsOutline, to: '/admin/cost/experiments', minLevel: 'operator', adminOnly: true },
    ],
  },
  {
    label: 'Attribution',
    adminOnly: true,
    items: [
      { title: 'Overview', icon: trendingUpOutline, to: '/admin/attribution', minLevel: 'operator', adminOnly: true },
      { title: 'Sources', icon: newspaperOutline, to: '/admin/attribution/sources', minLevel: 'operator', adminOnly: true },
      { title: 'Graduation Candidates', icon: ribbonOutline, to: '/admin/attribution/graduation-candidates', minLevel: 'operator', adminOnly: true },
    ],
  },
];

export const masteryRoutePolicies: MasteryRoutePolicy[] = [
  { path: '/', minLevel: 'core_trading' },
  { path: '/chat', minLevel: 'core_trading' },
  { path: '/predictions', minLevel: 'core_trading' },
  { path: '/risk', minLevel: 'core_trading' },
  { path: '/portfolios', minLevel: 'core_trading' },
  { path: '/domain', minLevel: 'core_trading' },
  { path: '/notifications', minLevel: 'core_trading' },
  { path: '/fear-greed-alerts', minLevel: 'core_trading' },
  { path: '/terms', minLevel: 'core_trading', alwaysVisible: true },
  { path: '/tournaments', minLevel: 'core_trading', notes: 'Level 1 enters trading through the tournament shell.' },
  { path: '/tournaments/history', minLevel: 'competitive_participation' },
  { path: '/tournaments/invite', minLevel: 'competitive_participation' },
  { path: '/tournaments/create', minLevel: 'community_creation' },
  { path: '/tournaments/results', minLevel: 'competitive_participation' },
  { path: '/clubs', minLevel: 'competitive_participation' },
  { path: '/clubs/rankings', minLevel: 'competitive_participation' },
  { path: '/clubs/compare', minLevel: 'competitive_participation' },
  { path: '/clubs/invite', minLevel: 'competitive_participation' },
  { path: '/clubs/create', minLevel: 'community_creation' },
  { path: '/clubs/:detail', minLevel: 'competitive_participation' },
  { path: '/clubs/:clubId/curricula', minLevel: 'community_creation' },
  { path: '/clubs/:clubId/mentoring', minLevel: 'community_creation' },
  { path: '/messages', minLevel: 'community_creation' },
  { path: '/settings/authored-content', minLevel: 'builder' },
  { path: '/analysts', minLevel: 'builder' },
  { path: '/analysts/:detail', minLevel: 'builder' },
  { path: '/instruments', minLevel: 'builder' },
  { path: '/instruments/:detail', minLevel: 'builder' },
  { path: '/performance', minLevel: 'core_trading' },
  { path: '/settings/onboarding', minLevel: 'core_trading', alwaysVisible: true },
  { path: '/billing/summary', minLevel: 'core_trading', alwaysVisible: true },
  { path: '/settings/social-opt-outs', minLevel: 'competitive_participation', alwaysVisible: true },
  { path: '/attribution/mine', minLevel: 'operator', adminOnly: true },
  { path: '/usage', minLevel: 'operator', adminOnly: true },
  { path: '/admin/cost/calibration', minLevel: 'operator', adminOnly: true },
  { path: '/admin/cost/defensibility', minLevel: 'operator', adminOnly: true },
  { path: '/admin/cost/experiments', minLevel: 'operator', adminOnly: true },
  { path: '/admin/attribution', minLevel: 'operator', adminOnly: true },
  { path: '/admin/users', minLevel: 'operator', adminOnly: true },
  { path: '/admin/billing', minLevel: 'operator', adminOnly: true },
  { path: '/runs', minLevel: 'operator', adminOnly: true },
  { path: '/sources', minLevel: 'operator', adminOnly: true },
  { path: '/evaluations', minLevel: 'operator', adminOnly: true },
  { path: '/learning', minLevel: 'operator', adminOnly: true },
  { path: '/learning/canonical', minLevel: 'operator', adminOnly: true },
  { path: '/findings', minLevel: 'operator', adminOnly: true },
  { path: '/proposals', minLevel: 'operator', adminOnly: true },
  { path: '/coordination', minLevel: 'operator', adminOnly: true },
  { path: '/affinity', minLevel: 'operator', adminOnly: true },
];

export function masteryLevelRank(level: MasteryLevel): number {
  return MASTERY_LEVEL_ORDER.indexOf(level);
}

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function matchesPolicy(path: string, policyPath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPolicy = normalizePath(policyPath);
  if (normalizedPolicy.includes('/:')) {
    const prefix = normalizedPolicy.split('/:')[0] ?? normalizedPolicy;
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  return normalizedPath === normalizedPolicy || normalizedPath.startsWith(`${normalizedPolicy}/`);
}

export function findMasteryRoutePolicy(path: string): MasteryRoutePolicy | null {
  const normalizedPath = normalizePath(path);
  const matches = masteryRoutePolicies.filter((policy) => matchesPolicy(normalizedPath, policy.path));
  if (matches.length === 0) return null;
  matches.sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length);
  return matches[0] ?? null;
}

export function inferLearningPanelSurfaceKey(path: string): string {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === '/' || normalizedPath.startsWith('/domain/')) return 'dashboard';
  if (normalizedPath.startsWith('/predictions')) return 'predictions';
  if (normalizedPath.startsWith('/risk')) return 'risk-dashboard';
  if (normalizedPath.startsWith('/portfolios') || normalizedPath === '/portfolio') return 'portfolios';
  if (normalizedPath.startsWith('/clubs/')) return 'club.detail';
  if (normalizedPath.startsWith('/clubs')) return 'clubs';
  if (normalizedPath.startsWith('/tournaments')) return 'tournaments';
  if (normalizedPath.startsWith('/messages')) return 'messages';
  if (normalizedPath.startsWith('/analysts')) return 'analysts';
  if (normalizedPath.startsWith('/performance')) return 'performance';
  if (normalizedPath.startsWith('/instruments')) return 'instruments';
  if (normalizedPath.startsWith('/settings/authored-content')) return 'authored.overview';
  return 'chat';
}

export function buildMasteryFallback(
  blockedPath: string,
  requiredLevel: MasteryLevel,
): MasteryRouteFallback {
  return {
    path: '/chat',
    query: {
      surfaceKey: inferLearningPanelSurfaceKey(blockedPath),
      hiddenPath: blockedPath,
      requiredLevel,
      reason: 'mastery-hidden',
    },
  };
}
