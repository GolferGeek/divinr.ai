/**
 * Source of truth for onboarding tour content and nav-lock rules.
 *
 * Copy vocabulary rule: use "analysis" / "signal" throughout. Never use
 * "advice" / "recommendation" — regulatory framing for the platform.
 *
 * The emotional arc of the tour (welcomed → astonished → empowered → connected → confident)
 * is captured in each step's `emotionalBeat` for content review.
 */
import type { NavLockMap, StepContent, StepId } from './types';

export const tourContent: Record<StepId, StepContent> = {
  welcome: {
    id: 'welcome',
    title: 'Welcome to Divinr',
    body: 'Divinr is market analysis that shows its work. Most platforms hand you a call — we hand you the reasoning behind it.\n\nTake a 10-minute tour and we will walk you through what each screen is and how to read it.',
    routePath: '/',
    completion: { kind: 'got_it' },
    emotionalBeat: 'welcomed',
  },
  dashboard: {
    id: 'dashboard',
    title: 'Your dashboard',
    body: "This is home base. The top cards are your clubs and active tournaments. Below that, the latest predictions — each one backed by five AI analysts working independently.\n\nClick any **prediction card** to see the full analyst breakdown. That's where the magic lives.",
    routePath: '/',
    pulseSelectors: ['[data-tour="dashboard-prediction-card"]', '[data-tour="dashboard-club-card"]'],
    completion: { kind: 'got_it' },
    emotionalBeat: 'shown-something-cool',
  },
  predictions: {
    id: 'predictions',
    title: 'Open a prediction',
    body: "Go ahead — pick any prediction card on your dashboard and click into it.\n\nThe next screen is the most important thing in Divinr. This is where the platform stops being a collection of cards and starts being a conversation you can read.",
    routePath: '/',
    pulseSelectors: ['[data-tour="dashboard-prediction-card"]'],
    cta: { label: 'Click any prediction card to continue', actionKey: 'opened-instrument-detail' },
    completion: { kind: 'action', actionKey: 'opened-instrument-detail' },
    emotionalBeat: 'shown-something-cool',
  },
  'instrument-detail': {
    id: 'instrument-detail',
    title: 'This is the whole thing',
    body: "Take a minute here. This page is the biggest part of Divinr — everything else is scaffolding around it.\n\n**At the top**: the Arbitrator Synthesis. One combined signal after weighing every analyst.\n\n**Below that**: each of the five analysts, side by side. Every card shows their call, their confidence, and — in their own words — **why** they called it that way.\n\n**Try this before you move on:**\n\n• Scroll down and read at least two rationales in full. They disagree with each other. That is the point.\n\n• On any analyst with a track record, click **View history** to see their past calls.\n\n• Switch to the **AI Scoring** tab up top to see the raw scoring behind the synthesis.\n\nWhen you are done exploring, hit Next.",
    routePath: '/instruments',
    pulseSelectors: [
      '[data-tour="arbitrator-synthesis"]',
      '[data-tour="analyst-panel"]',
      '[data-tour="instrument-tabs"]',
    ],
    completion: { kind: 'got_it' },
    emotionalBeat: 'astonished',
  },
  analysts: {
    id: 'analysts',
    title: 'Meet the analysts',
    body: 'Every analyst has a name, a published contract (what they analyze and how), and a running performance score.\n\nClick into any analyst to audit their history and read their contract. You are looking at their work — not a black box.',
    routePath: '/analysts',
    pulseSelectors: ['[data-tour="analyst-list"]'],
    completion: { kind: 'got_it' },
    emotionalBeat: 'shown-something-cool',
  },
  performance: {
    id: 'performance',
    title: 'How we keep score',
    body: 'Equity curves versus SPY, calibration charts, and the leaderboard.\n\nThis is how you tell which analysts are earning your attention — and which are drifting. Performance is measured continuously; the learning loop adapts their contracts based on results.',
    routePath: '/performance',
    completion: { kind: 'got_it' },
    emotionalBeat: 'shown-something-cool',
  },
  risk: {
    id: 'risk',
    title: 'When the AI argues with itself',
    body: "Click into any risk assessment and you will find a **Blue / Red / Arbiter debate** — one agent argues the bull case, one argues the bear case, and the arbiter synthesizes.\n\nYou can read the entire transcript. It is the clearest demonstration we know of that the AI is not a single voice — it is a structured disagreement you can audit.",
    routePath: '/risk',
    pulseSelectors: ['[data-tour="risk-debate"]'],
    completion: { kind: 'got_it' },
    emotionalBeat: 'astonished',
  },
  portfolios: {
    id: 'portfolios',
    title: 'Analyst portfolios',
    body: 'Every analyst runs a paper portfolio. You see their positions, their trade signals, and what they actually did with each signal.\n\nThese are signals — not instructions. You decide what you do with them.',
    routePath: '/portfolios',
    pulseSelectors: ['[data-tour="portfolio-positions"]'],
    completion: { kind: 'got_it' },
    emotionalBeat: 'empowered',
  },
  clubs: {
    id: 'clubs',
    title: 'Your clubs',
    body: "Clubs are where you and your friends meet inside Divinr. Challenges, polls, messaging, shared analyst picks.\n\nYou're already a member of at least one — check the club card back on your dashboard.",
    routePath: '/clubs',
    pulseSelectors: ['[data-tour="club-list"]'],
    completion: { kind: 'got_it' },
    emotionalBeat: 'connected',
  },
  tournaments: {
    id: 'tournaments',
    title: 'Tournaments',
    body: "Timed competitions. Your club picks an instrument set, a window, and a rulebook — then everyone (you and the AI analysts) trades the same universe.\n\nThe leaderboard updates in real time. This is where the platform turns into a spectator sport.",
    routePath: '/tournaments',
    pulseSelectors: ['[data-tour="tournament-leaderboard"]'],
    completion: { kind: 'got_it' },
    emotionalBeat: 'connected',
  },
  messages: {
    id: 'messages',
    title: 'Club chat',
    body: 'Your club conversations and DMs. React, thread, and share analyst signals inline.\n\nWhen your friends want to know what you are seeing — send them a signal, not a screenshot.',
    routePath: '/messages',
    completion: { kind: 'got_it' },
    emotionalBeat: 'connected',
  },
  done: {
    id: 'done',
    title: "You're ready",
    body: "The whole platform is now unlocked — including Affinity and everything else that was locked during the tour.\n\nExplore freely. You can retake this tour any time from your profile menu.",
    routePath: '/',
    completion: { kind: 'got_it' },
    emotionalBeat: 'confident',
  },
};

/**
 * NavLockMap — keyed by the nav item's `to` path. Sub-routes (e.g., /clubs/123)
 * resolve to their root via matchNavRoot() used in both the store and router guard.
 */
export const navLocks: NavLockMap = {
  '/': 'always',
  '/notifications': 'always',
  '/instruments': 'predictions',
  '/portfolios': 'risk',
  '/risk': 'instrument-detail',
  '/analysts': 'instrument-detail',
  '/performance': 'analysts',
  '/coordination': 'performance',
  '/affinity': 'done',
  '/clubs': 'portfolios',
  '/tournaments': 'clubs',
  '/messages': 'tournaments',
  // Admin System routes — always unlocked, admin-gated elsewhere.
  '/runs': 'admin-only',
  '/sources': 'admin-only',
  '/evaluations': 'admin-only',
  '/learning': 'admin-only',
  '/proposals': 'admin-only',
};

/**
 * Normalize a path to its nav root. E.g., /instruments/AAPL → /instruments.
 * Returns the original path if no root match (falls through to unlocked by default).
 */
export function matchNavRoot(path: string): string {
  const clean = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (clean === '/') return '/';
  const roots = Object.keys(navLocks).filter((p) => p !== '/');
  let best = clean;
  let bestLen = 0;
  for (const root of roots) {
    if (clean === root || clean.startsWith(root + '/')) {
      if (root.length > bestLen) {
        best = root;
        bestLen = root.length;
      }
    }
  }
  return bestLen > 0 ? best : clean;
}
