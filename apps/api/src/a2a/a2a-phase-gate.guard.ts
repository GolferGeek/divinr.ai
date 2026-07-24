import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnauthorizedException,
} from '@nestjs/common';

const MAX_A2A_BODY_BYTES = 256 * 1024;
const MAX_UNAUTHENTICATED_REQUESTS_PER_MINUTE = 60;

@Injectable()
export class A2APhaseGateGuard implements CanActivate {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      rawBody?: Buffer;
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();
    const contentLength = Number(request.headers?.['content-length'] ?? 0);
    if (
      (Number.isFinite(contentLength) && contentLength > MAX_A2A_BODY_BYTES)
      || (request.rawBody?.byteLength ?? 0) > MAX_A2A_BODY_BYTES
    ) {
      throw new PayloadTooLargeException('A2A request exceeds 256 KiB');
    }
    const contentType = request.headers?.['content-type'];
    const selectedContentType = Array.isArray(contentType)
      ? contentType[0]
      : contentType;
    if (!selectedContentType?.toLowerCase().startsWith('application/json')) {
      throw new UnsupportedMediaTypeException(
        'A2A JSON-RPC requires Content-Type: application/json',
      );
    }
    const forwarded = request.headers?.['x-forwarded-for'];
    const source = (
      Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
    )?.trim() || request.ip || request.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const existing = this.windows.get(source);
    const window = !existing || now - existing.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : existing;
    window.count += 1;
    this.windows.set(source, window);
    if (window.count > MAX_UNAUTHENTICATED_REQUESTS_PER_MINUTE) {
      throw new HttpException({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'A2A authentication attempts exceeded the per-source limit.',
        retryable: true,
      }, 429);
    }
    if (this.windows.size > 10_000) {
      for (const [key, value] of this.windows) {
        if (now - value.startedAt >= 60_000) this.windows.delete(key);
      }
    }
    throw new UnauthorizedException({
      code: 'AUTH_REQUIRED',
      message: 'DPoP connected-agent authentication is not enabled yet.',
      retryable: false,
    });
  }
}
