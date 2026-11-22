import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

export type LinkType = 'youtube' | 'tiktok' | 'instagram' | 'general' | 'note';

export interface VaultLinkItem {
  id: string;
  title: string;
  url: string;
  content?: string;
  type: LinkType;
  dateAdded: number;
  starred?: boolean;
  previewImage?: string | null;
}

export interface VaultFolder {
  id: string;
  name: string;
  folders: VaultFolder[];
  links: VaultLinkItem[];
  starred?: boolean;
  color?: string;
  isPublic?: boolean;
  shareId?: string | null;
  type?: string;
  shortcutShareId?: string;
  shortcutOwnerName?: string;
  createdAt?: number;
}

export interface TokenRecord {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ActivityRecord {
  id: string;
  toolName: string;
  summary: string;
  status: 'ok' | 'error';
  createdAt: number;
}

interface StoredWorkspaceRow {
  vault_json: string;
  version: number;
  updated_at: number;
}

interface StoredTokenRow {
  id: string;
  workspace_id: string;
  label: string;
  token_hash: string;
  token_prefix: string;
  created_at: number;
  last_used_at: number | null;
}

interface StoredSessionRow {
  token_hash: string;
  workspace_id: string;
  created_at: number;
  expires_at: number;
}

interface StoredActivityRow {
  id: string;
  workspace_id: string;
  tool_name: string;
  summary: string;
  status: 'ok' | 'error';
  created_at: number;
}

interface JsonStoreShape {
  workspaces: Record<string, StoredWorkspaceRow>;
  tokens: StoredTokenRow[];
  sessions: Record<string, StoredSessionRow>;
  activity: StoredActivityRow[];
}

export const DEFAULT_VAULT: VaultFolder = {
  id: 'root',
  name: 'Root',
  folders: [],
  links: [],
};

function resolveStorageDir(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'linkvault-mcp');
  }
  const localDir = path.join(process.cwd(), 'data');
  try {
    fs.mkdirSync(localDir, { recursive: true });
    fs.accessSync(localDir, fs.constants.W_OK);
    return localDir;
  } catch {
    const tmpDir = path.join(os.tmpdir(), 'linkvault-mcp');
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }
}

const STORAGE_DIR = resolveStorageDir();
fs.mkdirSync(STORAGE_DIR, { recursive: true });

// Attempt to initialize better-sqlite3; fall back seamlessly to atomic JSON store on serverless runtimes
let sqliteDb: import('better-sqlite3').Database | null = null;
const JSON_STORE_PATH = path.join(STORAGE_DIR, 'linkvault-mcp.json');

try {
  const req = createRequire(import.meta.url);
  const Database = req('better-sqlite3') as typeof import('better-sqlite3');
  const dbPath = path.join(STORAGE_DIR, 'linkvault-mcp.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_workspaces (
      workspace_id TEXT PRIMARY KEY,
      vault_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      label TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      token_prefix TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_workspace ON mcp_tokens(workspace_id);

    CREATE TABLE IF NOT EXISTS mcp_sessions (
      token_hash TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_activity (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mcp_activity_workspace ON mcp_activity(workspace_id, created_at DESC);
  `);

  sqliteDb = db;
} catch (err) {
  console.warn('[mcpStore] SQLite unavailable, using JSON file store fallback:', err instanceof Error ? err.message : err);
  sqliteDb = null;
}

function readJsonStore(): JsonStoreShape {
  try {
    if (fs.existsSync(JSON_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(JSON_STORE_PATH, 'utf8')) as Partial<JsonStoreShape>;
      return {
        workspaces: parsed.workspaces || {},
        tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        sessions: parsed.sessions || {},
        activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      };
    }
  } catch {
    // ignore corrupt fallback file
  }
  return { workspaces: {}, tokens: [], sessions: {}, activity: [] };
}

function writeJsonStore(data: JsonStoreShape): void {
  const tmpPath = `${JSON_STORE_PATH}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
  fs.renameSync(tmpPath, JSON_STORE_PATH);
}

export function hashSecret(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function generateId(prefix = ''): string {
  const rand = crypto.randomBytes(6).toString('hex');
  return prefix ? `${prefix}_${Date.now()}_${rand}` : `${Date.now().toString(36)}${rand}`;
}

export function sanitizeHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('URL is required');
  }
  let parsed: URL;
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

export function detectLinkType(url: string): Exclude<LinkType, 'note'> {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('instagram.com')) return 'instagram';
  return 'general';
}

export function extractYoutubeThumbnail(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : null;
}

export function validateVaultStructure(input: unknown): VaultFolder {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid vault payload');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') {
    throw new Error('Vault root must have string id and name');
  }
  if (!Array.isArray(obj.folders) || !Array.isArray(obj.links)) {
    throw new Error('Vault root must have folders and links arrays');
  }
  return input as VaultFolder;
}

export function getWorkspaceVault(workspaceId: string): { vault: VaultFolder; version: number; updatedAt: number } {
  if (sqliteDb) {
    const row = sqliteDb
      .prepare('SELECT vault_json, version, updated_at FROM mcp_workspaces WHERE workspace_id = ?')
      .get(workspaceId) as StoredWorkspaceRow | undefined;

    if (!row) {
      const now = Date.now();
      sqliteDb
        .prepare('INSERT OR IGNORE INTO mcp_workspaces (workspace_id, vault_json, version, updated_at) VALUES (?, ?, ?, ?)')
        .run(workspaceId, JSON.stringify(DEFAULT_VAULT), 1, now);
      return { vault: structuredClone(DEFAULT_VAULT), version: 1, updatedAt: now };
    }

    try {
      return {
        vault: JSON.parse(row.vault_json) as VaultFolder,
        version: row.version,
        updatedAt: row.updated_at,
      };
    } catch {
      return { vault: structuredClone(DEFAULT_VAULT), version: row.version, updatedAt: row.updated_at };
    }
  }

  const store = readJsonStore();
  const row = store.workspaces[workspaceId];
  if (!row) {
    const now = Date.now();
    store.workspaces[workspaceId] = { vault_json: JSON.stringify(DEFAULT_VAULT), version: 1, updated_at: now };
    writeJsonStore(store);
    return { vault: structuredClone(DEFAULT_VAULT), version: 1, updatedAt: now };
  }
  try {
    return { vault: JSON.parse(row.vault_json) as VaultFolder, version: row.version, updatedAt: row.updated_at };
  } catch {
    return { vault: structuredClone(DEFAULT_VAULT), version: row.version, updatedAt: row.updated_at };
  }
}

export function saveWorkspaceVault(
  workspaceId: string,
  vault: VaultFolder,
  options?: { expectedVersion?: number; force?: boolean }
): { version: number; updatedAt: number; conflict: boolean } {
  const now = Date.now();
  if (sqliteDb) {
    const existing = sqliteDb
      .prepare('SELECT version, updated_at FROM mcp_workspaces WHERE workspace_id = ?')
      .get(workspaceId) as { version: number; updated_at: number } | undefined;

    if (!existing) {
      sqliteDb
        .prepare('INSERT INTO mcp_workspaces (workspace_id, vault_json, version, updated_at) VALUES (?, ?, ?, ?)')
        .run(workspaceId, JSON.stringify(vault), 1, now);
      return { version: 1, updatedAt: now, conflict: false };
    }

    if (
      !options?.force &&
      typeof options?.expectedVersion === 'number' &&
      options.expectedVersion !== existing.version
    ) {
      return { version: existing.version, updatedAt: existing.updated_at, conflict: true };
    }

    const nextVersion = existing.version + 1;
    sqliteDb
      .prepare('UPDATE mcp_workspaces SET vault_json = ?, version = ?, updated_at = ? WHERE workspace_id = ?')
      .run(JSON.stringify(vault), nextVersion, now, workspaceId);

    return { version: nextVersion, updatedAt: now, conflict: false };
  }

  const store = readJsonStore();
  const existing = store.workspaces[workspaceId];
  if (!existing) {
    store.workspaces[workspaceId] = { vault_json: JSON.stringify(vault), version: 1, updated_at: now };
    writeJsonStore(store);
    return { version: 1, updatedAt: now, conflict: false };
  }
  if (
    !options?.force &&
    typeof options?.expectedVersion === 'number' &&
    options.expectedVersion !== existing.version
  ) {
    return { version: existing.version, updatedAt: existing.updated_at, conflict: true };
  }
  const nextVersion = existing.version + 1;
  store.workspaces[workspaceId] = { vault_json: JSON.stringify(vault), version: nextVersion, updated_at: now };
  writeJsonStore(store);
  return { version: nextVersion, updatedAt: now, conflict: false };
}

export function createMcpToken(workspaceId: string, label: string): { token: string; record: TokenRecord } {
  const cleanLabel = label.trim().slice(0, 64) || 'AI Agent';
  const rawToken = `lvp_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashSecret(rawToken);
  const tokenPrefix = `${rawToken.slice(0, 12)}...${rawToken.slice(-4)}`;
  const id = generateId('tok');
  const now = Date.now();

  if (sqliteDb) {
    sqliteDb
      .prepare(
        'INSERT INTO mcp_tokens (id, workspace_id, label, token_hash, token_prefix, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
      )
      .run(id, workspaceId, cleanLabel, tokenHash, tokenPrefix, now);
  } else {
    const store = readJsonStore();
    store.tokens.unshift({
      id,
      workspace_id: workspaceId,
      label: cleanLabel,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      created_at: now,
      last_used_at: null,
    });
    writeJsonStore(store);
  }

  return {
    token: rawToken,
    record: {
      id,
      label: cleanLabel,
      tokenPrefix,
      createdAt: now,
      lastUsedAt: null,
    },
  };
}

export function listMcpTokens(workspaceId: string): TokenRecord[] {
  if (sqliteDb) {
    const rows = sqliteDb
      .prepare(
        'SELECT id, label, token_prefix, created_at, last_used_at FROM mcp_tokens WHERE workspace_id = ? ORDER BY created_at DESC'
      )
      .all(workspaceId) as Array<{
      id: string;
      label: string;
      token_prefix: string;
      created_at: number;
      last_used_at: number | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      tokenPrefix: r.token_prefix,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    }));
  }

  const store = readJsonStore();
  return store.tokens
    .filter((t) => t.workspace_id === workspaceId)
    .sort((a, b) => b.created_at - a.created_at)
    .map((r) => ({
      id: r.id,
      label: r.label,
      tokenPrefix: r.token_prefix,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    }));
}

export function revokeMcpToken(workspaceId: string, tokenId: string): boolean {
  if (sqliteDb) {
    const res = sqliteDb
      .prepare('DELETE FROM mcp_tokens WHERE id = ? AND workspace_id = ?')
      .run(tokenId, workspaceId);
    return res.changes > 0;
  }

  const store = readJsonStore();
  const before = store.tokens.length;
  store.tokens = store.tokens.filter((t) => !(t.id === tokenId && t.workspace_id === workspaceId));
  if (store.tokens.length !== before) {
    writeJsonStore(store);
    return true;
  }
  return false;
}

export function verifyMcpApiToken(rawToken: string): { workspaceId: string; tokenId: string; label: string } | null {
  if (!rawToken || !rawToken.startsWith('lvp_')) return null;
  const candidateHash = hashSecret(rawToken);
  const a = Buffer.from(candidateHash, 'hex');

  if (sqliteDb) {
    const row = sqliteDb
      .prepare('SELECT id, workspace_id, label, token_hash FROM mcp_tokens WHERE token_hash = ?')
      .get(candidateHash) as { id: string; workspace_id: string; label: string; token_hash: string } | undefined;

    if (!row) return null;

    const b = Buffer.from(row.token_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    sqliteDb.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
    return { workspaceId: row.workspace_id, tokenId: row.id, label: row.label };
  }

  const store = readJsonStore();
  const row = store.tokens.find((t) => {
    const b = Buffer.from(t.token_hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!row) return null;
  row.last_used_at = Date.now();
  writeJsonStore(store);
  return { workspaceId: row.workspace_id, tokenId: row.id, label: row.label };
}

export function createAnonymousSession(): { sessionToken: string; workspaceId: string } {
  const workspaceId = `anon:${crypto.randomBytes(16).toString('hex')}`;
  const sessionToken = `lvps_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashSecret(sessionToken);
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

  if (sqliteDb) {
    sqliteDb
      .prepare('INSERT INTO mcp_sessions (token_hash, workspace_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, workspaceId, now, expiresAt);
  } else {
    const store = readJsonStore();
    store.sessions[tokenHash] = { token_hash: tokenHash, workspace_id: workspaceId, created_at: now, expires_at: expiresAt };
    writeJsonStore(store);
  }

  return { sessionToken, workspaceId };
}

export function verifyAnonymousSession(sessionToken: string): string | null {
  if (!sessionToken || !sessionToken.startsWith('lvps_')) return null;
  const candidateHash = hashSecret(sessionToken);

  if (sqliteDb) {
    const row = sqliteDb
      .prepare('SELECT workspace_id, expires_at FROM mcp_sessions WHERE token_hash = ?')
      .get(candidateHash) as { workspace_id: string; expires_at: number } | undefined;

    if (!row) return null;
    if (row.expires_at < Date.now()) {
      sqliteDb.prepare('DELETE FROM mcp_sessions WHERE token_hash = ?').run(candidateHash);
      return null;
    }
    return row.workspace_id;
  }

  const store = readJsonStore();
  const row = store.sessions[candidateHash];
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    delete store.sessions[candidateHash];
    writeJsonStore(store);
    return null;
  }
  return row.workspace_id;
}

export function recordActivity(
  workspaceId: string,
  toolName: string,
  summary: string,
  status: 'ok' | 'error' = 'ok'
): void {
  const id = generateId('act');
  const now = Date.now();
  if (sqliteDb) {
    sqliteDb
      .prepare(
        'INSERT INTO mcp_activity (id, workspace_id, tool_name, summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, workspaceId, toolName.slice(0, 64), summary.slice(0, 240), status, now);

    sqliteDb
      .prepare(
        `DELETE FROM mcp_activity WHERE workspace_id = ? AND id NOT IN (
          SELECT id FROM mcp_activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50
        )`
      )
      .run(workspaceId, workspaceId);
    return;
  }

  const store = readJsonStore();
  store.activity.unshift({
    id,
    workspace_id: workspaceId,
    tool_name: toolName.slice(0, 64),
    summary: summary.slice(0, 240),
    status,
    created_at: now,
  });
  let count = 0;
  store.activity = store.activity.filter((row) => {
    if (row.workspace_id !== workspaceId) return true;
    count++;
    return count <= 50;
  });
  writeJsonStore(store);
}

export function listActivity(workspaceId: string, limit = 20): ActivityRecord[] {
  const safeLimit = Math.max(1, Math.min(50, limit));
  if (sqliteDb) {
    const rows = sqliteDb
      .prepare(
        'SELECT id, tool_name, summary, status, created_at FROM mcp_activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(workspaceId, safeLimit) as Array<{
      id: string;
      tool_name: string;
      summary: string;
      status: 'ok' | 'error';
      created_at: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      toolName: r.tool_name,
      summary: r.summary,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  const store = readJsonStore();
  return store.activity
    .filter((r) => r.workspace_id === workspaceId)
    .slice(0, safeLimit)
    .map((r) => ({
      id: r.id,
      toolName: r.tool_name,
      summary: r.summary,
      status: r.status,
      createdAt: r.created_at,
    }));
}

// Vault Tree Helpers

export function findFolderById(root: VaultFolder, id: string): VaultFolder | null {
  if (root.id === id) return root;
  for (const sub of root.folders) {
    const found = findFolderById(sub, id);
    if (found) return found;
  }
  return null;
}

export function getFolderPath(root: VaultFolder, targetId: string): string[] | null {
  if (root.id === targetId) return [root.name];
  for (const sub of root.folders) {
    const pathParts = getFolderPath(sub, targetId);
    if (pathParts) return [root.name, ...pathParts];
  }
  return null;
}

export function flattenFolders(
  root: VaultFolder,
  parentPath = ''
): Array<{
  id: string;
  name: string;
  path: string;
  folderCount: number;
  itemCount: number;
  starred: boolean;
  isPublic: boolean;
  color: string | null;
}> {
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
  for (const sub of root.folders) {
    list.push(...flattenFolders(sub, currentPath));
  }
  return list;
}

export function searchVaultTree(
  root: VaultFolder,
  queryStr: string,
  typeFilter?: LinkType
): {
  folders: Array<{ id: string; name: string; path: string; starred: boolean }>;
  items: Array<VaultLinkItem & { folderId: string; folderPath: string }>;
} {
  const q = queryStr.trim().toLowerCase();
  const folders: Array<{ id: string; name: string; path: string; starred: boolean }> = [];
  const items: Array<VaultLinkItem & { folderId: string; folderPath: string }> = [];

  const walk = (folder: VaultFolder, currentPath: string) => {
    const folderPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;
    if (folder.id !== 'root' && !typeFilter && (!q || folder.name.toLowerCase().includes(q))) {
      folders.push({
        id: folder.id,
        name: folder.name,
        path: folderPath,
        starred: Boolean(folder.starred),
      });
    }
    for (const link of folder.links) {
      if (typeFilter && link.type !== typeFilter) continue;
      const hay = `${link.title || ''} ${link.url || ''} ${link.content || ''}`.toLowerCase();
      if (!q || hay.includes(q)) {
        items.push({ ...link, folderId: folder.id, folderPath });
      }
    }
    for (const sub of folder.folders) {
      walk(sub, folderPath);
    }
  };

  walk(root, '');
  return { folders, items };
}

export function collectStarred(root: VaultFolder): {
  folders: Array<{ id: string; name: string; path: string }>;
  items: Array<VaultLinkItem & { folderId: string; folderPath: string }>;
} {
  const folders: Array<{ id: string; name: string; path: string }> = [];
  const items: Array<VaultLinkItem & { folderId: string; folderPath: string }> = [];

  const walk = (folder: VaultFolder, currentPath: string) => {
    const folderPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;
    if (folder.id !== 'root' && folder.starred) {
      folders.push({ id: folder.id, name: folder.name, path: folderPath });
    }
    for (const link of folder.links) {
      if (link.starred) {
        items.push({ ...link, folderId: folder.id, folderPath });
      }
    }
    for (const sub of folder.folders) {
      walk(sub, folderPath);
    }
  };

  walk(root, '');
  return { folders, items };
}

export function deleteFolderFromTree(root: VaultFolder, folderId: string): { tree: VaultFolder; deleted: boolean } {
  let deleted = false;
  const walk = (folder: VaultFolder): VaultFolder => {
    const before = folder.folders.length;
    const filtered = folder.folders.filter((sub) => sub.id !== folderId);
    if (filtered.length !== before) {
      deleted = true;
    }
    return {
      ...folder,
      folders: filtered.map(walk),
    };
  };
  return { tree: walk(root), deleted };
}

export function deleteItemFromTree(root: VaultFolder, itemId: string): { tree: VaultFolder; deleted: boolean } {
  let deleted = false;
  const walk = (folder: VaultFolder): VaultFolder => {
    const before = folder.links.length;
    const filtered = folder.links.filter((l) => l.id !== itemId);
    if (filtered.length !== before) {
      deleted = true;
    }
    return {
      ...folder,
      links: filtered,
      folders: folder.folders.map(walk),
    };
  };
  return { tree: walk(root), deleted };
}

export function updateItemInTree(
  root: VaultFolder,
  itemId: string,
  patch: Partial<Pick<VaultLinkItem, 'title' | 'url' | 'content' | 'starred' | 'type' | 'previewImage'>>
): { tree: VaultFolder; updated: VaultLinkItem | null } {
  let updated: VaultLinkItem | null = null;
  const walk = (folder: VaultFolder): VaultFolder => ({
    ...folder,
    links: folder.links.map((link) => {
      if (link.id !== itemId) return link;
      const next: VaultLinkItem = { ...link, ...patch };
      updated = next;
      return next;
    }),
    folders: folder.folders.map(walk),
  });
  return { tree: walk(root), updated };
}
