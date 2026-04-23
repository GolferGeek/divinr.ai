/**
 * Unit tests for ReadOnlyGuard — the global guard that 403s write requests
 * for users whose subscription is canceled or dormant. Exempt routes
 * (@SkipReadOnly, auth, billing status/checkout, self-serve opt-outs)
 * are allowed through so an expired user can still reactivate.
 *
 * Effort: user-billing-model (Phase 3a).
 */
import { ForbiddenException } from '@nestjs/common';
import { ReadOnlyGuard } from '../../src/billing/read-only.guard';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}`);
  }
}

function makeContext(request: Record<string, unknown>): any {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
}

function makeGuard(opts: {
  isReadOnly: boolean;
  skip?: boolean;
}) {
  const billing = { isReadOnly: async () => opts.isReadOnly };
  const reflector = { getAllAndOverride: () => opts.skip === true };
  const guard = Object.create(ReadOnlyGuard.prototype) as ReadOnlyGuard;
  (guard as any).billing = billing;
  (guard as any).reflector = reflector;
  return guard;
}

async function expectForbidden(promise: Promise<boolean>, label: string) {
  try {
    await promise;
    assert(false, `${label} — expected ForbiddenException`);
  } catch (err) {
    if (err instanceof ForbiddenException) {
      const response = err.getResponse() as { code?: string };
      assert(response?.code === 'SUBSCRIPTION_EXPIRED', `${label} — throws ForbiddenException with code=SUBSCRIPTION_EXPIRED`);
    } else {
      assert(false, `${label} — threw non-Forbidden: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main(): Promise<void> {
  console.log('\n=== ReadOnlyGuard Tests ===\n');

  // GET is always allowed
  {
    const guard = makeGuard({ isReadOnly: true });
    const ok = await guard.canActivate(makeContext({ method: 'GET', url: '/clubs', user: { id: 'u1' } }));
    assert(ok === true, 'GET request is allowed even for read-only user');
  }

  // HEAD and OPTIONS also allowed
  for (const method of ['HEAD', 'OPTIONS']) {
    const guard = makeGuard({ isReadOnly: true });
    const ok = await guard.canActivate(makeContext({ method, url: '/clubs', user: { id: 'u1' } }));
    assert(ok === true, `${method} request is allowed even for read-only user`);
  }

  // @SkipReadOnly() metadata exempts a write handler
  {
    const guard = makeGuard({ isReadOnly: true, skip: true });
    const ok = await guard.canActivate(makeContext({ method: 'POST', url: '/billing/checkout-session', user: { id: 'u1' } }));
    assert(ok === true, '@SkipReadOnly() handler passes even for read-only user');
  }

  // Exempt-by-path: /auth/* write from expired user
  {
    const guard = makeGuard({ isReadOnly: true });
    const ok = await guard.canActivate(makeContext({ method: 'POST', url: '/auth/login', user: { id: 'u1' } }));
    assert(ok === true, '/auth/* write is path-exempt for read-only user');
  }

  // Exempt-by-path: /users/:id/social-opt-outs PATCH from expired user
  {
    const guard = makeGuard({ isReadOnly: true });
    const ok = await guard.canActivate(makeContext({ method: 'PATCH', url: '/users/u1/social-opt-outs', user: { id: 'u1' } }));
    assert(ok === true, 'PATCH /users/:id/social-opt-outs is path-exempt for read-only user');
  }

  // Exempt-by-path: /billing/status, /billing/checkout-session, /billing/portal-session
  for (const path of ['/billing/status', '/billing/checkout-session', '/billing/portal-session', '/billing/webhooks/stripe']) {
    const guard = makeGuard({ isReadOnly: true });
    const ok = await guard.canActivate(makeContext({ method: 'POST', url: path, user: { id: 'u1' } }));
    assert(ok === true, `POST ${path} is path-exempt for read-only user`);
  }

  // Unauthenticated write passes through (downstream auth guards reject)
  {
    const guard = makeGuard({ isReadOnly: true });
    const ok = await guard.canActivate(makeContext({ method: 'POST', url: '/clubs' }));
    assert(ok === true, 'Write with no user passes ReadOnlyGuard (auth guard handles elsewhere)');
  }

  // Trial user POST: allowed
  {
    const guard = makeGuard({ isReadOnly: false });
    const ok = await guard.canActivate(makeContext({ method: 'POST', url: '/clubs', user: { id: 'u1' } }));
    assert(ok === true, 'POST from trial user is allowed');
  }

  // Expired user POST: 403 with SUBSCRIPTION_EXPIRED
  {
    const guard = makeGuard({ isReadOnly: true });
    await expectForbidden(
      guard.canActivate(makeContext({ method: 'POST', url: '/clubs', user: { id: 'u1' } })),
      'POST from expired user',
    );
  }

  // Expired user PATCH on a non-exempt path: 403
  {
    const guard = makeGuard({ isReadOnly: true });
    await expectForbidden(
      guard.canActivate(makeContext({ method: 'PATCH', url: '/users/u1/profile', user: { id: 'u1' } })),
      'PATCH /users/:id/profile from expired user',
    );
  }

  // originalUrl is preferred over url (express populates both)
  {
    const guard = makeGuard({ isReadOnly: true });
    const ok = await guard.canActivate(makeContext({
      method: 'POST',
      originalUrl: '/billing/status?cache=false',
      url: '/whatever',
      user: { id: 'u1' },
    }));
    assert(ok === true, 'Exempt-path match uses originalUrl with querystring stripped');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
