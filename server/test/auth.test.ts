import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../src/auth/auth.service.js';
import { JwtAuthGuard, RolesGuard } from '../src/auth/auth.guards.js';
import type { AppConfig } from '../src/config/config.module.js';
import { generateKeyPairSync, sign } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { FetchError } from 'aws-jwt-verify/error';
import { ServiceUnavailableException } from '@nestjs/common';

const config: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  databaseUrl: 'postgresql://localhost/test',
  corsOrigins: ['http://localhost:5173'],
  cognitoRegion: 'ap-southeast-2',
  cognitoUserPoolId: 'ap-southeast-2_example',
  cognitoAppClientIds: ['web-client', 'android-client'],
  cognitoAdminGroup: 'ADMIN',
  firebaseServiceAccountPath: '/unused',
};

function context(request: object): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('authentication and authorization', () => {
  it('rejects missing and malformed bearer tokens', async () => {
    const reflector = {
      getAllAndOverride: () => false,
    } as unknown as Reflector;
    const auth = { verify: vi.fn() } as unknown as AuthService;
    const guard = new JwtAuthGuard(reflector, auth);
    await expect(
      guard.canActivate(context({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(context({ headers: { authorization: 'Basic value' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.verify).not.toHaveBeenCalled();
  });

  it('derives admin access only from the verified group claim', async () => {
    const auth = new AuthService(config);
    const verifier = (
      auth as unknown as { verifier: { verify: ReturnType<typeof vi.fn> } }
    ).verifier;
    vi.spyOn(verifier, 'verify').mockResolvedValue({
      sub: 'sub',
      email: 'person@example.com',
      'cognito:groups': ['ADMIN'],
    });
    await expect(auth.verify('opaque')).resolves.toMatchObject({
      role: 'admin',
    });
    verifier.verify.mockResolvedValue({
      sub: 'sub',
      email: 'person@example.com',
      'cognito:groups': ['admin'],
    });
    await expect(auth.verify('opaque')).resolves.toMatchObject({ role: 'user' });
    verifier.verify.mockResolvedValue({
      sub: 'sub',
      email: 'person@example.com',
      role: 'admin',
    });
    await expect(auth.verify('opaque')).resolves.toMatchObject({
      role: 'user',
    });
    verifier.verify.mockRejectedValue(new Error('expired'));
    await expect(auth.verify('opaque')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('reports a temporary signing-key outage without treating valid credentials as invalid', async () => {
    const auth = new AuthService(config);
    const verifier = (auth as unknown as { verifier: { verify: ReturnType<typeof vi.fn> } }).verifier;
    vi.spyOn(verifier, 'verify').mockRejectedValue(new FetchError('https://example.test/jwks', 'network unavailable'));
    await expect(auth.verify('opaque')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('retries each issuer independently and stops after five attempts', async () => {
    vi.useFakeTimers();
    const auth = new AuthService(config);
    const cache = (auth as unknown as { jwksCache: { getJwks: (url: string) => Promise<unknown> } }).jwksCache;
    let regionalAttempts = 0;
    const fetch = vi.spyOn(cache, 'getJwks').mockImplementation(async (url) => {
      if (url.includes('issuer-cognito-idp')) throw new Error('unavailable');
      regionalAttempts++;
      if (regionalAttempts < 3) throw new Error('temporary');
      return { keys: [] };
    });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      auth.onModuleInit();
      await vi.advanceTimersByTimeAsync(16000);
      expect(regionalAttempts).toBe(3);
      expect(fetch.mock.calls.filter(([url]) => url.includes('issuer-cognito-idp'))).toHaveLength(5);
    } finally {
      auth.onModuleDestroy();
      warnings.mockRestore();
      vi.useRealTimers();
    }
  });

  it('logs underlying JWKS connection errors and addresses', () => {
    const auth = new AuthService(config);
    const cache = (auth as unknown as { jwksCache: { getJwks: (url: string) => Promise<unknown> } }).jwksCache;
    vi.spyOn(cache, 'getJwks').mockResolvedValue({ keys: [] });
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      auth.onModuleInit();
      const cause = Object.assign(new Error('connection failed'), { code: 'ETIMEDOUT', address: '192.0.2.1' });
      channel('http.client.request.error').publish({
        request: { host: 'cognito-idp.ap-southeast-2.amazonaws.com', path: `/${config.cognitoUserPoolId}/.well-known/jwks.json` },
        error: new AggregateError([cause], ''),
      });
      expect(warnings).toHaveBeenCalledOnce();
      expect(String(warnings.mock.calls[0][0])).toContain('ETIMEDOUT');
      expect(String(warnings.mock.calls[0][0])).toContain('192.0.2.1');
    } finally {
      auth.onModuleDestroy();
      warnings.mockRestore();
    }
  });

  it('returns forbidden for a signed-in non-admin', () => {
    const reflector = {
      getAllAndOverride: () => ['admin'],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() =>
      guard.canActivate(context({ user: { role: 'user' } })),
    ).toThrow(ForbiddenException);
    expect(guard.canActivate(context({ user: { role: 'admin' } }))).toBe(true);
  });

  it('accepts both configured Cognito audiences and rejects forged, expired, and wrong-client tokens', async () => {
    const auth = new AuthService(config);
    const verifier = (
      auth as unknown as { verifier: { cacheJwks: (value: object) => void } }
    ).verifier;
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    verifier.cacheJwks({
      keys: [
        {
          ...publicKey.export({ format: 'jwk' }),
          kid: 'test-key',
          use: 'sig',
          alg: 'RS256',
        },
      ],
    });
    function jwt(aud: string, exp: number, forged = false): string {
      const header = Buffer.from(
        JSON.stringify({ alg: 'RS256', kid: 'test-key' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: `https://cognito-idp.${config.cognitoRegion}.amazonaws.com/${config.cognitoUserPoolId}`,
          aud,
          token_use: 'id',
          sub: 'test-sub',
          email: 'user@example.com',
          exp,
        }),
      ).toString('base64url');
      const message = `${header}.${payload}`;
      const key = forged
        ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
        : privateKey;
      return `${message}.${sign('RSA-SHA256', Buffer.from(message), key).toString('base64url')}`;
    }
    const future = Math.floor(Date.now() / 1000) + 60;
    await expect(auth.verify(jwt('web-client', future))).resolves.toMatchObject(
      { sub: 'test-sub' },
    );
    await expect(
      auth.verify(jwt('android-client', future)),
    ).resolves.toMatchObject({ sub: 'test-sub' });
    await expect(
      auth.verify(jwt('another-client', future)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.verify(jwt('web-client', 1))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      auth.verify(jwt('web-client', future, true)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
