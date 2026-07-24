import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), 'src', path), 'utf8');
}

async function main(): Promise<void> {
  const credentialSource = source('oauth/oauth-credential.service.ts');
  const controllerSource = source('oauth/oauth.controller.ts');
  const resourceSource = source('oauth/dpop-resource.service.ts');
  const taskSource = source('a2a/a2a-invoke.controller.ts');

  for (const [name, content] of [
    ['credential service', credentialSource],
    ['OAuth controller', controllerSource],
    ['DPoP resource service', resourceSource],
    ['A2A task controller', taskSource],
  ] as const) {
    assert.doesNotMatch(
      content,
      /(?:console\.|logger\.(?:log|debug|warn|error)).*(?:access.?token|refresh.?token|authorization|dpop)/i,
      `${name} must not log credentials or proofs`,
    );
  }
  assert.doesNotMatch(
    taskSource,
    /refresh_token|privateKey|access_token/,
    'A2A tasks and model-facing controller must not receive reusable credentials',
  );
  assert.doesNotMatch(
    credentialSource,
    /redactedDetail:\s*\{[^}]*?(?:accessToken|refreshToken|privateKey|proof)/s,
    'security audit detail must not contain credentials or proofs',
  );
  assert.doesNotMatch(
    controllerSource,
    /JSON\.stringify\s*\(\s*(?:body|proof|token)/,
    'OAuth errors must not serialize request credentials',
  );
  assert.match(credentialSource, /sha256\(refreshToken\)/);
  assert.match(credentialSource, /sha256\(accessToken\)/);
  assert.match(resourceSource, /access_token_hash/);
  assert.doesNotMatch(
    resourceSource,
    /redactedDetail|model|analytics/,
    'proof material must not be copied into audit, model, or analytics paths',
  );

  console.log('OAuth credential redaction tests passed');
}

void main();
