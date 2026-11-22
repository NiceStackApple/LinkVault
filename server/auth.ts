import crypto from 'crypto';
import type { Request } from 'express';
import { verifyAnonymousSession, verifyMcpApiToken } from './mcpStore';

const FIREBASE_PROJECT_ID = 'linkvaultpro';
const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface JwkKey {
  kid: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
}

let cachedJwks: { keys: Map<string, JwkKey>; expiresAt: number } | null = null;

async function getFirebasePublicKey(kid: string): Promise<crypto.KeyObject | null> {
  const now = Date.now();
  if (!cachedJwks || cachedJwks.expiresAt <= now || !cachedJwks.keys.has(kid)) {
    const res = await fetch(FIREBASE_JWKS_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch Firebase JWKS: ${res.status}`);
    }
    const cacheControl = res.headers.get('cache-control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
    const data = (await res.json()) as { keys?: JwkKey[] };
    const map = new Map<string, JwkKey>();
    for (const key of data.keys || []) {
      if (key.kid) map.set(key.kid, key);
    }
    cachedJwks = { keys: map, expiresAt: now + Math.min(ttlMs, 6 * 3600 * 1000) };
  }

  const jwk = cachedJwks.keys.get(kid);
  if (!jwk) return null;
  return crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
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
    if (header.alg !== 'RS256' || !header.kid) return null;

    const payload = JSON.parse(base64UrlDecodeToBuffer(encodedPayload).toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (!payload.sub || typeof payload.sub !== 'string') return null;
    if (!payload.exp || payload.exp <= nowSec) return null;
    if (payload.iat && payload.iat > nowSec + 300) return null;

    const publicKey = await getFirebasePublicKey(header.kid);
    if (!publicKey) return null;

    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
    const signature = base64UrlDecodeToBuffer(encodedSig);
    const isValid = crypto.verify('RSA-SHA256', signingInput, publicKey, signature);
    if (!isValid) return null;

    return { uid: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export interface VerifiedManagementCaller {
  workspaceId: string;
  authType: 'firebase' | 'session';
  uid?: string;
}

export async function verifyManagementCaller(req: Request): Promise<VerifiedManagementCaller | null> {
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

export function verifyMcpAgentCaller(req: Request): { workspaceId: string; tokenId: string; label: string } | null {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifyMcpApiToken(token);
}
