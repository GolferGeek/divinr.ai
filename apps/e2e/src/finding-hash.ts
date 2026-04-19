import { createHash } from 'node:crypto';

export function findingHash(specPath: string, testName: string): string {
  return createHash('sha1')
    .update(`divinr:${specPath}:${testName}`)
    .digest('hex')
    .slice(0, 8);
}
