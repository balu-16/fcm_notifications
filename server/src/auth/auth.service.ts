import { Inject, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { channel } from 'node:diagnostics_channel';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { FetchError } from 'aws-jwt-verify/error';
import { SimpleFetcher } from 'aws-jwt-verify/https';
import { SimpleJwksCache } from 'aws-jwt-verify/jwk';
import { APP_CONFIG, type AppConfig } from '../config/config.module.js';
import type { Principal } from './auth.types.js';

function safeNetworkError(error: unknown, depth = 0): object | undefined {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const value = error as { name?: unknown; code?: unknown; message?: unknown; address?: unknown; cause?: unknown; errors?: unknown };
  const clean = (item: unknown): string | undefined => typeof item === 'string'
    ? item.replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]').replace(/:\/\/[^/@\s]+@/g, '://[redacted]@').slice(0, 300)
    : undefined;
  return { name: clean(value.name), code: clean(value.code), message: clean(value.message), address: clean(value.address),
    cause: safeNetworkError(value.cause, depth + 1),
    errors: Array.isArray(value.errors) ? value.errors.slice(0, 10).map((item) => safeNetworkError(item, depth + 1)) : undefined };
}

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly verifier;
  private readonly jwksCache: SimpleJwksCache;
  private readonly jwksUrls: string[];
  private readonly timers = new Set<NodeJS.Timeout>();
  private stopped = false;
  private readonly networkErrors = channel('http.client.request.error');
  private readonly onNetworkError = (event: unknown): void => {
    const value = event as { request?: { host?: string; path?: string }; error?: unknown };
    if (!this.jwksUrls.some((url) => {
      const expected = new URL(url);
      return value.request?.host === expected.host && value.request.path === expected.pathname;
    })) return;
    console.warn(JSON.stringify({ level: 'warn', message: 'Cognito signing-key request failed', error: safeNetworkError(value.error) }));
  };
  private readonly adminGroup: string;
  private readonly logFailures: boolean;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.adminGroup = config.cognitoAdminGroup;
    this.logFailures = config.nodeEnv === 'development';
    const fetcher = new SimpleFetcher({ defaultRequestOptions: { timeout: 5000, responseTimeout: 10000, autoSelectFamilyAttemptTimeout: 2000 } });
    this.jwksCache = new SimpleJwksCache({ fetcher });
    this.jwksUrls = ['cognito-idp', 'issuer-cognito-idp'].map((prefix) =>
      `https://${prefix}.${config.cognitoRegion}.amazonaws.com/${config.cognitoUserPoolId}/.well-known/jwks.json`);
    this.verifier = CognitoJwtVerifier.create(
      { userPoolId: config.cognitoUserPoolId, clientId: config.cognitoAppClientIds, tokenUse: 'id' },
      { jwksCache: this.jwksCache },
    );
  }
  onModuleInit(): void {
    this.networkErrors.subscribe(this.onNetworkError);
    for (const url of this.jwksUrls) void this.preload(url);
  }
  onModuleDestroy(): void {
    this.stopped = true;
    this.networkErrors.unsubscribe(this.onNetworkError);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
  private async preload(url: string): Promise<void> {
    for (let attempt = 0; attempt < 5 && !this.stopped; attempt++) {
      try {
        await this.jwksCache.getJwks(url);
        if (this.logFailures && !this.stopped) console.info(JSON.stringify({ level: 'info', message: 'Cognito signing keys ready', host: new URL(url).host }));
        return;
      } catch (error: unknown) {
        if (this.stopped) return;
        console.warn(JSON.stringify({ level: 'warn', message: 'Cognito signing keys unavailable at startup', host: new URL(url).host, attempt: attempt + 1, error: safeNetworkError(error) }));
        if (attempt === 4) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { this.timers.delete(timer); resolve(); }, 1000 * 2 ** attempt);
          timer.unref();
          this.timers.add(timer);
        });
      }
    }
  }
  async verify(token: string): Promise<Principal> {
    let missingClaims = false;
    try {
      const claims = await this.verifier.verify(token);
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.email !== 'string' ||
        !claims.email
      ) {
        missingClaims = true;
        throw new Error('missing claims');
      }
      const groups = claims['cognito:groups'];
      return {
        sub: claims.sub,
        email: claims.email,
        role:
          Array.isArray(groups) && groups.includes(this.adminGroup) ? 'admin' : 'user',
      };
    } catch (error) {
      // Never expose verification errors or token contents to the caller or logs.
      // A fixed error category helps diagnose configuration issues without logging claims or tokens.
      if (this.logFailures) {
        const allowed = new Set([
          'JwtExpiredError', 'JwtInvalidIssuerError', 'CognitoJwtInvalidClientIdError',
          'CognitoJwtInvalidTokenUseError', 'JwtInvalidSignatureError', 'FetchError',
          'NonRetryableFetchError', 'KidNotFoundInJwksError', 'WaitPeriodNotYetEndedJwkError',
        ]);
        const category = missingClaims ? 'MissingRequiredClaims' :
          error instanceof Error && allowed.has(error.constructor.name) ? error.constructor.name : 'InvalidToken';
        const networkReason = error instanceof FetchError
          ? error.message.match(/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPERM|ENETUNREACH|EHOSTUNREACH|time-out/i)?.[0]
          : undefined;
        console.warn(JSON.stringify({ level: 'warn', message: 'Authentication failed', category, ...(networkReason ? { networkReason } : {}),
          ...(error instanceof FetchError ? { networkDetail: error.message.slice(0, 300) } : {}) }));
      }
      if (error instanceof FetchError) throw new ServiceUnavailableException('Authentication is temporarily unavailable. Please try again.');
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
