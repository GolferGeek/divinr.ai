import { HttpException, Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class OAuthRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  assert(key: string, maximum: number, windowMs = 60_000): void {
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (current.count >= maximum) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      throw new HttpException({
        error: 'slow_down',
        error_description: 'Request rate limit exceeded',
        retry_after: retryAfter,
      }, 429);
    }
    current.count += 1;
  }
}
