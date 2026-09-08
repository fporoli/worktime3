import { createHmac, createPublicKey, createVerify, timingSafeEqual, type JsonWebKeyInput } from 'node:crypto';

/**
 * Token verification for the API (zero extra dependencies).
 * Accepts two issuers:
 * - Keycloak (RS256, verified against the realm JWKS): the SSO path.
 * - Local logins (HS256, `worktime-api` issuer): minted by AuthController
 *   for the web login screen, so the UI works without a browser SSO roundtrip.
 */

export const LOCAL_ISSUER = 'worktime-api';
export const LOCAL_ALG = 'HS256';

export interface AuthenticatedPrincipal {
  kind: 'keycloak' | 'local';
  /** Keycloak `sub`, or the local user id. */
  sub: string;
  email?: string;
}

interface JwtHeader {
  alg: string;
  kid?: string;
}

export function keycloakIssuer(): string {
  return process.env.JWT_ISSUER ?? 'http://localhost:8091/realms/worktime';
}

export function keycloakAudience(): string {
  return process.env.JWT_AUDIENCE ?? 'worktime-web';
}

function localSecret(): Buffer {
  return Buffer.from(process.env.API_JWT_SECRET ?? 'dev-only-secret-change-me', 'utf8');
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function b64urlEncode(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseToken(token: string): { header: JwtHeader; payload: Record<string, unknown>; signingInput: string; signature: Buffer } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(b64urlDecode(parts[0]).toString('utf8')) as JwtHeader,
      payload: JSON.parse(b64urlDecode(parts[1]).toString('utf8')) as Record<string, unknown>,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: b64urlDecode(parts[2]),
    };
  } catch {
    return null;
  }
}

function checkTimeClaims(payload: Record<string, unknown>, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) return false;
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf) return false;
  return true;
}

function checkAudience(payload: Record<string, unknown>, audience: string): boolean {
  const aud = payload.aud;
  const list = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
  return (list as unknown[]).includes(audience) || payload.azp === audience;
}

interface Jwk {
  kid?: string;
  kty?: string;
  [k: string]: unknown;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

/** For tests: reset the cached remote JWKS. */
export function resetJwksCache() {
  jwksCache = null;
}

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(`${keycloakIssuer()}/protocol/openid-connect/certs`);
  if (!res.ok) throw new Error(`jwks-fetch-failed:${res.status}`);
  const data = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { keys: data.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

export async function verifyKeycloakJwt(
  token: string,
  keys?: Jwk[],
): Promise<AuthenticatedPrincipal | null> {
  const parsed = parseToken(token);
  if (!parsed || parsed.header.alg !== 'RS256') return null;
  if (parsed.payload.iss !== keycloakIssuer()) return null;
  if (!checkTimeClaims(parsed.payload)) return null;
  if (!checkAudience(parsed.payload, keycloakAudience())) return null;
  let jwks = keys ?? null;
  try {
    jwks = jwks ?? (await getJwks());
  } catch {
    return null;
  }
  const candidates = parsed.header.kid ? jwks.filter((k) => k.kid === parsed.header.kid) : jwks;
  for (const jwk of candidates) {
    try {
      const key = createPublicKey({ key: jwk as unknown as JsonWebKeyInput['key'], format: 'jwk' });
      const verifier = createVerify('RSA-SHA256');
      verifier.update(parsed.signingInput);
      if (!verifier.verify(key, parsed.signature)) continue;
      if (typeof parsed.payload.sub !== 'string') return null;
      return {
        kind: 'keycloak',
        sub: parsed.payload.sub,
        email: typeof parsed.payload.email === 'string' ? parsed.payload.email : undefined,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function mintLocalToken(userId: string, email: string, expiresInSec = 12 * 3600): Promise<string> {
  const header = b64urlEncode(Buffer.from(JSON.stringify({ alg: LOCAL_ALG, typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlEncode(
    Buffer.from(JSON.stringify({ iss: LOCAL_ISSUER, sub: userId, email, iat: now, exp: now + expiresInSec })),
  );
  const sig = createHmac('sha256', localSecret()).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64urlEncode(sig)}`;
}

export async function verifyLocalToken(token: string): Promise<AuthenticatedPrincipal | null> {
  const parsed = parseToken(token);
  if (!parsed || parsed.header.alg !== LOCAL_ALG) return null;
  if (parsed.payload.iss !== LOCAL_ISSUER) return null;
  if (!checkTimeClaims(parsed.payload)) return null;
  const expected = createHmac('sha256', localSecret()).update(parsed.signingInput).digest();
  if (expected.length !== parsed.signature.length || !timingSafeEqual(expected, parsed.signature)) return null;
  if (typeof parsed.payload.sub !== 'string') return null;
  return {
    kind: 'local',
    sub: parsed.payload.sub,
    email: typeof parsed.payload.email === 'string' ? parsed.payload.email : undefined,
  };
}

/** Try local first (cheap, no network), then Keycloak. */
export async function authenticateToken(token: string): Promise<AuthenticatedPrincipal | null> {
  return (await verifyLocalToken(token)) ?? (await verifyKeycloakJwt(token));
}
