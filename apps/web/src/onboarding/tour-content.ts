/**
 * Beginner Tour v2 — 5 content beats + `done`.
 *
 * Copy vocabulary rule: use "analysis" / "signal" throughout. Never use
 * "advice" / "recommendation" — regulatory framing for the platform.
 *
 * The emotional arc (welcomed → oriented → astonished → empowered → confident)
 * is captured in each step's `emotionalBeat` for content review.
 */
import type { StepContent, StepId } from './types';

export const tourContent: Record<StepId, StepContent> = {
  welcome: {
    id: 'welcome',
    title: 'Welcome to Divinr',
    body: "Thanks for coming. Divinr is market analysis that shows its work — every call has five analysts behind it, each one's reasoning readable end to end.\n\nThe tour is five short stops. You can skip it any time; none of this is required.",
    routePath: '/',
    completion: { kind: 'got_it' },
    emotionalBeat: 'welcomed',
  },
  'analysts-and-instruments': {
    id: 'analysts-and-instruments',
    title: 'Analysts and instruments',
    body: "Divinr runs a small roster of AI **analysts**. Each one has a name, a published contract (what they analyze and how), and a running performance score. Audit any of them.\n\nThe tickers they cover are called **instruments**. Each instrument page collects everything Divinr thinks about that ticker — current call, history, the analysts that follow it.",
    routePath: '/analysts',
    pulseSelectors: ['[data-tour="analyst-list"]'],
    completion: { kind: 'got_it' },
    emotionalBeat: 'oriented',
  },
  'reading-an-analysis': {
    id: 'reading-an-analysis',
    title: 'Reading an analysis',
    body: "Open any prediction to see how Divinr makes a call.\n\nAt the top: the **arbitrator synthesis** — one combined signal after weighing all five analysts. Below it: each analyst's own call, their confidence, and in their own words, **why**.\n\nTwo analysts will usually disagree. Read both. That's where the learning lives.",
    routePath: '/predictions',
    pulseSelectors: [
      '[data-tour="arbitrator-synthesis"]',
      '[data-tour="analyst-panel"]',
    ],
    completion: { kind: 'got_it' },
    emotionalBeat: 'astonished',
  },
  'making-a-trade': {
    id: 'making-a-trade',
    title: 'Making a trade',
    body: "When you're on a prediction and want to act, use the **Trade** button. You'll pick a tournament (your paper portfolio lives inside one) and size the position.\n\nThese are signals, not instructions. You decide what you do with them — Divinr just makes the reasoning legible.",
    routePath: '/predictions',
    pulseSelectors: ['[data-tour="prediction-trade-cta"]'],
    completion: { kind: 'got_it' },
    emotionalBeat: 'empowered',
  },
  'where-to-go-from-here': {
    id: 'where-to-go-from-here',
    title: 'Where to go from here',
    body: "You're set. A few places worth knowing:\n\n• **Clubs** — friends, shared picks, chat.\n• **Tournaments** — timed competitions against other users and the analysts.\n• **Learning** — curricula and mentoring if you want structured practice.\n• **Settings → Onboarding** — retake this tour or reset the inline walkthroughs any time.\n\nAs you visit each screen for the first time, a short first-touch note will explain what you're looking at. Dismiss them if you'd rather explore on your own.",
    routePath: '/',
    completion: { kind: 'got_it' },
    emotionalBeat: 'confident',
  },
  done: {
    id: 'done',
    title: "You're ready",
    body: "That's the tour. Everything is unlocked.\n\nExplore freely. You can retake the tour from Settings → Onboarding.",
    routePath: '/',
    completion: { kind: 'got_it' },
    emotionalBeat: 'confident',
  },
};
