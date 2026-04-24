import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  // .env optional
}

// The web app appends `Authorization: Bearer <divinr_token>` from localStorage
// inside its own fetch interceptor, but Playwright's `page.request` / `request`
// fixture does NOT run that interceptor — the request goes through the Vite
// proxy with no auth header, which the API rejects with 401. Read the storage
// state file once at config load and surface the JWT as a default
// `extraHTTPHeaders` value so server-side fixture calls carry the bearer too.
const storageStatePath = process.env.PLAYWRIGHT_STORAGE_STATE ?? '.auth/testing-team.json';
let bearerHeaders: Record<string, string> | undefined;
try {
  const stateRaw = readFileSync(resolve(process.cwd(), storageStatePath), 'utf8');
  const state = JSON.parse(stateRaw) as { origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }> };
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (item.name === 'divinr_token' && item.value) {
        bearerHeaders = { Authorization: `Bearer ${item.value}` };
        break;
      }
    }
    if (bearerHeaders) break;
  }
} catch {
  // storage state may be absent for unauth specs — that's fine
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://divinr.ai',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    storageState: process.env.PLAYWRIGHT_STORAGE_STATE ?? undefined,
    extraHTTPHeaders: bearerHeaders,
  },
  projects: [
    { name: 'smoke', testMatch: 'smoke/*.spec.ts' },
    { name: 'predictions', testMatch: 'predictions/*.spec.ts' },
    { name: 'portfolios', testMatch: 'portfolios/*.spec.ts' },
    { name: 'tournaments', testMatch: 'tournaments/*.spec.ts' },
    { name: 'clubs', testMatch: 'clubs/*.spec.ts' },
    { name: 'analysts', testMatch: 'analysts/*.spec.ts' },
    { name: 'instruments', testMatch: 'instruments/*.spec.ts' },
    { name: 'performance', testMatch: 'performance/*.spec.ts' },
    { name: 'authoring', testMatch: 'authoring/*.spec.ts' },
    { name: 'billing', testMatch: 'billing/*.spec.ts' },
    { name: 'admin', testMatch: 'admin/*.spec.ts' },
  ],
});
