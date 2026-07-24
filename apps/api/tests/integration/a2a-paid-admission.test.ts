import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function main(): void {
  assert.equal(
    process.env.AGENT_COMMERCE_DB_TESTS,
    'true',
    'Set AGENT_COMMERCE_DB_TESTS=true to run the admission boundary harness',
  );
  const result = spawnSync(
    'bash',
    ['tests/http/a2a-paid-admission-curl.sh'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_HTTP_BASE: 'http://127.0.0.1:7199',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(
    result.status,
    0,
    `A2A paid admission failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /A2A paid-admission curl checks passed/);
  console.log('A2A paid-admission integration tests passed');
}

main();
