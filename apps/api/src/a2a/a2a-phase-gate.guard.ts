import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DPoPNonceRequiredError,
  DPoPResourceService,
  type VerifiedAgentPrincipal,
} from '../oauth/dpop-resource.service';
import { DIVINR_A2A_RESOURCE } from '../oauth/oauth.constants';

const MAX_A2A_BODY_BYTES = 256 * 1024;
const MAX_SOURCE_REQUESTS_PER_MINUTE = 30;
const MAX_INSTALLATION_REQUESTS_PER_MINUTE = 60;
const MAX_GLOBAL_REQUESTS_PER_MINUTE = 1_200;

@Injectable()
export class A2APhaseGateGuard implements CanActivate {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  private globalWindow = { startedAt: 0, count: 0 };

  constructor(
    @Inject(DPoPResourceService)
    private readonly dpop: DPoPResourceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      rawBody?: Buffer;
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      socket?: { remoteAddress?: string };
      method?: string;
      agentPrincipal?: VerifiedAgentPrincipal;
    }>();
    const response = context.switchToHttp().getResponse<{
      setHeader(name: string, value: string): void;
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
    // `request.ip` is resolved by the configured Express trust-proxy policy.
    // Never trust a caller-supplied X-Forwarded-For header directly.
    const source = request.ip || request.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    this.globalWindow = now - this.globalWindow.startedAt >= 60_000
      ? { startedAt: now, count: 1 }
      : { ...this.globalWindow, count: this.globalWindow.count + 1 };
    if (this.globalWindow.count > MAX_GLOBAL_REQUESTS_PER_MINUTE) {
      throw new HttpException({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'The global A2A request limit has been exceeded.',
        retryable: true,
      }, 429);
    }
    const sourceKey = `source:${source}`;
    const existing = this.windows.get(sourceKey);
    const window = !existing || now - existing.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : existing;
    window.count += 1;
    this.windows.set(sourceKey, window);
    if (window.count > MAX_SOURCE_REQUESTS_PER_MINUTE) {
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
    const authorization = request.headers?.authorization;
    const proof = request.headers?.dpop;
    try {
      request.agentPrincipal = await this.dpop.authenticate(
        Array.isArray(authorization) ? authorization[0] : authorization,
        Array.isArray(proof) ? proof[0] : proof,
        request.method ?? 'POST',
        DIVINR_A2A_RESOURCE,
      );
      const installationKey =
        `installation:${request.agentPrincipal.installationInternalId}`;
      const installationExisting = this.windows.get(installationKey);
      const installationWindow =
        !installationExisting || now - installationExisting.startedAt >= 60_000
          ? { startedAt: now, count: 0 }
          : installationExisting;
      installationWindow.count += 1;
      this.windows.set(installationKey, installationWindow);
      if (installationWindow.count > MAX_INSTALLATION_REQUESTS_PER_MINUTE) {
        throw new HttpException({
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'The connected-agent installation request limit has been exceeded.',
          retryable: true,
        }, 429);
      }
      return true;
    } catch (error) {
      if (error instanceof DPoPNonceRequiredError) {
        response.setHeader('DPoP-Nonce', error.nonce);
        response.setHeader('WWW-Authenticate', 'DPoP error="use_dpop_nonce"');
      }
      if (error instanceof HttpException) throw error;
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Valid sender-constrained credentials are required.',
        retryable: false,
      });
    }
  }
}
