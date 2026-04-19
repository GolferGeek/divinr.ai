import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loginAs } from '../fixtures/login.js';

async function loadEnv(path: string) {
  try {
    const raw = await readFile(path, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    // .env is optional; env vars may already be set
  }
}

async function main() {
  await loadEnv(resolve(process.cwd(), '.env'));

  const baseURL = process.env.BASE_URL ?? 'https://divinr.ai';
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  const out = process.env.PLAYWRIGHT_STORAGE_STATE ?? 'apps/e2e/.auth/testing-team.json';

  if (!email || !password) {
    throw new Error('TEST_USER_EMAIL and TEST_USER_PASSWORD must be set in apps/e2e/.env');
  }

  await mkdir(dirname(out), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    const result = await loginAs(page, email, password);
    console.log(`[prepare-auth] login landed at: ${result.url}`);
    await context.storageState({ path: out });
    console.log(`[prepare-auth] storage state written: ${out}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[prepare-auth] failed:', err);
  process.exit(1);
});
