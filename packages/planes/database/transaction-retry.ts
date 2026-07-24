import type {
  DatabaseService,
  DatabaseTransaction,
} from './database.interface';

export interface SerializableTransactionOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isRetryableTransactionError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === '40001' || code === '40P01' || code === '1205') return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('serialization failure') || message.includes('deadlock victim');
}

export async function runSerializableTransaction<T>(
  database: DatabaseService,
  work: (transaction: DatabaseTransaction) => Promise<T>,
  options: SerializableTransactionOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 10;
  const sleep = options.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await database.withTransaction(work, {
        isolationLevel: 'serializable',
      });
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableTransactionError(error)) {
        throw error;
      }
      const jitteredDelay = Math.ceil(baseDelayMs * 2 ** (attempt - 1) * (0.5 + random()));
      await sleep(jitteredDelay);
    }
  }
  throw new Error('Unreachable serializable transaction state');
}
