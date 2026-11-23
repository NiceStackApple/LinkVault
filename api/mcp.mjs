import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Self-contained Vercel Serverless MCP Server for LinkVault Pro (Pure Node ESM)
// Zero TypeScript transpilation, zero relative imports, zero native addons.
// ---------------------------------------------------------------------------

const FIREBASE_PROJECT_ID = 'linkvaultpro';
const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FIREBASE_X509_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const MCP_SERVER_INFO = { name: 'linkvaultpro-mcp', version: '1.0.0' };
const MCP_PROTOCOL_VERSION = '2025-03-26';

const DEFAULT_VAULT = { id: 'root', name: 'Root', folders: [], links: [] };

const MCP_TOOLS = [
  {
    name: 'list_folders',
    description:
      'List all folders in the user LinkVault Pro workspace, or direct subfolders under a specific parentFolderId.',
    inputSchema: {
      type: 'object',
      properties: {
        parentFolderId: {
          type: 'string',
          description: 'Optional folder ID to list direct children of. Omit to list the entire folder directory.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_folder',
    description: 'Get details, subfolders, links, and notes inside a specific folder by ID (use "root" for Root).',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID to inspect (default: "root").' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_vault',
    description: 'Search across all folders, saved links, and notes by keyword and optional content type.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword to search in folder names, link titles, URLs, or note contents.',
        },
        type: {
          type: 'string',
          enum: ['youtube', 'tiktok', 'instagram', 'general', 'note'],
          description: 'Optional item type filter.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_starred',
    description: 'List all starred (favorite) folders, links, and notes in the vault.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder inside a parent folder (defaults to "root").',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the new folder.' },
        parentFolderId: { type: 'string', description: 'ID of the parent folder (default: "root").' },
        color: { type: 'string', description: 'Optional hex color code such as "#6366f1".' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_link',
    description:
      'Save a new web link (automatically detects YouTube, TikTok, Instagram, or general web links) to a folder.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title for the saved link.' },
        url: { type: 'string', description: 'Full http:// or https:// URL to save.' },
        folderId: { type: 'string', description: 'Target folder ID (default: "root").' },
        starred: { type: 'boolean', description: 'Whether to mark this link as starred.' },
      },
      required: ['title', 'url'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_note',
    description: 'Create and save a text note inside a folder.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the note.' },
        content: { type: 'string', description: 'Full text content of the note.' },
        folderId: { type: 'string', description: 'Target folder ID (default: "root").' },
        starred: { type: 'boolean', description: 'Whether to mark this note as starred.' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_item',
    description: 'Update an existing link or note (title, URL, content, or starred status) by itemId.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: 'ID of the link or note to update.' },
        title: { type: 'string', description: 'Optional new title.' },
        url: { type: 'string', description: 'Optional new http:// or https:// URL (for links).' },
        content: { type: 'string', description: 'Optional new text content (for notes).' },
        starred: { type: 'boolean', description: 'Optional new starred status.' },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_item',
    description: 'Delete a saved link or note by its itemId.',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string', description: 'ID of the link or note to delete.' } },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_folder',
    description: 'Delete a folder and all nested subfolders/items inside it by folderId. Cannot delete "root".',
    inputSchema: {
      type: 'object',
      properties: { folderId: { type: 'string', description: 'ID of the folder to delete.' } },
      required: ['folderId'],
      additionalProperties: false,
    },
  },
];

const MCP_RESOURCES = [
  {
    uri: 'linkvault://tree',
    name: 'Full Vault Tree',
    description: 'Complete recursive JSON structure of all folders, links, and notes in LinkVault Pro.',
    mimeType: 'application/json',
  },
  {
    uri: 'linkvault://starred',
    name: 'Starred Items',
    description: 'All starred folders, links, and notes across the vault.',
    mimeType: 'application/json',
  },
  {
    uri: 'linkvault://summary',
    name: 'Vault Summary',
    description: 'High-level counts and directory overview of the vault.',
    mimeType: 'application/json',
  },
];

const MCP_PROMPTS = [
  {
    name: 'organize_vault',
    description: 'Analyze the user LinkVault Pro bookmarks and suggest a cleaner folder structure.',
    arguments: [],
  },
  {
    name: 'summarize_folder',
    description: 'Summarize all links and notes stored inside a specific LinkVault Pro folder.',
    arguments: [{ name: 'folderId', description: 'Target folder ID (default: root)', required: false }],
  },
];

// ---------------------------------------------------------------------------
// Crypto & Utility Helpers
// ---------------------------------------------------------------------------

function hashSecret(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateId(prefix = '') {
  const rand = crypto.randomBytes(6).toString('hex');
  return prefix ? `${prefix}_${Date.now()}_${rand}` : `${Date.now().toString(36)}${rand}`;
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeToBuffer(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function sanitizeHttpUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) throw new Error('URL is required');
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL format. Include http:// or https://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are allowed');
  }
  return parsed.toString();
}

function detectLinkType(url) {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('instagram.com')) return 'instagram';
  return 'general';
}

function extractYoutubeThumbnail(url) {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : null;
}

function validateVaultStructure(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid vault payload');
  if (typeof input.id !== 'string' || typeof input.name !== 'string') {
    throw new Error('Vault root must have string id and name');
  }
  if (!Array.isArray(input.folders) || !Array.isArray(input.links)) {
    throw new Error('Vault root must have folders and links arrays');
  }
  return input;
}

// ---------------------------------------------------------------------------
// Optional Firestore REST Persistence (via FIREBASE_SERVICE_ACCOUNT_JSON)
// with zero-config /tmp JSON file fallback for Vercel
// ---------------------------------------------------------------------------

let cachedServiceAccount;
let cachedGoogleAccessToken = null;

function getServiceAccount() {
  if (cachedServiceAccount !== undefined) return cachedServiceAccount;
  let raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    cachedServiceAccount = null;
    return null;
  }
  // Handle accidental outer quotes from env editors
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    try {
      const unwrapped = JSON.parse(raw);
      if (typeof unwrapped === 'string') raw = unwrapped.trim();
    } catch {
      raw = raw.slice(1, -1).trim();
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.project_id && parsed.client_email && parsed.private_key) {
      cachedServiceAccount = {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
      };
      return cachedServiceAccount;
    }
  } catch (err) {
    console.warn('[api/mcp] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', err instanceof Error ? err.message : err);
  }
  cachedServiceAccount = null;
  return null;
}

async function getGoogleAccessToken(sa) {
  const now = Date.now();
  if (cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAt > now + 60_000) {
    return cachedGoogleAccessToken.token;
  }
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp,
    })
  );
  const signingInput = `${header}.${claim}`;
  const signature = base64UrlEncode(crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Failed to obtain Firestore access token (${tokenRes.status})`);
  }
  const data = await tokenRes.json();
  cachedGoogleAccessToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return data.access_token;
}

function firestoreDocUrl(sa, collection, docId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    sa.project_id
  )}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`;
}

async function fsGetJsonDoc(sa, collection, docId) {
  const token = await getGoogleAccessToken(sa);
  const res = await fetch(firestoreDocUrl(sa, collection, docId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore read failed (${res.status})`);
  const doc = await res.json();
  const raw = doc?.fields?.payload?.stringValue;
  return raw ? JSON.parse(raw) : null;
}

async function fsSetJsonDoc(sa, collection, docId, value) {
  const token = await getGoogleAccessToken(sa);
  const res = await fetch(firestoreDocUrl(sa, collection, docId), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        payload: { stringValue: JSON.stringify(value) },
        updatedAt: { integerValue: String(Date.now()) },
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore write failed (${res.status})`);
}

async function fsDeleteDoc(sa, collection, docId) {
  const token = await getGoogleAccessToken(sa);
  const res = await fetch(firestoreDocUrl(sa, collection, docId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Firestore delete failed (${res.status})`);
  }
}

// Local /tmp fallback store
const TMP_DIR = path.join(os.tmpdir(), 'linkvault-mcp');
const TMP_STORE_FILE = path.join(TMP_DIR, 'store.json');

function readTmpStore() {
  try {
    if (fs.existsSync(TMP_STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TMP_STORE_FILE, 'utf8'));
      return {
        workspaces: parsed.workspaces || {},
        tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        sessions: parsed.sessions || {},
        activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      };
    }
  } catch {
    // ignore corrupt temp file
  }
  return { workspaces: {}, tokens: [], sessions: {}, activity: [] };
}

function writeTmpStore(data) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmpFile = `${TMP_STORE_FILE}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf8');
  fs.renameSync(tmpFile, TMP_STORE_FILE);
}

function safeDocId(workspaceId) {
  return String(workspaceId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function hashVault(vault) {
  return crypto.createHash('sha256').update(JSON.stringify(vault ?? DEFAULT_VAULT)).digest('hex');
}

function makeActivityEntry(toolName, summary, status = 'ok') {
  return {
    id: generateId('act'),
    toolName: String(toolName).slice(0, 64),
    summary: String(summary).slice(0, 240),
    status,
    createdAt: Date.now(),
  };
}

async function getWorkspaceBundle(workspaceId, options = {}) {
  const sa = getServiceAccount();
  if (sa) {
    const existing = await fsGetJsonDoc(sa, 'mcpWorkspaces', safeDocId(workspaceId));
    if (existing) return existing;
    const initial = {
      workspace: { vault: structuredClone(DEFAULT_VAULT), version: 1, updatedAt: 0 },
      tokens: [],
      activity: [],
    };
    if (options.createIfMissing) {
      initial.workspace.updatedAt = Date.now();
      await fsSetJsonDoc(sa, 'mcpWorkspaces', safeDocId(workspaceId), initial);
    }
    return initial;
  }

  const store = readTmpStore();
  let ws = store.workspaces[workspaceId];
  if (!ws) {
    ws = { vault: structuredClone(DEFAULT_VAULT), version: 1, updatedAt: Date.now() };
    if (options.createIfMissing) {
      store.workspaces[workspaceId] = ws;
      writeTmpStore(store);
    }
  }
  return {
    workspace: ws,
    tokens: store.tokens
      .filter((t) => t.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, label, tokenPrefix, createdAt, lastUsedAt }) => ({
        id,
        label,
        tokenPrefix,
        createdAt,
        lastUsedAt,
      })),
    activity: store.activity
      .filter((a) => a.workspaceId === workspaceId)
      .slice(0, 20)
      .map(({ id, toolName, summary, status, createdAt }) => ({
        id,
        toolName,
        summary,
        status,
        createdAt,
      })),
  };
}

async function saveVaultData(workspaceId, vault, options = {}) {
  const now = Date.now();
  const incomingHash = hashVault(vault);
  const sa = getServiceAccount();
  if (sa) {
    const bundle = options.bundle || (await getWorkspaceBundle(workspaceId));
    const currentHash = hashVault(bundle.workspace.vault);

    // Never burn a Firestore write or bump version if vault content is identical
    if (currentHash === incomingHash && bundle.workspace.updatedAt > 0 && !options.activityEntry) {
      return {
        version: bundle.workspace.version,
        updatedAt: bundle.workspace.updatedAt,
        conflict: false,
        unchanged: true,
      };
    }

    if (
      !options.force &&
      typeof options.expectedVersion === 'number' &&
      options.expectedVersion !== bundle.workspace.version
    ) {
      return {
        version: bundle.workspace.version,
        updatedAt: bundle.workspace.updatedAt,
        conflict: true,
        latestVault: bundle.workspace.vault,
      };
    }
    const nextVersion = currentHash === incomingHash && bundle.workspace.updatedAt > 0
      ? bundle.workspace.version
      : bundle.workspace.version + 1;
    bundle.workspace = { vault, version: nextVersion, updatedAt: now };
    if (options.activityEntry) {
      bundle.activity = [options.activityEntry, ...(bundle.activity || [])].slice(0, 50);
    }
    await fsSetJsonDoc(sa, 'mcpWorkspaces', safeDocId(workspaceId), bundle);
    return { version: nextVersion, updatedAt: now, conflict: false, unchanged: false };
  }

  const store = readTmpStore();
  const existing = store.workspaces[workspaceId];
  if (!existing) {
    store.workspaces[workspaceId] = { vault, version: 1, updatedAt: now };
    if (options.activityEntry) {
      store.activity.unshift({ ...options.activityEntry, workspaceId });
    }
    writeTmpStore(store);
    return { version: 1, updatedAt: now, conflict: false, unchanged: false };
  }
  const existingHash = hashVault(existing.vault);
  if (existingHash === incomingHash && !options.activityEntry) {
    return { version: existing.version, updatedAt: existing.updatedAt, conflict: false, unchanged: true };
  }
  if (
    !options.force &&
    typeof options.expectedVersion === 'number' &&
    options.expectedVersion !== existing.version
  ) {
    return { version: existing.version, updatedAt: existing.updatedAt, conflict: true, latestVault: existing.vault };
  }
  const nextVersion = existingHash === incomingHash ? existing.version : existing.version + 1;
  store.workspaces[workspaceId] = { vault, version: nextVersion, updatedAt: now };
  if (options.activityEntry) {
    store.activity.unshift({ ...options.activityEntry, workspaceId });
    let count = 0;
    store.activity = store.activity.filter((row) => {
      if (row.workspaceId !== workspaceId) return true;
      count++;
      return count <= 50;
    });
  }
  writeTmpStore(store);
  return { version: nextVersion, updatedAt: now, conflict: false, unchanged: false };
}

async function createTokenRecord(workspaceId, label) {
  const cleanLabel = String(label || '').trim().slice(0, 64) || 'AI Agent';
  const rawToken = `lvp_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashSecret(rawToken);
  const tokenPrefix = `${rawToken.slice(0, 12)}...${rawToken.slice(-4)}`;
  const id = generateId('tok');
  const now = Date.now();
  const record = { id, label: cleanLabel, tokenPrefix, createdAt: now, lastUsedAt: null };

  const sa = getServiceAccount();
  if (sa) {
    const bundle = await getWorkspaceBundle(workspaceId);
    bundle.tokens = [record, ...bundle.tokens];
    await Promise.all([
      fsSetJsonDoc(sa, 'mcpWorkspaces', safeDocId(workspaceId), bundle),
      fsSetJsonDoc(sa, 'mcpTokens', tokenHash, {
        id,
        workspaceId,
        label: cleanLabel,
        tokenHash,
        tokenPrefix,
        createdAt: now,
        lastUsedAt: null,
      }),
    ]);
    return { token: rawToken, record };
  }

  const store = readTmpStore();
  store.tokens.unshift({
    id,
    workspaceId,
    label: cleanLabel,
    tokenHash,
    tokenPrefix,
    createdAt: now,
    lastUsedAt: null,
  });
  writeTmpStore(store);
  return { token: rawToken, record };
}

async function revokeTokenRecord(workspaceId, tokenId) {
  const sa = getServiceAccount();
  if (sa) {
    const bundle = await getWorkspaceBundle(workspaceId);
    const exists = bundle.tokens.some((t) => t.id === tokenId);
    if (!exists) return false;
    bundle.tokens = bundle.tokens.filter((t) => t.id !== tokenId);
    await fsSetJsonDoc(sa, 'mcpWorkspaces', safeDocId(workspaceId), bundle);
    return true;
  }

  const store = readTmpStore();
  const before = store.tokens.length;
  store.tokens = store.tokens.filter((t) => !(t.id === tokenId && t.workspaceId === workspaceId));
  if (store.tokens.length !== before) {
    writeTmpStore(store);
    return true;
  }
  return false;
}

async function verifyMcpApiToken(rawToken) {
  if (!rawToken || !rawToken.startsWith('lvp_')) return null;
  const candidateHash = hashSecret(rawToken);
  const a = Buffer.from(candidateHash, 'hex');

  const sa = getServiceAccount();
  if (sa) {
    const row = await fsGetJsonDoc(sa, 'mcpTokens', candidateHash);
    if (!row) return null;
    const b = Buffer.from(row.tokenHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const bundle = await getWorkspaceBundle(row.workspaceId);
    const activeToken = bundle.tokens.find((t) => t.id === row.id);
    if (!activeToken) {
      await fsDeleteDoc(sa, 'mcpTokens', candidateHash).catch(() => {});
      return null;
    }
    const now = Date.now();
    // Throttle lastUsedAt persistence to at most once every 15 minutes to avoid burning Firestore writes on every call
    if (!activeToken.lastUsedAt || now - activeToken.lastUsedAt > 15 * 60 * 1000) {
      activeToken.lastUsedAt = now;
      await fsSetJsonDoc(sa, 'mcpWorkspaces', safeDocId(row.workspaceId), bundle).catch(() => {});
    }
    return { workspaceId: row.workspaceId, tokenId: row.id, label: row.label };
  }

  const store = readTmpStore();
  const row = store.tokens.find((t) => {
    const b = Buffer.from(t.tokenHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!row) return null;
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt > 15 * 60 * 1000) {
    row.lastUsedAt = now;
    writeTmpStore(store);
  }
  return { workspaceId: row.workspaceId, tokenId: row.id, label: row.label };
}

async function createAnonymousSession() {
  const workspaceId = `anon:${crypto.randomBytes(16).toString('hex')}`;
  const sessionToken = `lvps_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashSecret(sessionToken);
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

  const sa = getServiceAccount();
  if (sa) {
    await fsSetJsonDoc(sa, 'mcpSessions', tokenHash, { tokenHash, workspaceId, createdAt: now, expiresAt });
    return { sessionToken, workspaceId };
  }

  const store = readTmpStore();
  store.sessions[tokenHash] = { tokenHash, workspaceId, createdAt: now, expiresAt };
  writeTmpStore(store);
  return { sessionToken, workspaceId };
}

async function verifyAnonymousSession(sessionToken) {
  if (!sessionToken || !sessionToken.startsWith('lvps_')) return null;
  const candidateHash = hashSecret(sessionToken);

  const sa = getServiceAccount();
  if (sa) {
    const row = await fsGetJsonDoc(sa, 'mcpSessions', candidateHash);
    if (!row) return null;
    if (row.expiresAt < Date.now()) {
      await fsDeleteDoc(sa, 'mcpSessions', candidateHash).catch(() => {});
      return null;
    }
    return row.workspaceId;
  }

  const store = readTmpStore();
  const row = store.sessions[candidateHash];
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    delete store.sessions[candidateHash];
    writeTmpStore(store);
    return null;
  }
  return row.workspaceId;
}

async function recordActivity(workspaceId, toolName, summary, status = 'ok') {
  const entry = {
    id: generateId('act'),
    toolName: String(toolName).slice(0, 64),
    summary: String(summary).slice(0, 240),
    status,
    createdAt: Date.now(),
  };

  const sa = getServiceAccount();
  if (sa) {
    const bundle = await getWorkspaceBundle(workspaceId);
    bundle.activity = [entry, ...bundle.activity].slice(0, 50);
    await fsSetJsonDoc(sa, 'mcpWorkspaces', safeDocId(workspaceId), bundle);
    return;
  }

  const store = readTmpStore();
  store.activity.unshift({ ...entry, workspaceId });
  let count = 0;
  store.activity = store.activity.filter((row) => {
    if (row.workspaceId !== workspaceId) return true;
    count++;
    return count <= 50;
  });
  writeTmpStore(store);
}

// ---------------------------------------------------------------------------
// Firebase ID Token Cryptographic Verification
// ---------------------------------------------------------------------------

let cachedKeys = null;

async function getFirebasePublicKey(kid) {
  const now = Date.now();
  if (!cachedKeys || cachedKeys.expiresAt <= now || !cachedKeys.keys.has(kid)) {
    let keysMap = null;
    let ttlMs = 3600 * 1000;

    try {
      const res = await fetch(FIREBASE_JWKS_URL);
      if (res.ok) {
        const cc = res.headers.get('cache-control') || '';
        const match = cc.match(/max-age=(\d+)/);
        if (match) ttlMs = Number(match[1]) * 1000;
        const data = await res.json();
        const map = new Map();
        for (const k of data.keys || []) {
          if (k.kid) {
            map.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' }));
          }
        }
        if (map.size > 0) keysMap = map;
      }
    } catch {
      // fall through to x509
    }

    if (!keysMap) {
      const certRes = await fetch(FIREBASE_X509_URL);
      if (!certRes.ok) throw new Error(`Failed to fetch Firebase public certs (${certRes.status})`);
      const cc = certRes.headers.get('cache-control') || '';
      const match = cc.match(/max-age=(\d+)/);
      if (match) ttlMs = Number(match[1]) * 1000;
      const certs = await certRes.json();
      keysMap = new Map();
      for (const [k, pem] of Object.entries(certs)) {
        keysMap.set(k, crypto.createPublicKey(pem));
      }
    }

    cachedKeys = { keys: keysMap, expiresAt: now + Math.min(ttlMs, 6 * 3600 * 1000) };
  }
  return cachedKeys.keys.get(kid) || null;
}

async function verifyFirebaseIdToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSig] = parts;
    const header = JSON.parse(base64UrlDecodeToBuffer(encodedHeader).toString('utf8'));
    if (header.alg !== 'RS256' || !header.kid) return null;

    const payload = JSON.parse(base64UrlDecodeToBuffer(encodedPayload).toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (!payload.sub || typeof payload.sub !== 'string') return null;
    if (!payload.exp || payload.exp <= nowSec - 60) return null;
    if (payload.iat && payload.iat > nowSec + 600) return null;

    const pubKey = await getFirebasePublicKey(header.kid);
    if (!pubKey) return null;

    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
      pubKey,
      base64UrlDecodeToBuffer(encodedSig)
    );
    return ok ? { uid: payload.sub, email: payload.email } : null;
  } catch {
    return null;
  }
}

function extractBearerToken(req) {
  const raw = req.headers?.authorization;
  const headerStr = Array.isArray(raw) ? raw[0] : raw;
  if (!headerStr) return null;
  const m = headerStr.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function verifyManagementCaller(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  if (token.startsWith('lvps_')) {
    const ws = await verifyAnonymousSession(token);
    return ws ? { workspaceId: ws, authType: 'session' } : null;
  }
  const fb = await verifyFirebaseIdToken(token);
  return fb ? { workspaceId: `fb:${fb.uid}`, authType: 'firebase' } : null;
}

// ---------------------------------------------------------------------------
// Vault Tree Helpers & MCP JSON-RPC 2.0 Handler
// ---------------------------------------------------------------------------

function findFolderById(root, id) {
  if (root.id === id) return root;
  for (const sub of root.folders) {
    const found = findFolderById(sub, id);
    if (found) return found;
  }
  return null;
}

function getFolderPath(root, targetId) {
  if (root.id === targetId) return [root.name];
  for (const sub of root.folders) {
    const p = getFolderPath(sub, targetId);
    if (p) return [root.name, ...p];
  }
  return null;
}

function flattenFolders(root, parentPath = '') {
  const currentPath = parentPath ? `${parentPath}/${root.name}` : root.name;
  const list = [
    {
      id: root.id,
      name: root.name,
      path: currentPath,
      folderCount: root.folders.length,
      itemCount: root.links.length,
      starred: Boolean(root.starred),
      isPublic: Boolean(root.isPublic),
      color: root.color || null,
    },
  ];
  for (const sub of root.folders) list.push(...flattenFolders(sub, currentPath));
  return list;
}

function searchVaultTree(root, queryStr, typeFilter) {
  const q = queryStr.trim().toLowerCase();
  const folders = [];
  const items = [];
  const walk = (folder, curPath) => {
    const folderPath = curPath ? `${curPath}/${folder.name}` : folder.name;
    if (folder.id !== 'root' && !typeFilter && (!q || folder.name.toLowerCase().includes(q))) {
      folders.push({ id: folder.id, name: folder.name, path: folderPath, starred: Boolean(folder.starred) });
    }
    for (const link of folder.links) {
      if (typeFilter && link.type !== typeFilter) continue;
      const hay = `${link.title || ''} ${link.url || ''} ${link.content || ''}`.toLowerCase();
      if (!q || hay.includes(q)) items.push({ ...link, folderId: folder.id, folderPath });
    }
    for (const sub of folder.folders) walk(sub, folderPath);
  };
  walk(root, '');
  return { folders, items };
}

function collectStarred(root) {
  const folders = [];
  const items = [];
  const walk = (folder, curPath) => {
    const folderPath = curPath ? `${curPath}/${folder.name}` : folder.name;
    if (folder.id !== 'root' && folder.starred) folders.push({ id: folder.id, name: folder.name, path: folderPath });
    for (const link of folder.links) {
      if (link.starred) items.push({ ...link, folderId: folder.id, folderPath });
    }
    for (const sub of folder.folders) walk(sub, folderPath);
  };
  walk(root, '');
  return { folders, items };
}

function deleteFolderFromTree(root, folderId) {
  let deleted = false;
  const walk = (folder) => {
    const filtered = folder.folders.filter((sub) => sub.id !== folderId);
    if (filtered.length !== folder.folders.length) deleted = true;
    return { ...folder, folders: filtered.map(walk) };
  };
  return { tree: walk(root), deleted };
}

function deleteItemFromTree(root, itemId) {
  let deleted = false;
  const walk = (folder) => {
    const filtered = folder.links.filter((l) => l.id !== itemId);
    if (filtered.length !== folder.links.length) deleted = true;
    return { ...folder, links: filtered, folders: folder.folders.map(walk) };
  };
  return { tree: walk(root), deleted };
}

function updateItemInTree(root, itemId, patch) {
  let updated = null;
  const walk = (folder) => ({
    ...folder,
    links: folder.links.map((link) => {
      if (link.id !== itemId) return link;
      const next = { ...link, ...patch };
      updated = next;
      return next;
    }),
    folders: folder.folders.map(walk),
  });
  return { tree: walk(root), updated };
}

function toolResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    isError,
  };
}

async function executeTool(workspaceId, name, args) {
  const bundle = await getWorkspaceBundle(workspaceId);
  const vault = bundle.workspace.vault;

  switch (name) {
    case 'list_folders': {
      const parentId = typeof args.parentFolderId === 'string' ? args.parentFolderId.trim() : '';
      if (parentId) {
        const parent = findFolderById(vault, parentId);
        if (!parent) {
          return toolResult({ error: `Folder "${parentId}" not found` }, true);
        }
        const children = parent.folders.map((f) => ({
          id: f.id,
          name: f.name,
          folderCount: f.folders.length,
          itemCount: f.links.length,
          starred: Boolean(f.starred),
          color: f.color || null,
        }));
        return toolResult({ parentId: parent.id, parentName: parent.name, folders: children });
      }
      const all = flattenFolders(vault);
      return toolResult({ total: all.length, folders: all });
    }
    case 'get_folder': {
      const folderId = typeof args.folderId === 'string' && args.folderId.trim() ? args.folderId.trim() : 'root';
      const folder = findFolderById(vault, folderId);
      if (!folder) {
        return toolResult({ error: `Folder "${folderId}" not found` }, true);
      }
      const pathParts = getFolderPath(vault, folder.id) || [folder.name];
      return toolResult({
        id: folder.id,
        name: folder.name,
        path: pathParts.join('/'),
        starred: Boolean(folder.starred),
        color: folder.color || null,
        isPublic: Boolean(folder.isPublic),
        subfolders: folder.folders.map((sub) => ({
          id: sub.id,
          name: sub.name,
          folderCount: sub.folders.length,
          itemCount: sub.links.length,
          starred: Boolean(sub.starred),
        })),
        items: folder.links,
      });
    }
    case 'search_vault': {
      const queryStr = typeof args.query === 'string' ? args.query.trim() : '';
      if (!queryStr) return toolResult({ error: 'query is required and must be a non-empty string' }, true);
      const validTypes = ['youtube', 'tiktok', 'instagram', 'general', 'note'];
      const typeFilter = typeof args.type === 'string' && validTypes.includes(args.type) ? args.type : undefined;
      const results = searchVaultTree(vault, queryStr, typeFilter);
      return toolResult({
        query: queryStr,
        typeFilter: typeFilter || null,
        folderMatches: results.folders,
        itemMatches: results.items,
      });
    }
    case 'list_starred': {
      const starred = collectStarred(vault);
      return toolResult(starred);
    }
    case 'create_folder': {
      const folderName = typeof args.name === 'string' ? args.name.trim().slice(0, 120) : '';
      if (!folderName) return toolResult({ error: 'Folder name is required' }, true);
      const parentId =
        typeof args.parentFolderId === 'string' && args.parentFolderId.trim() ? args.parentFolderId.trim() : 'root';
      const parent = findFolderById(vault, parentId);
      if (!parent) {
        return toolResult({ error: `Parent folder "${parentId}" not found` }, true);
      }
      const color =
        typeof args.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(args.color.trim()) ? args.color.trim() : undefined;
      const newFolder = {
        id: generateId('folder'),
        name: folderName,
        folders: [],
        links: [],
        createdAt: Date.now(),
        ...(color ? { color } : {}),
      };
      parent.folders.push(newFolder);
      const saved = await saveVaultData(workspaceId, vault, {
        force: true,
        bundle,
        activityEntry: makeActivityEntry(name, `Created folder "${folderName}" in "${parent.name}"`),
      });
      return toolResult({ created: true, folder: newFolder, parentId: parent.id, vaultVersion: saved.version });
    }
    case 'add_link': {
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 200) : '';
      const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
      if (!title || !rawUrl) return toolResult({ error: 'Both title and url are required' }, true);
      let safeUrl;
      try {
        safeUrl = sanitizeHttpUrl(rawUrl);
      } catch (err) {
        return toolResult({ error: err instanceof Error ? err.message : 'Invalid URL' }, true);
      }
      const folderId = typeof args.folderId === 'string' && args.folderId.trim() ? args.folderId.trim() : 'root';
      const target = findFolderById(vault, folderId);
      if (!target) {
        return toolResult({ error: `Folder "${folderId}" not found` }, true);
      }
      const linkType = detectLinkType(safeUrl);
      const newLink = {
        id: generateId('item'),
        title,
        url: safeUrl,
        type: linkType,
        dateAdded: Date.now(),
        starred: Boolean(args.starred),
        previewImage: linkType === 'youtube' ? extractYoutubeThumbnail(safeUrl) : null,
      };
      target.links.push(newLink);
      const saved = await saveVaultData(workspaceId, vault, {
        force: true,
        bundle,
        activityEntry: makeActivityEntry(name, `Added link "${title}" to "${target.name}"`),
      });
      return toolResult({ created: true, item: newLink, folderId: target.id, vaultVersion: saved.version });
    }
    case 'add_note': {
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 200) : '';
      const content = typeof args.content === 'string' ? args.content.slice(0, 20000) : '';
      if (!title || !content.trim()) return toolResult({ error: 'Both title and content are required' }, true);
      const folderId = typeof args.folderId === 'string' && args.folderId.trim() ? args.folderId.trim() : 'root';
      const target = findFolderById(vault, folderId);
      if (!target) {
        return toolResult({ error: `Folder "${folderId}" not found` }, true);
      }
      const newNote = {
        id: generateId('note'),
        title,
        url: '',
        content,
        type: 'note',
        dateAdded: Date.now(),
        starred: Boolean(args.starred),
      };
      target.links.push(newNote);
      const saved = await saveVaultData(workspaceId, vault, {
        force: true,
        bundle,
        activityEntry: makeActivityEntry(name, `Added note "${title}" to "${target.name}"`),
      });
      return toolResult({ created: true, item: newNote, folderId: target.id, vaultVersion: saved.version });
    }
    case 'update_item': {
      const itemId = typeof args.itemId === 'string' ? args.itemId.trim() : '';
      if (!itemId) return toolResult({ error: 'itemId is required' }, true);
      const patch = {};
      if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim().slice(0, 200);
      if (typeof args.url === 'string' && args.url.trim()) {
        try {
          const safeUrl = sanitizeHttpUrl(args.url);
          patch.url = safeUrl;
          patch.type = detectLinkType(safeUrl);
          if (patch.type === 'youtube') patch.previewImage = extractYoutubeThumbnail(safeUrl);
        } catch (err) {
          return toolResult({ error: err instanceof Error ? err.message : 'Invalid URL' }, true);
        }
      }
      if (typeof args.content === 'string') patch.content = args.content.slice(0, 20000);
      if (typeof args.starred === 'boolean') patch.starred = args.starred;
      const { tree, updated } = updateItemInTree(vault, itemId, patch);
      if (!updated) {
        return toolResult({ error: `Item "${itemId}" not found` }, true);
      }
      const saved = await saveVaultData(workspaceId, tree, {
        force: true,
        bundle,
        activityEntry: makeActivityEntry(name, `Updated item "${updated.title}"`),
      });
      return toolResult({ updated: true, item: updated, vaultVersion: saved.version });
    }
    case 'delete_item': {
      const itemId = typeof args.itemId === 'string' ? args.itemId.trim() : '';
      if (!itemId) return toolResult({ error: 'itemId is required' }, true);
      const { tree, deleted } = deleteItemFromTree(vault, itemId);
      if (!deleted) {
        return toolResult({ error: `Item "${itemId}" not found` }, true);
      }
      const saved = await saveVaultData(workspaceId, tree, {
        force: true,
        bundle,
        activityEntry: makeActivityEntry(name, `Deleted item ${itemId}`),
      });
      return toolResult({ deleted: true, itemId, vaultVersion: saved.version });
    }
    case 'delete_folder': {
      const folderId = typeof args.folderId === 'string' ? args.folderId.trim() : '';
      if (!folderId || folderId === 'root') return toolResult({ error: 'A non-root folderId is required' }, true);
      const { tree, deleted } = deleteFolderFromTree(vault, folderId);
      if (!deleted) {
        return toolResult({ error: `Folder "${folderId}" not found` }, true);
      }
      const saved = await saveVaultData(workspaceId, tree, {
        force: true,
        bundle,
        activityEntry: makeActivityEntry(name, `Deleted folder ${folderId}`),
      });
      return toolResult({ deleted: true, folderId, vaultVersion: saved.version });
    }
    default:
      return toolResult({ error: `Unknown tool: ${name}` }, true);
  }
}

async function handleMcpMessage(workspaceId, msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: msg?.id ?? null,
      error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
    };
  }
  const isNotification = msg.id === undefined;
  const id = msg.id ?? null;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};

  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') {
    return null;
  }

  switch (msg.method) {
    case 'initialize': {
      const reqVer = typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION;
      const protocolVersion = ['2025-03-26', '2024-11-05'].includes(reqVer) ? reqVer : MCP_PROTOCOL_VERSION;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: MCP_SERVER_INFO,
          instructions:
            'LinkVault Pro MCP Server gives AI agents read and write access to the user bookmarks, folders, and notes.',
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
    case 'tools/call': {
      const toolName = typeof params.name === 'string' ? params.name : '';
      const toolArgs = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      if (!toolName || !MCP_TOOLS.some((t) => t.name === toolName)) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${toolName}` } };
      }
      const result = await executeTool(workspaceId, toolName, toolArgs);
      return { jsonrpc: '2.0', id, result };
    }
    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: MCP_RESOURCES } };
    case 'resources/read': {
      const uri = typeof params.uri === 'string' ? params.uri : '';
      const { workspace } = await getWorkspaceBundle(workspaceId);
      if (uri === 'linkvault://tree') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(
                  { version: workspace.version, updatedAt: workspace.updatedAt, root: workspace.vault },
                  null,
                  2
                ),
              },
            ],
          },
        };
      }
      if (uri === 'linkvault://starred') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(collectStarred(workspace.vault), null, 2) },
            ],
          },
        };
      }
      if (uri === 'linkvault://summary') {
        const folders = flattenFolders(workspace.vault);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(
                  {
                    version: workspace.version,
                    updatedAt: workspace.updatedAt,
                    totalFolders: Math.max(0, folders.length - 1),
                    totalItems: folders.reduce((s, f) => s + f.itemCount, 0),
                    directories: folders,
                  },
                  null,
                  2
                ),
              },
            ],
          },
        };
      }
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown resource URI: ${uri}` } };
    }
    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: MCP_PROMPTS } };
    case 'prompts/get': {
      const promptName = typeof params.name === 'string' ? params.name : '';
      const promptArgs = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const { workspace } = await getWorkspaceBundle(workspaceId);
      if (promptName === 'organize_vault') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Analyze and organize LinkVault Pro folders and bookmarks',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Please review my LinkVault Pro directory structure and suggest improvements:\n\n${JSON.stringify(
                    flattenFolders(workspace.vault),
                    null,
                    2
                  )}`,
                },
              },
            ],
          },
        };
      }
      if (promptName === 'summarize_folder') {
        const folderId = promptArgs.folderId || 'root';
        const folder = findFolderById(workspace.vault, folderId);
        if (!folder) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Folder "${folderId}" not found` } };
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: `Summarize contents of folder "${folder.name}"`,
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Summarize the links and notes in my LinkVault Pro folder "${folder.name}":\n\n${JSON.stringify(
                    folder.links,
                    null,
                    2
                  )}`,
                },
              },
            ],
          },
        };
      }
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown prompt: ${promptName}` } };
    }
    default:
      if (isNotification) return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

// ---------------------------------------------------------------------------
// HTTP Request / Response Handler
// ---------------------------------------------------------------------------

async function readJsonBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function resolveSubpath(req) {
  const parsedUrl = new URL(req.url || '/api/mcp', 'http://localhost');
  const queryPath = parsedUrl.searchParams.get('__path');
  if (queryPath !== null) {
    const cleaned = queryPath.replace(/^\/+/, '');
    return cleaned ? `/${cleaned}` : '';
  }
  const stripped = parsedUrl.pathname.replace(/^\/api\/mcp/, '').replace(/^\/mcp/, '');
  return !stripped || stripped === '/' ? '' : stripped;
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const subpath = resolveSubpath(req);

  try {
    if (method === 'GET' && subpath === '/info') {
      const protocol = req.headers?.['x-forwarded-proto'] || 'https';
      const host = req.headers?.['x-forwarded-host'] || req.headers?.host || '';
      const baseUrl = host ? `${protocol}://${host}` : '';
      sendJson(res, 200, {
        server: MCP_SERVER_INFO,
        protocolVersion: MCP_PROTOCOL_VERSION,
        transport: 'streamable-http',
        endpoint: `${baseUrl}/api/mcp`,
        storageMode: getServiceAccount() ? 'firestore' : 'ephemeral-tmp',
        authentication: { type: 'bearer', header: 'Authorization: Bearer <your-lvp-token>' },
        tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
        resources: MCP_RESOURCES,
        prompts: MCP_PROMPTS,
      });
      return;
    }

    if (subpath === '') {
      if (method === 'GET') {
        res.setHeader('Allow', 'POST, DELETE');
        sendJson(res, 405, {
          error: 'Method Not Allowed. Send JSON-RPC 2.0 requests via POST with Authorization: Bearer <token>.',
        });
        return;
      }
      if (method === 'DELETE') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (method === 'POST') {
        const rawToken = extractBearerToken(req);
        const caller = rawToken ? await verifyMcpApiToken(rawToken) : null;
        if (!caller) {
          sendJson(res, 401, {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32001,
              message: 'Unauthorized: provide a valid LinkVault Pro MCP token via Authorization: Bearer lvp_...',
            },
          });
          return;
        }
        const body = await readJsonBody(req);
        if (Array.isArray(body)) {
          if (body.length === 0) {
            sendJson(res, 400, {
              jsonrpc: '2.0',
              id: null,
              error: { code: -32600, message: 'Empty JSON-RPC batch' },
            });
            return;
          }
          const responses = (await Promise.all(body.map((msg) => handleMcpMessage(caller.workspaceId, msg)))).filter(
            (r) => r !== null
          );
          if (responses.length === 0) {
            res.statusCode = 202;
            res.end();
            return;
          }
          sendJson(res, 200, responses);
          return;
        }
        const response = await handleMcpMessage(caller.workspaceId, body);
        if (response === null) {
          res.statusCode = 202;
          res.end();
          return;
        }
        sendJson(res, 200, response);
        return;
      }
    }

    if (method === 'POST' && subpath === '/workspace/session') {
      const session = await createAnonymousSession();
      sendJson(res, 201, session);
      return;
    }

    const caller = await verifyManagementCaller(req);
    if (!caller) {
      sendJson(res, 401, { error: 'Unauthorized: sign in again or refresh session.' });
      return;
    }

    if (method === 'GET' && subpath === '/tokens') {
      const bundle = await getWorkspaceBundle(caller.workspaceId);
      sendJson(res, 200, {
        tokens: bundle.tokens,
        version: bundle.workspace.version,
        updatedAt: bundle.workspace.updatedAt,
        activity: bundle.activity,
        authType: caller.authType,
        storageMode: getServiceAccount() ? 'firestore' : 'ephemeral-tmp',
      });
      return;
    }

    if (method === 'POST' && subpath === '/tokens') {
      const body = await readJsonBody(req);
      const label = typeof body?.label === 'string' ? body.label : 'AI Agent';
      const created = await createTokenRecord(caller.workspaceId, label);
      sendJson(res, 201, created);
      return;
    }

    if (method === 'DELETE' && subpath.startsWith('/tokens/')) {
      const tokenId = decodeURIComponent(subpath.slice('/tokens/'.length));
      const revoked = await revokeTokenRecord(caller.workspaceId, tokenId);
      if (!revoked) {
        sendJson(res, 404, { error: 'Token not found' });
        return;
      }
      sendJson(res, 200, { revoked: true });
      return;
    }

    if (method === 'POST' && subpath === '/sync') {
      const body = await readJsonBody(req);
      try {
        const vault = validateVaultStructure(body?.vault);
        const expectedVersion = typeof body?.expectedVersion === 'number' ? body.expectedVersion : undefined;
        const force = Boolean(body?.force);
        const saved = await saveVaultData(caller.workspaceId, vault, { expectedVersion, force });
        if (saved.conflict) {
          sendJson(res, 409, {
            conflict: true,
            vault: saved.latestVault,
            version: saved.version,
            updatedAt: saved.updatedAt,
          });
          return;
        }
        sendJson(res, 200, { version: saved.version, updatedAt: saved.updatedAt });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'Invalid vault payload' });
      }
      return;
    }

    if (method === 'GET' && subpath === '/vault') {
      const bundle = await getWorkspaceBundle(caller.workspaceId);
      sendJson(res, 200, {
        vault: bundle.workspace.vault,
        version: bundle.workspace.version,
        updatedAt: bundle.workspace.updatedAt,
        activity: bundle.activity,
      });
      return;
    }

    if (method === 'POST' && subpath === '/playground') {
      const body = await readJsonBody(req);
      const rpcResponse = await handleMcpMessage(caller.workspaceId, body);
      const bundle = await getWorkspaceBundle(caller.workspaceId);
      sendJson(res, 200, {
        response: rpcResponse,
        version: bundle.workspace.version,
        updatedAt: bundle.workspace.updatedAt,
        activity: bundle.activity,
      });
      return;
    }

    sendJson(res, 404, { error: `Unknown MCP endpoint: ${subpath || '/'}` });
  } catch (err) {
    console.error('[api/mcp] Error:', err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
