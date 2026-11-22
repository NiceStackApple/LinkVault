import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import { verifyAnonymousSession, verifyMcpApiToken } from './mcpStore';

const FIREBASE_PROJECT_ID = 'linkvaultpro';
const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FIREBASE_X509_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface JwkKey {
  kid: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
}

let cachedKeys: { keys: Map<string, crypto.KeyObject>; expiresAt: number } | null = null;

async function fetchFirebasePublicKeys(): Promise<{ keys: Map<string, crypto.KeyObject>; ttlMs: number }> {
  // Primary: JWKS endpoint
  try {
    const res = await fetch(FIREBASE_JWKS_URL);
    if (res.ok) {
      const cacheControl = res.headers.get('cache-control') || '';
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
      const data = (await res.json()) as { keys?: JwkKey[] };
      const map = new Map<string, crypto.KeyObject>();
      for (const key of data.keys || []) {
        if (key.kid) {
          map.set(
            key.kid,
            crypto.createPublicKey({ key: key as unknown as crypto.JsonWebKey, format: 'jwk' })
          );
        }
      }
      if (map.size > 0) {
        return { keys: map, ttlMs: Math.min(ttlMs, 6 * 3600 * 1000) };
      }
    }
  } catch (err) {
    console.warn('[auth] JWKS fetch failed, falling back to x509:', err instanceof Error ? err.message : err);
  }

  // Fallback: x509 PEM certificates endpoint
  const certRes = await fetch(FIREBASE_X509_URL);
  if (!certRes.ok) {
    throw new Error(`Failed to fetch Firebase public certificates: ${certRes.status}`);
  }
  const cacheControl = certRes.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  const certs = (await certRes.json()) as Record<string, string>;
  const map = new Map<string, crypto.KeyObject>();
  for (const [kid, pem] of Object.entries(certs)) {
    map.set(kid, crypto.createPublicKey(pem));
  }
  return { keys: map, ttlMs: Math.min(ttlMs, 6 * 3600 * 1000) };
}

async function getFirebasePublicKey(kid: string): Promise<crypto.KeyObject | null> {
  const now = Date.now();
  if (!cachedKeys || cachedKeys.expiresAt <= now || !cachedKeys.keys.has(kid)) {
    const fetched = await fetchFirebasePublicKeys();
    cachedKeys = { keys: fetched.keys, expiresAt: now + fetched.ttlMs };
  }
  return cachedKeys.keys.get(kid) || null;
}

function base64UrlDecodeToBuffer(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export async function verifyFirebaseIdToken(token: string): Promise<{ uid: string; email?: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSig] = parts;
    const header = JSON.parse(base64UrlDecodeToBuffer(encodedHeader).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) {
      console.warn('[auth] Rejected token: invalid header alg/kid');
      return null;
    }

    const payload = JSON.parse(base64UrlDecodeToBuffer(encodedPayload).toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.aud !== FIREBASE_PROJECT_ID) {
      console.warn('[auth] Rejected token: aud mismatch');
      return null;
    }
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
      console.warn('[auth] Rejected token: iss mismatch');
      return null;
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      console.warn('[auth] Rejected token: missing sub');
      return null;
    }
    if (!payload.exp || payload.exp <= nowSec - 60) {
      console.warn('[auth] Rejected token: expired');
      return null;
    }
    if (payload.iat && payload.iat > nowSec + 600) {
      console.warn('[auth] Rejected token: issued in the future');
      return null;
    }

    const publicKey = await getFirebasePublicKey(header.kid);
    if (!publicKey) {
      console.warn('[auth] Rejected token: unknown signing key');
      return null;
    }

    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
    const signature = base64UrlDecodeToBuffer(encodedSig);
    const isValid = crypto.verify('RSA-SHA256', signingInput, publicKey, signature);
    if (!isValid) {
      console.warn('[auth] Rejected token: signature invalid');
      return null;
    }

    return { uid: payload.sub, email: payload.email };
  } catch (err) {
    console.warn('[auth] Token verification error:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function extractBearerToken(req: Pick<IncomingMessage, 'headers'>): string | null {
  const authHeader = req.headers.authorization;
  const headerStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerStr || typeof headerStr !== 'string') return null;
  const match = headerStr.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export interface VerifiedManagementCaller {
  workspaceId: string;
  authType: 'firebase' | 'session';
  uid?: string;
}

export async function verifyManagementCaller(
  req: Pick<IncomingMessage, 'headers'>
): Promise<VerifiedManagementCaller | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  if (token.startsWith('lvps_')) {
    const workspaceId = verifyAnonymousSession(token);
    if (!workspaceId) return null;
    return { workspaceId, authType: 'session' };
  }

  const fb = await verifyFirebaseIdToken(token);
  if (!fb) return null;
  return { workspaceId: `fb:${fb.uid}`, authType: 'firebase', uid: fb.uid };
}

export function verifyMcpAgentCaller(
  req: Pick<IncomingMessage, 'headers'>
): { workspaceId: string; tokenId: string; label: string } | null {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifyMcpApiToken(token);
}
