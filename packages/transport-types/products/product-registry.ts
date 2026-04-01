/**
 * Product Registry — Single source of truth for all product metadata.
 *
 * Every UI component that displays a product name, tagline, or description
 * should read from this registry instead of hardcoding strings.
 *
 * The `slug` is the permanent code identifier (used in routing, entitlements,
 * directory names). The `displayName` is the user-facing label that can be
 * changed by switching presets.
 *
 * Two naming presets ship out of the box:
 *   - 'marketing' — the polished product names (Forge, Compose, Pulse, Bridge)
 *   - 'internal'  — plain-English names (Big Ideas, Table Stakes Agents, etc.)
 *
 * Call `setActivePreset('internal')` at app startup to switch.
 */

export type ProductSlug =
  | 'command'
  | 'forge'
  | 'compose'
  | 'pulse'
  | 'bridge'
  | 'admin'
  | 'protocol-lab';

/** Display-layer fields that a naming preset can override */
export interface ProductDisplayOverride {
  displayName: string;
  tagline: string;
}

export type ProductCategory = 'agents' | 'ambient' | 'admin';

export const PRODUCT_CATEGORIES: { key: ProductCategory; label: string }[] = [
  { key: 'agents', label: 'Agents & Workflows' },
  { key: 'ambient', label: 'Ambient' },
  { key: 'admin', label: 'Administration' },
];

export interface ProductDefinition {
  /** Permanent code identifier — never changes */
  slug: ProductSlug;
  /** User-facing display name */
  displayName: string;
  /** Short tagline for cards and tooltips */
  tagline: string;
  /** Longer marketing description */
  description: string;
  /** Feature bullet points for landing pages */
  features: string[];
  /** Emoji icon for marketing/landing pages */
  emoji: string;
  /** Ionicons icon name (e.g. 'hammer-outline') for nav/sidebar */
  ionicon: string;
  /** Dev port for the web app */
  webPort: number;
  /** Dev port for the API (if applicable) */
  apiPort?: number;
  /** Navigation category for grouping in sidebars */
  category?: ProductCategory;
}

// ─── Naming Presets ─────────────────────────────────────────────────────────

export type PresetName = 'marketing' | 'internal';

/** Marketing preset — polished product names for clients and demos */
const MARKETING_NAMES: Record<ProductSlug, ProductDisplayOverride> = {
  command:        { displayName: 'OrchestratorAI',  tagline: 'Navigation Shell' },
  forge:          { displayName: 'Forge',           tagline: 'Complex Agent Workflows' },
  compose:        { displayName: 'Compose',         tagline: 'Composable Agent Foundation' },
  pulse:          { displayName: 'Pulse',           tagline: 'Ambient Automation' },
  bridge:         { displayName: 'Bridge',          tagline: 'External A2A Communication' },
  admin:          { displayName: 'Admin',           tagline: 'Full Platform Administration' },
  'protocol-lab': { displayName: 'Protocol Lab',    tagline: '12-Layer Agent Communication Playground' },
};

/** Internal preset — plain-English names that say what each product does */
const INTERNAL_NAMES: Record<ProductSlug, ProductDisplayOverride> = {
  command:        { displayName: 'OrchestratorAI',      tagline: 'Navigation Shell' },
  forge:          { displayName: 'Big Ideas',            tagline: 'Complex Agent Workflows' },
  compose:        { displayName: 'Table Stakes Agents',  tagline: 'Composable Agent Foundation' },
  pulse:          { displayName: 'Internal Workflows',    tagline: 'Ambient Automation' },
  bridge:         { displayName: 'Guardhouse',            tagline: 'External A2A Gateway' },
  admin:          { displayName: 'Admin',                 tagline: 'Full Platform Administration' },
  'protocol-lab': { displayName: 'Protocol Lab',          tagline: '12-Layer Protocol Playground' },
};

const PRESETS: Record<PresetName, Record<ProductSlug, ProductDisplayOverride>> = {
  marketing: MARKETING_NAMES,
  internal: INTERNAL_NAMES,
};

// ─── Base Product Data (infrastructure, ports, descriptions) ────────────────

interface BaseProductData {
  slug: ProductSlug;
  description: string;
  features: string[];
  emoji: string;
  ionicon: string;
  webPort: number;
  apiPort?: number;
  category?: ProductCategory;
}

const BASE_PRODUCTS: Record<ProductSlug, BaseProductData> = {
  command: {
    slug: 'command',
    description: 'The entry point to the OrchestratorAI Enterprise platform. Routes users to products based on their entitlements.',
    features: [],
    emoji: '🏠',
    ionicon: 'grid-outline',
    webPort: 6102,
  },
  forge: {
    slug: 'forge',
    description:
      'The foundation for your most demanding AI use cases. Working LangGraph workflows ship with the platform — your team extends them for marketing orchestration, legal automation, risk analysis, or any domain-specific pipeline you need.',
    features: [
      'LangGraph multi-agent orchestration',
      'Real-time workflow visualization',
      'Working starter workflows included',
      'Built to extend for your domain',
    ],
    emoji: '⚡',
    ionicon: 'hammer-outline',
    webPort: 6201,
    apiPort: 6200,
    category: 'agents',
  },
  compose: {
    slug: 'compose',
    description:
      'A complete agent composition framework with working examples. Conversation agents, RAG retrieval, API integrations, and media generation — all wired up and ready to be customized for your data and your use cases.',
    features: [
      'Conversational AI agents',
      'RAG retrieval integration',
      'API & external connectors',
      'Your starting point, not your ceiling',
    ],
    emoji: '🧩',
    ionicon: 'layers-outline',
    webPort: 6301,
    apiPort: 6300,
    category: 'agents',
  },
  pulse: {
    slug: 'pulse',
    description:
      'The infrastructure for ambient AI that watches your systems and acts. Database watchers, file triggers, and event-driven workflows are all wired up — your agents fill in the business logic specific to your operations.',
    features: [
      'Database change watchers',
      'File system triggers',
      'Event-driven workflows',
      'Your business rules, our infrastructure',
    ],
    emoji: '💓',
    ionicon: 'pulse-outline',
    webPort: 6501,
    apiPort: 6500,
    category: 'ambient',
  },
  bridge: {
    slug: 'bridge',
    description:
      'Production-grade agent-to-agent communication infrastructure. The security, authentication, rate limiting, and audit trail are already built — you add the agent endpoints relevant to your partner integrations.',
    features: [
      'A2A protocol (JSON-RPC 2.0)',
      'Inbound agent endpoints',
      'Outbound agent calls',
      'Production security & audit',
    ],
    emoji: '🌉',
    ionicon: 'navigate-outline',
    webPort: 6601,
    apiPort: 6600,
    category: 'ambient',
  },
  admin: {
    slug: 'admin',
    description:
      'Complete observability and control from day one. LLM analytics, RAG management, agent registry, and organization management ship fully functional — giving you visibility over every AI call on the platform.',
    features: [
      'LLM usage analytics',
      'RAG pipeline management',
      'Agent registry & entitlements',
      'Organization & user management',
    ],
    emoji: '🛡️',
    ionicon: 'shield-checkmark-outline',
    webPort: 6101,
    category: 'admin',
  },
  'protocol-lab': {
    slug: 'protocol-lab',
    description:
      'A working 12-layer agent communication playground with 31+ pluggable providers, 4 industry-standard protocol suites (A2A, AGNTCY ACP, Commerce ACP, Coinbase x402), real payment rails, and 11 fishbowl scenarios across Farm Credit and Manufacturing.',
    features: [
      '12-layer pluggable protocol stack',
      '31+ real protocol providers',
      'Real payment rails (Lightning, x402 USDC, Stripe)',
      '11 fishbowl scenarios across 2 industries',
    ],
    emoji: '🔬',
    ionicon: 'flask-outline',
    webPort: 6400,
    apiPort: 6402,
    category: 'ambient',
  },
};

// ─── Active Registry (built from base + active preset) ──────────────────────

let activePreset: PresetName = 'marketing';

function buildRegistry(preset: PresetName): Record<ProductSlug, ProductDefinition> {
  const names = PRESETS[preset];
  const result = {} as Record<ProductSlug, ProductDefinition>;
  for (const slug of Object.keys(BASE_PRODUCTS) as ProductSlug[]) {
    result[slug] = {
      ...BASE_PRODUCTS[slug],
      ...names[slug],
    };
  }
  return result;
}

/** The active product registry. Rebuilt when the preset changes. */
export let PRODUCT_REGISTRY: Record<ProductSlug, ProductDefinition> = buildRegistry(activePreset);

/**
 * Switch the active naming preset. Call this at app startup (e.g. in main.ts)
 * before any component renders.
 *
 * @example
 *   import { setActivePreset } from '@orchestrator-ai/transport-types';
 *   setActivePreset('marketing'); // use polished names for client demos
 */
export function setActivePreset(preset: PresetName): void {
  activePreset = preset;
  PRODUCT_REGISTRY = buildRegistry(preset);
}

/** Get the currently active preset name */
export function getActivePreset(): PresetName {
  return activePreset;
}

/** All product slugs (excludes 'command' which is the shell, not a product) */
export const PRODUCT_SLUGS: ProductSlug[] = ['forge', 'compose', 'pulse', 'bridge', 'admin', 'protocol-lab'];

/** Get a product definition by slug. Returns undefined for unknown slugs. */
export function getProduct(slug: string): ProductDefinition | undefined {
  return PRODUCT_REGISTRY[slug as ProductSlug];
}

/** Get the display name for a product slug. Returns the slug itself if not found. */
export function getProductDisplayName(slug: string): string {
  return PRODUCT_REGISTRY[slug as ProductSlug]?.displayName ?? slug;
}

/** Get all product definitions (excluding command shell) */
export function getAllProducts(): ProductDefinition[] {
  return PRODUCT_SLUGS.map(slug => PRODUCT_REGISTRY[slug]);
}

/** Get products grouped by category, in display order */
export function getProductsByCategory(): { key: ProductCategory; label: string; products: ProductDefinition[] }[] {
  const all = getAllProducts();
  return PRODUCT_CATEGORIES
    .map(cat => ({
      ...cat,
      products: all.filter(p => p.category === cat.key),
    }))
    .filter(cat => cat.products.length > 0);
}
