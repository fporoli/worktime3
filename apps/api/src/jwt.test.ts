import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createSign, generateKeyPairSync, type KeyLike } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt.guard';
import {
  authenticateToken,
  LOCAL_ISSUER,
  mintLocalToken,
  verifyKeycloakJwt,
  verifyLocalToken,
} from './jwt';

process.env.JWT_ISSUER = 'http://kc-test/realms/worktime';
process.env.JWT_AUDIENCE = 'worktime-web';
process.env.API_JWT_SECRET = 'test-secret';

function b64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signRs256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: KeyLike): string {
  const h = b64url(Buffer.from(JSON.stringify(header)));
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const signer = createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  return `${h}.${p}.${b64url(signer.sign(privateKey))}`;
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'test-key' };
const now = Math.floor(Date.now() / 1000);
const kcPayload = (over: Record<string, unknown> = {}) => ({
  iss: 'http://kc-test/realms/worktime',
  aud: 'worktime-web',
  sub: 'kc-user-1',
  email: 'kc@example.com',
  iat: now,
  exp: now + 3600,
  ...over,
});

test('local token roundtrip', async () => {
  const token = await mintLocalToken('user-1', 'a@example.com');
  const principal = await verifyLocalToken(token);
  assert.deepEqual(principal, { kind: 'local', sub: 'user-1', email: 'a@example.com' });
});

test('local token rejects tampering, expiry and wrong secret', async () => {
  const token = await mintLocalToken('user-1', 'a@example.com');
  const [h, p, s] = token.split('.');
  const tampered = `${h}.${Buffer.from(JSON.stringify({ iss: LOCAL_ISSUER, sub: 'user-2', exp: now + 3600 })).toString('base64url')}.${s}`;
  assert.equal(await verifyLocalToken(tampered), null);
  assert.equal(await verifyLocalToken(await mintLocalToken('user-1', 'a@example.com', -10)), null);
  process.env.API_JWT_SECRET = 'other-secret';
  assert.equal(await verifyLocalToken(token), null);
  process.env.API_JWT_SECRET = 'test-secret';
});

test('keycloak token verifies against JWKS', async () => {
  const token = signRs256({ alg: 'RS256', kid: 'test-key' }, kcPayload(), privateKey);
  const principal = await verifyKeycloakJwt(token, [publicJwk]);
  assert.deepEqual(principal, { kind: 'keycloak', sub: 'kc-user-1', email: 'kc@example.com' });
});

test('keycloak token rejects wrong issuer, audience, expiry and signature', async () => {
  const good = (over: Record<string, unknown> = {}) => signRs256({ alg: 'RS256', kid: 'test-key' }, kcPayload(over), privateKey);
  assert.equal(await verifyKeycloakJwt(good({ iss: 'http://evil/realms/x' }), [publicJwk]), null);
  assert.equal(await verifyKeycloakJwt(good({ aud: 'other-client' }), [publicJwk]), null);
  assert.equal(await verifyKeycloakJwt(good({ exp: now - 10 }), [publicJwk]), null);
  const token = good();
  const broken = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
  assert.equal(await verifyKeycloakJwt(broken, [publicJwk]), null);
  assert.equal(await verifyKeycloakJwt(good(), []), null);
});

test('authenticateToken tries local first, then keycloak', async () => {
  const local = await mintLocalToken('user-9', 'b@example.com');
  assert.equal((await authenticateToken(local))?.kind, 'local');
  const kc = signRs256({ alg: 'RS256', kid: 'other-key' }, kcPayload(), privateKey);
  assert.equal(await authenticateToken(kc), null);
});

function fakeContext(isPublic: boolean, headers: Record<string, string> = {}) {
  const req = { headers, user: undefined as unknown };
  return {
    req,
    context: {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req }),
    } as never,
    reflector: { getAllAndOverride: () => isPublic } as never,
  };
}

test('guard lets public routes through without a token', async () => {
  const { context, reflector } = fakeContext(true);
  const guard = new JwtAuthGuard(reflector);
  assert.equal(await guard.canActivate(context), true);
});

test('guard rejects protected routes without a token', async () => {
  const { context, reflector } = fakeContext(false);
  const guard = new JwtAuthGuard(reflector);
  await assert.rejects(() => guard.canActivate(context), (e: unknown) => {
    assert.ok(e instanceof UnauthorizedException);
    assert.equal((e as UnauthorizedException).getStatus(), 401);
    return true;
  });
});

test('guard accepts a local token and attaches the principal', async () => {
  const token = await mintLocalToken('user-7', 'c@example.com');
  const { req, context, reflector } = fakeContext(false, { authorization: `Bearer ${token}` });
  const guard = new JwtAuthGuard(reflector);
  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(req.user, { kind: 'local', sub: 'user-7', email: 'c@example.com' });
});
