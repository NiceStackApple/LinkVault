import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { verifyManagementCaller, verifyMcpAgentCaller } from './server/auth';
import {
  MCP_PROMPTS,
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCES,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  handleSingleMcpMessage,
} from './server/mcpHandler';
import {
  createAnonymousSession,
  createMcpToken,
  getWorkspaceVault,
  listActivity,
  listMcpTokens,
  revokeMcpToken,
  saveWorkspaceVault,
  validateVaultStructure,
} from './server/mcpStore';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));

  // Public MCP discovery metadata (no user data or secrets)
  app.get('/api/mcp/info', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = host ? `${protocol}://${host}` : '';
    res.json({
      server: MCP_SERVER_INFO,
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: `${baseUrl}/api/mcp`,
      authentication: {
        type: 'bearer',
        header: 'Authorization: Bearer <your-lvp-token>',
      },
      tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
      resources: MCP_RESOURCES,
      prompts: MCP_PROMPTS,
    });
  });

  // Streamable HTTP MCP endpoint for AI Agents (POST /api/mcp and /mcp alias)
  const handleMcpPost = (req: express.Request, res: express.Response) => {
    const caller = verifyMcpAgentCaller(req);
    if (!caller) {
      res.status(401).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message: 'Unauthorized: provide a valid LinkVault Pro MCP token via Authorization: Bearer lvp_...',
        },
      });
      return;
    }

    const body = req.body;
    if (Array.isArray(body)) {
      if (body.length === 0) {
        res.status(400).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Empty JSON-RPC batch' },
        });
        return;
      }
      const responses = body
        .map((msg) => handleSingleMcpMessage(caller.workspaceId, msg))
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (responses.length === 0) {
        res.status(202).end();
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(responses);
      return;
    }

    const response = handleSingleMcpMessage(caller.workspaceId, body);
    if (response === null) {
      res.status(202).end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(response);
  };

  app.post('/api/mcp', handleMcpPost);
  app.post('/mcp', handleMcpPost);

  app.get(['/api/mcp', '/mcp'], (_req, res) => {
    res.setHeader('Allow', 'POST, DELETE');
    res.status(405).json({
      error: 'Method Not Allowed. Send JSON-RPC 2.0 requests via POST with Authorization: Bearer <token>.',
    });
  });

  app.delete(['/api/mcp', '/mcp'], (_req, res) => {
    res.status(204).end();
  });

  // Anonymous workspace session bootstrap (for local/non-signed-in users; held in React memory only)
  app.post('/api/mcp/workspace/session', (_req, res) => {
    const { sessionToken, workspaceId } = createAnonymousSession();
    res.status(201).json({ sessionToken, workspaceId });
  });

  // Management routes (authenticated via Firebase ID token or server-issued workspace session token)
  app.get('/api/mcp/tokens', async (req, res) => {
    const caller = await verifyManagementCaller(req);
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const tokens = listMcpTokens(caller.workspaceId);
    const { version, updatedAt } = getWorkspaceVault(caller.workspaceId);
    const activity = listActivity(caller.workspaceId, 20);
    res.json({ tokens, version, updatedAt, activity, authType: caller.authType });
  });

  app.post('/api/mcp/tokens', async (req, res) => {
    const caller = await verifyManagementCaller(req);
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const label = typeof req.body?.label === 'string' ? req.body.label : 'AI Agent';
    const created = createMcpToken(caller.workspaceId, label);
    res.status(201).json(created);
  });

  app.delete('/api/mcp/tokens/:id', async (req, res) => {
    const caller = await verifyManagementCaller(req);
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const tokenId = typeof req.params.id === 'string' ? req.params.id : '';
    const revoked = revokeMcpToken(caller.workspaceId, tokenId);
    if (!revoked) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }
    res.json({ revoked: true });
  });

  app.post('/api/mcp/sync', async (req, res) => {
    const caller = await verifyManagementCaller(req);
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const vault = validateVaultStructure(req.body?.vault);
      const expectedVersion =
        typeof req.body?.expectedVersion === 'number' ? req.body.expectedVersion : undefined;
      const force = Boolean(req.body?.force);
      const saved = saveWorkspaceVault(caller.workspaceId, vault, { expectedVersion, force });
      if (saved.conflict) {
        const latest = getWorkspaceVault(caller.workspaceId);
        res.status(409).json({
          conflict: true,
          vault: latest.vault,
          version: latest.version,
          updatedAt: latest.updatedAt,
        });
        return;
      }
      res.json({ version: saved.version, updatedAt: saved.updatedAt });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid vault payload' });
    }
  });

  app.get('/api/mcp/vault', async (req, res) => {
    const caller = await verifyManagementCaller(req);
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { vault, version, updatedAt } = getWorkspaceVault(caller.workspaceId);
    const activity = listActivity(caller.workspaceId, 20);
    res.json({ vault, version, updatedAt, activity });
  });

  // In-app MCP JSON-RPC playground (uses caller's authenticated workspace)
  app.post('/api/mcp/playground', async (req, res) => {
    const caller = await verifyManagementCaller(req);
    if (!caller) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rpcResponse = handleSingleMcpMessage(caller.workspaceId, req.body);
    const { version, updatedAt } = getWorkspaceVault(caller.workspaceId);
    const activity = listActivity(caller.workspaceId, 20);
    res.json({ response: rpcResponse, version, updatedAt, activity });
  });

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/mcp') {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LinkVaultPro server + MCP listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
