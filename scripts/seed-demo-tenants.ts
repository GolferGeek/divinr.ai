/**
 * Seed script for 3 demo tenants with differentiated analyst packs.
 *
 * Usage: npx tsx scripts/seed-demo-tenants.ts
 *
 * Idempotent — uses INSERT ... ON CONFLICT DO NOTHING or DO UPDATE.
 * Requires: DATABASE_URL or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
 */
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

async function sql(query: string, params: unknown[] = []) {
  const { data, error } = await db.rpc('', {} as never).then(() => {
    // Use raw SQL via the REST API isn't directly supported, so we use the
    // service role client's ability to query schemas directly
    return { data: null, error: null };
  });
  // Fall back to direct fetch for raw SQL
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey!,
      'Authorization': `Bearer ${supabaseKey}`,
    },
  });
  // For seed scripts, we'll use the pg connection directly
  return { data, error };
}

// Since Supabase JS client doesn't support raw SQL easily,
// we'll use the Supabase client's from() method for each table.

// ── Helpers ──────────────────────────────────────────────────────

async function upsertOrg(slug: string, name: string) {
  const { error } = await db
    .schema('authz')
    .from('organizations')
    .upsert({ slug, name }, { onConflict: 'slug' });
  if (error) console.warn(`  org ${slug}: ${error.message}`);
  else console.log(`  org: ${slug}`);
}

async function upsertUser(id: string, email: string, displayName: string, orgSlug: string) {
  const { error } = await db
    .schema('authz')
    .from('users')
    .upsert(
      { id, email, display_name: displayName, organization_slug: orgSlug, status: 'active' },
      { onConflict: 'id' },
    );
  if (error) console.warn(`  user ${email}: ${error.message}`);
  else console.log(`  user: ${email} (${orgSlug})`);
}

async function upsertPermission(name: string, displayName: string, category: string) {
  const id = `perm_${name.replace(/\./g, '_')}`;
  const { error } = await db
    .schema('authz')
    .from('rbac_permissions')
    .upsert(
      { id, name, display_name: displayName, description: `${displayName} permission`, category },
      { onConflict: 'name' },
    );
  if (error) console.warn(`  permission ${name}: ${error.message}`);
  return id;
}

async function upsertRole(name: string, displayName: string) {
  const id = `role_${name}`;
  const { error } = await db
    .schema('authz')
    .from('rbac_roles')
    .upsert(
      { id, name, display_name: displayName, description: `${displayName} role`, is_system: true },
      { onConflict: 'name' },
    );
  if (error) console.warn(`  role ${name}: ${error.message}`);
  return id;
}

async function linkRolePermission(roleId: string, permissionId: string) {
  const { error } = await db
    .schema('authz')
    .from('rbac_role_permissions')
    .upsert({ role_id: roleId, permission_id: permissionId }, { onConflict: 'role_id,permission_id' });
  if (error && !error.message.includes('duplicate')) {
    console.warn(`  role-perm link: ${error.message}`);
  }
}

async function assignUserRole(userId: string, orgSlug: string, roleId: string) {
  const { error } = await db
    .schema('authz')
    .from('rbac_user_org_roles')
    .upsert(
      { user_id: userId, organization_slug: orgSlug, role_id: roleId, assigned_by: 'seed-script' },
      { onConflict: 'user_id,organization_slug,role_id' },
    );
  if (error && !error.message.includes('duplicate')) {
    console.warn(`  user-role: ${error.message}`);
  }
}

async function upsertInstrument(orgSlug: string, symbol: string, name: string) {
  const id = `${orgSlug}_${symbol.toLowerCase()}`;
  const { error } = await db
    .schema('prediction')
    .from('instruments')
    .upsert(
      { id, organization_slug: orgSlug, symbol, name, asset_type: 'stock', universe_slug: 'stocks', is_active: true },
      { onConflict: 'id' },
    );
  if (error) console.warn(`  instrument ${symbol} (${orgSlug}): ${error.message}`);
  return id;
}

async function upsertAnalyst(
  orgSlug: string,
  slug: string,
  displayName: string,
  personaPrompt: string,
  opts: { weight?: number; isSystemDefault?: boolean; isEnabled?: boolean; workflowScope?: string; tierInstructions?: Record<string, string> },
) {
  const id = `${orgSlug}_${slug}`;
  const { error } = await db
    .schema('prediction')
    .from('market_analysts')
    .upsert(
      {
        id,
        organization_slug: orgSlug,
        slug,
        display_name: displayName,
        name: displayName,
        persona_prompt: personaPrompt,
        analyst_type: 'personality',
        default_weight: opts.weight ?? 1.0,
        tier_instructions: opts.tierInstructions ?? {},
        is_system_default: opts.isSystemDefault ?? false,
        is_enabled: opts.isEnabled ?? true,
        is_active: true,
        workflow_scope: opts.workflowScope ?? 'both',
        domain_slug: 'financial',
        created_by: 'seed-script',
      },
      { onConflict: 'id' },
    );
  if (error) console.warn(`  analyst ${slug} (${orgSlug}): ${error.message}`);
  return id;
}

async function assignAnalyst(orgSlug: string, instrumentId: string, analystId: string) {
  const { error } = await db
    .schema('prediction')
    .from('market_instrument_analyst_assignments')
    .upsert(
      { organization_slug: orgSlug, instrument_id: instrumentId, analyst_id: analystId, assigned_by: 'seed-script' },
      { onConflict: 'organization_slug,instrument_id,analyst_id' },
    );
  if (error && !error.message.includes('duplicate')) {
    console.warn(`  assignment: ${error.message}`);
  }
}

// ── Default Analyst Definitions ──────────────────────────────────

const DEFAULT_ANALYSTS = [
  {
    slug: 'fundamentals-analyst',
    name: 'Fundamentals Analyst',
    prompt: 'You are a Fundamentals Analyst, a data-driven specialist in financial statement analysis and valuation. Focus on: earnings quality, revenue trends, margins, balance sheet strength, valuation metrics, competitive position. Always ground your analysis in financial data.',
    weight: 1.0,
    tier: {
      gold: 'Provide comprehensive analysis of earnings, revenue, margins, debt levels, P/E ratios, competitive moat, and management quality. Multi-step reasoning with full evidence.',
      silver: 'Analyze key metrics: earnings trajectory, revenue growth, margin trends, and valuation relative to peers.',
      bronze: 'Quick check on earnings momentum, current valuation, and any red flags.',
    },
  },
  {
    slug: 'technical-analyst',
    name: 'Technical Analyst',
    prompt: 'You are a Technical Analyst, a chart patterns and price action specialist. Focus on: chart patterns, support/resistance levels, volume analysis, momentum indicators, trend identification. Let the price action tell the story.',
    weight: 1.0,
    tier: {
      gold: 'Comprehensive technical analysis covering trends, support/resistance zones, volume profile, RSI, MACD, moving averages, and chart patterns with timeframe alignment.',
      silver: 'Key technicals: trend direction, major support/resistance, momentum state, and volume confirmation.',
      bronze: 'Quick read: primary trend, momentum state, and nearest key level.',
    },
  },
  {
    slug: 'sentiment-analyst',
    name: 'Sentiment Analyst',
    prompt: 'You are a Sentiment Analyst, a market sentiment and psychology specialist. Focus on: news tone, social media buzz, analyst ratings changes, insider activity, institutional flows. Read the crowd, but think independently.',
    weight: 1.0,
    tier: {
      gold: 'Comprehensive sentiment analysis covering news tone, social media sentiment, analyst consensus shifts, insider patterns, institutional flows, and options positioning.',
      silver: 'Key sentiment indicators: overall news tone, analyst consensus direction, and insider/institutional activity.',
      bronze: 'Quick read: overall market mood, analyst sentiment, and crowd positioning.',
    },
  },
  {
    slug: 'momentum-analyst',
    name: 'Momentum Analyst',
    prompt: 'You are a Momentum Analyst, focused on trend acceleration and high-conviction breakout plays. Focus on: breakouts, trend acceleration, volume surges, relative strength, earnings momentum. You look for asymmetric opportunities with strong catalysts.',
    weight: 1.1,
    tier: {
      gold: 'Identify breakout setups, trend acceleration signals, volume confirmation, relative strength vs sector, and catalyst alignment. Assess risk/reward asymmetry.',
      silver: 'Key momentum signals: breakout status, volume surge, and relative strength ranking.',
      bronze: 'Quick momentum scan: is it breaking out or breaking down? What energy is behind the move?',
    },
  },
  {
    slug: 'macro-strategist',
    name: 'Macro Strategist',
    prompt: 'You are a Macro Strategist, focused on macroeconomic indicators, central bank policy, and cross-asset analysis. Focus on: interest rates, inflation data, employment figures, Fed policy signals, yield curves, sector rotation, and geopolitical risks. You assess how macro forces create tailwinds or headwinds for individual instruments.',
    weight: 0.9,
    tier: {
      gold: 'Analyze interest rate trajectory, inflation trends, yield curve dynamics, Fed policy signals, employment data, GDP trends, geopolitical risks, and currency impacts. Assess macro tailwinds and headwinds.',
      silver: 'Key macro focus: interest rate direction, inflation trend, yield curve shape, and major policy signals.',
      bronze: 'Quick macro check: is the macro environment supportive or hostile for this instrument?',
    },
  },
];

const INSTRUMENTS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
];

// ── Org Configurations ───────────────────────────────────────────

interface OrgConfig {
  slug: string;
  name: string;
  adminEmail: string;
  analystEmail: string;
  disabledAnalysts: string[];
  weightOverrides: Record<string, number>;
  customAnalysts: Array<{ slug: string; name: string; prompt: string; weight: number }>;
}

const ORGS: OrgConfig[] = [
  {
    slug: 'alpha-capital',
    name: 'Alpha Capital',
    adminEmail: 'admin@alpha-capital.demo',
    analystEmail: 'analyst@alpha-capital.demo',
    disabledAnalysts: ['macro-strategist'],
    weightOverrides: { 'momentum-analyst': 1.3 },
    customAnalysts: [
      {
        slug: 'momentum-maria',
        name: 'Momentum Maria',
        prompt: 'You are Momentum Maria, a breakout specialist with high conviction. You identify stocks showing explosive momentum with volume confirmation and catalyst alignment. You are willing to take concentrated positions when the setup is right.',
        weight: 1.1,
      },
    ],
  },
  {
    slug: 'steadfast-advisors',
    name: 'Steadfast Advisors',
    adminEmail: 'admin@steadfast-advisors.demo',
    analystEmail: 'analyst@steadfast-advisors.demo',
    disabledAnalysts: ['momentum-analyst'],
    weightOverrides: { 'fundamentals-analyst': 1.2, 'macro-strategist': 1.2 },
    customAnalysts: [
      {
        slug: 'value-victor',
        name: 'Value Victor',
        prompt: 'You are Value Victor, a deep value analyst with a margin-of-safety focus. You seek companies trading below intrinsic value with strong balance sheets, sustainable competitive advantages, and catalysts for value realization. You never chase momentum.',
        weight: 1.0,
      },
    ],
  },
  {
    slug: 'apex-quant',
    name: 'Apex Quant',
    adminEmail: 'admin@apex-quant.demo',
    analystEmail: 'analyst@apex-quant.demo',
    disabledAnalysts: ['fundamentals-analyst'],
    weightOverrides: { 'technical-analyst': 1.3 },
    customAnalysts: [
      {
        slug: 'quant-quinn',
        name: 'Quant Quinn',
        prompt: 'You are Quant Quinn, a quantitative analyst focused on statistical patterns and mean reversion. You analyze price distributions, volatility regimes, and statistical anomalies. You trust data over narrative.',
        weight: 1.0,
      },
      {
        slug: 'macro-max',
        name: 'Macro Max',
        prompt: 'You are Macro Max, focused on macroeconomic indicators and central bank policy. You analyze interest rates, inflation data, employment figures, and Fed policy signals to determine macro tailwinds and headwinds for individual stocks.',
        weight: 0.9,
      },
    ],
  },
];

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('=== Divinr AI Demo Tenant Seeding ===\n');

  // 1. Create markets permissions
  console.log('Creating permissions...');
  const permIds: Record<string, string> = {};
  for (const [name, display] of [
    ['markets.instruments.read', 'Read instruments'],
    ['markets.instruments.write', 'Write instruments'],
    ['markets.analysts.read', 'Read analysts'],
    ['markets.analysts.write', 'Write analysts'],
    ['markets.runs.read', 'Read runs'],
    ['markets.runs.execute', 'Execute runs'],
    ['markets.sources.read', 'Read sources'],
    ['markets.sources.write', 'Write sources'],
    ['markets.predictors.read', 'Read predictors'],
    ['markets.predictors.write', 'Write predictors'],
  ]) {
    permIds[name] = await upsertPermission(name, display, 'markets');
  }

  // 2. Create roles
  console.log('\nCreating roles...');
  const adminRoleId = await upsertRole('markets-admin', 'Markets Admin');
  const analystRoleId = await upsertRole('markets-analyst', 'Markets Analyst');
  const viewerRoleId = await upsertRole('markets-viewer', 'Markets Viewer');

  // 3. Link permissions to roles
  console.log('\nLinking permissions to roles...');
  const allPerms = Object.values(permIds);
  for (const pId of allPerms) await linkRolePermission(adminRoleId, pId);

  const analystPerms = ['markets.instruments.read', 'markets.analysts.read', 'markets.runs.read', 'markets.runs.execute', 'markets.sources.read', 'markets.predictors.read', 'markets.predictors.write'];
  for (const p of analystPerms) await linkRolePermission(analystRoleId, permIds[p]);

  const viewerPerms = ['markets.instruments.read', 'markets.analysts.read', 'markets.runs.read', 'markets.sources.read', 'markets.predictors.read'];
  for (const p of viewerPerms) await linkRolePermission(viewerRoleId, permIds[p]);

  // 4. Seed each org
  for (const org of ORGS) {
    console.log(`\n── ${org.name} (${org.slug}) ──`);

    await upsertOrg(org.slug, org.name);

    const adminId = randomUUID();
    const analystId = randomUUID();
    await upsertUser(adminId, org.adminEmail, `Admin - ${org.name}`, org.slug);
    await upsertUser(analystId, org.analystEmail, `Analyst - ${org.name}`, org.slug);
    await assignUserRole(adminId, org.slug, adminRoleId);
    await assignUserRole(analystId, org.slug, analystRoleId);

    // Instruments
    console.log('  Instruments:');
    const instrumentIds: string[] = [];
    for (const inst of INSTRUMENTS) {
      const iId = await upsertInstrument(org.slug, inst.symbol, inst.name);
      instrumentIds.push(iId);
    }

    // Default analysts
    console.log('  Default analysts:');
    const analystIds: string[] = [];
    for (const def of DEFAULT_ANALYSTS) {
      const isDisabled = org.disabledAnalysts.includes(def.slug);
      const weightOverride = org.weightOverrides[def.slug];
      const aId = await upsertAnalyst(org.slug, def.slug, def.name, def.prompt, {
        weight: weightOverride ?? def.weight,
        isSystemDefault: true,
        isEnabled: !isDisabled,
        tierInstructions: def.tier,
      });
      if (!isDisabled) analystIds.push(aId);
    }

    // Custom analysts
    console.log('  Custom analysts:');
    for (const custom of org.customAnalysts) {
      const aId = await upsertAnalyst(org.slug, custom.slug, custom.name, custom.prompt, {
        weight: custom.weight,
        isSystemDefault: false,
        isEnabled: true,
      });
      analystIds.push(aId);
    }

    // Assignments: all enabled analysts → all instruments
    console.log('  Assignments:');
    for (const iId of instrumentIds) {
      for (const aId of analystIds) {
        await assignAnalyst(org.slug, iId, aId);
      }
    }

    console.log(`  Done: ${instrumentIds.length} instruments, ${analystIds.length} active analysts`);
  }

  console.log('\n=== Seeding complete ===');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
