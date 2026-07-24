import assert from 'node:assert/strict';
import {
  HttpException,
  PayloadTooLargeException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { A2AInvokeController } from '../../src/a2a/a2a-invoke.controller';
import { A2APhaseGateGuard } from '../../src/a2a/a2a-phase-gate.guard';
import { A2ATaskAccessPolicy } from '../../src/a2a/a2a-task-access.policy';

function request(method = 'GetTask') {
  return {
    jsonrpc: '2.0',
    id: 'rpc-1',
    method,
    params: { id: 'task-1' },
  };
}

async function main(): Promise<void> {
  const controller = new A2AInvokeController();
  assert.equal(controller.invoke(
    { jsonrpc: '1.0', id: 'rpc-1', method: 'GetTask', params: {} },
    '1.0',
    undefined,
  ).error.code, -32600);
  assert.equal(controller.invoke(
    request('invoke'),
    '1.0',
    undefined,
  ).error.code, -32601);
  assert.equal(controller.invoke(
    request(),
    '0.3',
    undefined,
  ).error.code, -32600);
  assert.equal(controller.invoke(
    { ...request(), params: null },
    '1.0',
    undefined,
  ).error.code, -32602);
  assert.equal(controller.invoke(
    request('SendMessage'),
    '1.0',
    undefined,
  ).error.code, -32602);
  const disabled = controller.invoke(
    request('SendMessage'),
    '1.0',
    'urn:golfergeek:a2a:x402-lightning-regtest:v0.2',
  );
  assert.equal(disabled.error.code, -32602);
  assert.equal(controller.invoke(
    { ...request(), unexpected: true },
    '1.0',
    undefined,
  ).error.code, -32600);
  assert.equal(controller.invoke(
    {
      jsonrpc: '2.0',
      id: 'rpc-1',
      method: 'ListTasks',
      params: { pageSize: 51 },
    },
    '1.0',
    undefined,
  ).error.code, -32602);
  assert.equal(controller.invoke(
    {
      jsonrpc: '2.0',
      id: 'rpc-1',
      method: 'CancelTask',
      params: { id: 'task-1', metadata: {} },
    },
    '1.0',
    undefined,
  ).error.code, -32602);
  const protectedMethod = controller.invoke(
    request('GetTask'),
    '1.0',
    undefined,
  );
  assert.equal(protectedMethod.error.code, -32050);
  assert.equal(protectedMethod.error.data?.code, 'AUTH_REQUIRED');

  const deniedDpop = {
    authenticate: async () => {
      throw new UnauthorizedException();
    },
  };
  const guard = new A2APhaseGateGuard(deniedDpop as never);
  const context = (contentLength: number, rawBodyLength = 0) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          'content-length': String(contentLength),
          'content-type': 'application/json',
        },
        rawBody: Buffer.alloc(rawBodyLength),
      }),
      getResponse: () => ({ setHeader: () => undefined }),
    }),
  });
  await assert.rejects(
    () => guard.canActivate(context(1) as never),
    UnauthorizedException,
  );
  await assert.rejects(
    () => guard.canActivate(context(256 * 1024 + 1) as never),
    PayloadTooLargeException,
  );
  const rateGuard = new A2APhaseGateGuard(deniedDpop as never);
  for (let index = 0; index < 60; index += 1) {
    await assert.rejects(
      () => rateGuard.canActivate(context(1) as never),
      UnauthorizedException,
    );
  }
  await assert.rejects(
    () => rateGuard.canActivate(context(1) as never),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 429,
  );

  const taskAccess = new A2ATaskAccessPolicy();
  const principal = {
    effectiveUserId: 'user-1',
    installationId: 'installation-1',
    grantId: 'grant-1',
    scopes: ['analysis:purchase'],
  };
  const binding = {
    userId: 'user-1',
    installationId: 'installation-1',
    grantId: 'grant-1',
    originalSkillScope: 'analysis:purchase',
  };
  assert.doesNotThrow(() => taskAccess.assertAccess(principal, binding));
  for (const altered of [
    { ...binding, userId: 'user-2' },
    { ...binding, installationId: 'installation-2' },
    { ...binding, grantId: 'grant-2' },
    { ...binding, originalSkillScope: 'tournaments:trade' },
  ]) {
    assert.throws(
      () => taskAccess.assertAccess(principal, altered),
      ForbiddenException,
    );
  }
  await assert.rejects(
    () => guard.canActivate(context(0, 256 * 1024 + 1) as never),
    PayloadTooLargeException,
  );

  console.log('A2A protocol fail-closed tests passed');
}

void main();
