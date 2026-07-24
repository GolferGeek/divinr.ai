import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function main(): void {
  const result = spawnSync(
    'bash',
    ['tests/http/oauth-dpop-curl.sh'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_HTTP_BASE: 'http://127.0.0.1:7198',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(
    result.status,
    0,
    `OAuth DPoP HTTP flow failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /OAuth DPoP curl checks passed/);
  console.log('OAuth DPoP HTTP integration tests passed');
}

main();
