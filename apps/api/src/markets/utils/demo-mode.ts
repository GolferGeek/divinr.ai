export function isMarketsDemoMode(): boolean {
  return process.env.MARKETS_DEMO_MODE === 'true' || process.env.DIVINR_DEMO_MODE === 'true';
}

export function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function demoDefaultInt(name: string, demoFallback: number, normalFallback: number): number {
  return envPositiveInt(name, isMarketsDemoMode() ? demoFallback : normalFallback);
}

function csvEnv(...names: string[]): string[] {
  for (const name of names) {
    const raw = process.env[name];
    if (raw && raw.trim() !== '') {
      return raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export function getPipelineInstrumentSymbols(): string[] {
  return csvEnv('MARKETS_ENABLED_INSTRUMENT_SYMBOLS', 'MARKETS_PIPELINE_INSTRUMENT_SYMBOLS')
    .map((symbol) => symbol.toUpperCase());
}

export function getDisabledInstrumentSymbols(): string[] {
  return csvEnv('MARKETS_DISABLED_INSTRUMENT_SYMBOLS')
    .map((symbol) => symbol.toUpperCase());
}

export function getPipelineInstrumentLimit(normalFallback: number): number {
  return demoDefaultInt('MARKETS_PIPELINE_INSTRUMENT_LIMIT', 2, normalFallback);
}

export function getEnabledSourceKeys(): string[] {
  return csvEnv('MARKETS_ENABLED_SOURCE_KEYS', 'MARKETS_PIPELINE_SOURCE_KEYS')
    .map((key) => key.toLowerCase());
}

export function getDisabledSourceKeys(): string[] {
  return csvEnv('MARKETS_DISABLED_SOURCE_KEYS')
    .map((key) => key.toLowerCase());
}

export function getEnabledAnalystSlugs(): string[] {
  return csvEnv('MARKETS_ENABLED_ANALYST_SLUGS', 'MARKETS_PIPELINE_ANALYST_SLUGS')
    .map((slug) => slug.toLowerCase());
}

export function getDisabledAnalystSlugs(): string[] {
  return csvEnv('MARKETS_DISABLED_ANALYST_SLUGS')
    .map((slug) => slug.toLowerCase());
}

export function filterByEnabledDisabledSlug<T extends { slug: string }>(items: T[]): T[] {
  const enabled = new Set(getEnabledAnalystSlugs());
  const disabled = new Set(getDisabledAnalystSlugs());
  return items.filter((item) => {
    const slug = item.slug.toLowerCase();
    return (enabled.size === 0 || enabled.has(slug)) && !disabled.has(slug);
  });
}
