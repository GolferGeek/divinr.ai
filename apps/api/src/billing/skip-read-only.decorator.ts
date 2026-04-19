import { SetMetadata } from '@nestjs/common';

export const SKIP_READ_ONLY_KEY = 'skipReadOnly';

/**
 * Exempt a route from ReadOnlyGuard. Applied to the routes that an expired
 * user must still be able to hit: checkout/portal, auth, status polling,
 * and self-serve social opt-outs. Per PRD §4.3.
 */
export const SkipReadOnly = () => SetMetadata(SKIP_READ_ONLY_KEY, true);
