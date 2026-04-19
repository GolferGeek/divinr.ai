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
    { name: 'admin', testMatch: 'admin/*.spec.ts' },
  ],
});
