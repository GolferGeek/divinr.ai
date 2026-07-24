import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';

function assertJsonValue(value: unknown, seen = new WeakSet<object>()): void {
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new TypeError('Value is not valid JSON');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Non-finite numbers are not valid JSON');
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) throw new TypeError('Cyclic values are not valid JSON');
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError('Sparse arrays are not valid JSON');
      assertJsonValue(value[index], seen);
    }
  } else {
    for (const member of Object.values(value as Record<string, unknown>)) {
      assertJsonValue(member, seen);
    }
  }
  seen.delete(value);
}

export function canonicalJson(value: unknown): string {
  assertJsonValue(value);
  const result = canonicalize(value);
  return result;
}

export function canonicalJsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(canonicalJson(value));
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJsonBytes(value)).digest('hex');
}

export function canonicalSha256Base64Url(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJsonBytes(value))
    .digest('base64url');
}
