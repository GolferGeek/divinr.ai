export const REQUEST_SCHEMA_BOOTSTRAP_LOCK = 'request-schema-bootstrap';

/**
 * Temporary global runtime bootstrap lock.
 *
 * During the schema-hardening effort we still have multiple request paths
 * calling domain-specific ensureSchema() methods. Those methods are already
 * memoized per service, but they can still race across services and deadlock
 * each other in Postgres when they all perform DDL at once.
 *
 * This coordinator gives the process a single in-flight lock per key so the
 * remaining runtime bootstrap work executes sequentially until it is moved to
 * explicit startup/bootstrap phases.
 */
export class RuntimeSchemaBootstrapCoordinator {
  private static readonly inflight = new Map<string, Promise<void>>();

  static async runExclusive(key: string, task: () => Promise<void>): Promise<void> {
    const existing = RuntimeSchemaBootstrapCoordinator.inflight.get(key) ?? Promise.resolve();
    const promise = existing.catch(() => undefined).then(async () => {
      await task();
    });

    RuntimeSchemaBootstrapCoordinator.inflight.set(key, promise);

    try {
      await promise;
    } finally {
      if (RuntimeSchemaBootstrapCoordinator.inflight.get(key) === promise) {
        RuntimeSchemaBootstrapCoordinator.inflight.delete(key);
      }
    }
  }
}
