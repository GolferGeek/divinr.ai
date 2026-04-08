import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  DataSourceAdapter,
  DataSourceFetchParams,
  DataSourceResult,
} from '../../../../src/markets/adapters/data-source-adapter';

/**
 * Stub adapter base class for the markets integration test suite.
 *
 * Two modes selected at construction by the MARKETS_FIXTURE_CAPTURE env var:
 *
 *   replay (default):
 *     Reads canned JSON from `${fixturesDir}/${scenarioKey}.json` and returns
 *     the parsed result. Throws a clear error if the file is missing.
 *
 *   capture (`MARKETS_FIXTURE_CAPTURE=true`):
 *     Lazily instantiates the real adapter via the supplied factory, calls its
 *     fetchData(), writes the result to the fixture file, and returns it.
 *
 * Capture mode prints a one-time banner at module load so it cannot be silently
 * left on.
 */

const CAPTURE_MODE_FLAG = 'MARKETS_FIXTURE_CAPTURE';
let bannerPrinted = false;

export function isCaptureMode(): boolean {
  return process.env[CAPTURE_MODE_FLAG] === 'true';
}

function maybePrintBanner(): void {
  if (bannerPrinted) return;
  if (!isCaptureMode()) return;
  bannerPrinted = true;
  // eslint-disable-next-line no-console
  console.warn(
    '\n⚠️  MARKETS_FIXTURE_CAPTURE=true — stub adapters will hit real APIs and overwrite fixture files.\n',
  );
}

/**
 * Deterministic mapping from a fetch params object to a fixture file basename.
 *
 * Algorithm: lower-case the symbol, sort the dataTypes array (so order is
 * irrelevant), join with underscores. The optional from/to window is included
 * only if present so the canonical "no window" call has a clean key.
 *
 * Example:
 *   { symbol: 'AAPL', dataTypes: ['snapshot', 'news'] } → "aapl__news_snapshot"
 *   { symbol: 'AAPL', dataTypes: ['snapshot'], from: '2026-01-01', to: '2026-01-31' }
 *     → "aapl__snapshot__2026-01-01_2026-01-31"
 */
export function scenarioKeyFromParams(params: DataSourceFetchParams): string {
  const symbol = params.symbol.toLowerCase();
  const types = [...params.dataTypes].sort().join('_');
  let key = `${symbol}__${types}`;
  if (params.from || params.to) {
    key += `__${params.from ?? ''}_${params.to ?? ''}`;
  }
  return key;
}

export interface StubAdapterOptions {
  id: string;
  name: string;
  provider: string;
  tier: string;
  rateLimitPerMinute: number;
  fixturesDir: string;
  realAdapterFactory: () => DataSourceAdapter;
}

export class StubAdapterBase implements DataSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly tier: string;
  readonly rateLimitPerMinute: number;
  private readonly fixturesDir: string;
  private readonly realAdapterFactory: () => DataSourceAdapter;

  constructor(opts: StubAdapterOptions) {
    this.id = opts.id;
    this.name = opts.name;
    this.provider = opts.provider;
    this.tier = opts.tier;
    this.rateLimitPerMinute = opts.rateLimitPerMinute;
    this.fixturesDir = opts.fixturesDir;
    this.realAdapterFactory = opts.realAdapterFactory;
    maybePrintBanner();
  }

  async fetchData(params: DataSourceFetchParams): Promise<DataSourceResult> {
    const key = scenarioKeyFromParams(params);
    const fixturePath = join(this.fixturesDir, `${key}.json`);

    if (isCaptureMode()) {
      const real = this.realAdapterFactory();
      const result = await real.fetchData(params);
      if (!existsSync(this.fixturesDir)) {
        mkdirSync(this.fixturesDir, { recursive: true });
      }
      await fs.writeFile(fixturePath, JSON.stringify(result, null, 2) + '\n', 'utf8');
      return result;
    }

    try {
      const raw = await fs.readFile(fixturePath, 'utf8');
      return JSON.parse(raw) as DataSourceResult;
    } catch (err) {
      const msg =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `Stub fixture not found: ${fixturePath}\n` +
            `Run \`MARKETS_FIXTURE_CAPTURE=true pnpm --filter @divinr/api test:markets:integration\` ` +
            `to capture it from the real ${this.name} API.`
          : `Failed to load stub fixture ${fixturePath}: ${err instanceof Error ? err.message : String(err)}`;
      throw new Error(msg);
    }
  }
}
