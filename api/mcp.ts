import type { IncomingMessage, ServerResponse } from 'http';
import { verifyManagementCaller, verifyMcpAgentCaller } from '../server/auth';
import {
  MCP_PROMPTS,
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCES,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  handleSingleMcpMessage,
} from '../server/mcpHandler';
import {
  createAnonymousSession,
  createMcpToken,
  getWorkspaceVault,
  listActivity,
  listMcpTokens,
  revokeMcpToken,
  saveWorkspaceVault,
  validateVaultStructure,
} from '../server/mcpStore';

interface VercelRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[]>;
}

interface VercelResponse extends ServerResponse {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
  send: (data: unknown) => void;
}

async function readJsonBody(req: VercelRequest): Promise<unknown> {
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
  const chunks: Buffer[] = [];
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

function sendJson(res: VercelResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();
  const rawUrl = req.url || '/api/mcp';
  const parsedUrl = new URL(rawUrl, 'http://localhost');
  let subpath = parsedUrl.pathname.replace(/^\/api\/mcp/, '').replace(/^\/mcp/, '');
  if (!subpath || subpath === '/') subpath = '';

  try {
    // Public discovery
    if (method === 'GET' && subpath === '/info') {
      const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
      const baseUrl = host ? `${protocol}://${host}` : '';
      sendJson(res, 200, {
        server: MCP_SERVER_INFO,
        protocolVersion: MCP_PROTOCOL_VERSION,
        transport: 'streamable-http',
        endpoint: `${baseUrl}/api/mcp`,
        authentication: { type: 'bearer', header: 'Authorization: Bearer <your-lvp-token>' },
        tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
        resources: MCP_RESOURCES,
        prompts: MCP_PROMPTS,
      });
      return;
    }

    // Streamable HTTP MCP endpoint (/api/mcp or /mcp)
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
        const caller = verifyMcpAgentCaller(req);
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
          const responses = body
            .map((msg) => handleSingleMcpMessage(caller.workspaceId, msg as Record<string, unknown>))
            .filter((r): r is NonNullable<typeof r> => r !== null);
          if (responses.length === 0) {
            res.statusCode = 202;
            res.end();
            return;
          }
          sendJson(res, 200, responses);
          return;
        }
        const response = handleSingleMcpMessage(caller.workspaceId, body as Record<string, unknown>);
        if (response === null) {
          res.statusCode = 202;
          res.end();
          return;
        }
        sendJson(res, 200, response);
        return;
      }
    }

    // Anonymous workspace session bootstrap
    if (method === 'POST' && subpath === '/workspace/session') {
      const session = createAnonymousSession();
      sendJson(res, 201, session);
      return;
    }

    // Management endpoints
    const caller = await verifyManagementCaller(req);
    if (!caller) {
      sendJson(res, 401, { error: 'Unauthorized: sign in again or refresh session.' });
      return;
    }

    if (method === 'GET' && subpath === '/tokens') {
      const tokens = listMcpTokens(caller.workspaceId);
      const { version, updatedAt } = getWorkspaceVault(caller.workspaceId);
      const activity = listActivity(caller.workspaceId, 20);
      sendJson(res, 200, { tokens, version, updatedAt, activity, authType: caller.authType });
      return;
    }

    if (method === 'POST' && subpath === '/tokens') {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const label = typeof body?.label === 'string' ? body.label : 'AI Agent';
      const created = createMcpToken(caller.workspaceId, label);
      sendJson(res, 201, created);
      return;
    }

    if (method === 'DELETE' && subpath.startsWith('/tokens/')) {
      const tokenId = decodeURIComponent(subpath.slice('/tokens/'.length));
      const revoked = revokeMcpToken(caller.workspaceId, tokenId);
      if (!revoked) {
        sendJson(res, 404, { error: 'Token not found' });
        return;
      }
      sendJson(res, 200, { revoked: true });
      return;
    }

    if (method === 'POST' && subpath === '/sync') {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      try {
        const vault = validateVaultStructure(body?.vault);
        const expectedVersion = typeof body?.expectedVersion === 'number' ? body.expectedVersion : undefined;
        const force = Boolean(body?.force);
        const saved = saveWorkspaceVault(caller.workspaceId, vault, { expectedVersion, force });
        if (saved.conflict) {
          const latest = getWorkspaceVault(caller.workspaceId);
          sendJson(res, 409, {
            conflict: true,
            vault: latest.vault,
            version: latest.version,
            updatedAt: latest.updatedAt,
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
      const { vault, version, updatedAt } = getWorkspaceVault(caller.workspaceId);
      const activity = listActivity(caller.workspaceId, 20);
      sendJson(res, 200, { vault, version, updatedAt, activity });
      return;
    }

    if (method === 'POST' && subpath === '/playground') {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const rpcResponse = handleSingleMcpMessage(caller.workspaceId, body);
      const { version, updatedAt } = getWorkspaceVault(caller.workspaceId);
      const activity = listActivity(caller.workspaceId, 20);
      sendJson(res, 200, { response: rpcResponse, version, updatedAt, activity });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[api/mcp] Unhandled error:', err);
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
