import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Key,
  Trash2,
  RefreshCw,
  Terminal,
  Play,
  Activity,
  Cpu,
  Plus,
  AlertCircle,
  ShieldCheck,
  Code2,
} from 'lucide-react';

export interface McpTokenInfo {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface McpActivityItem {
  id: string;
  toolName: string;
  summary: string;
  status: 'ok' | 'error';
  createdAt: number;
}

interface McpModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSignedIn: boolean;
  vaultVersion: number;
  lastSyncedAt: number | null;
  isSyncingMcp: boolean;
  tokens: McpTokenInfo[];
  activity: McpActivityItem[];
  onRefresh: () => Promise<void>;
  onForceSync: () => Promise<void>;
  onCreateToken: (label: string) => Promise<string | null>;
  onRevokeToken: (id: string) => Promise<void>;
  onRunPlayground: (payload: Record<string, unknown>) => Promise<unknown>;
}

const TOOL_CATALOG = [
  { name: 'list_folders', desc: 'List all folders or children of a parent folder', sampleArgs: '{}' },
  { name: 'get_folder', desc: 'Inspect subfolders, links, and notes in a folder', sampleArgs: '{"folderId": "root"}' },
  { name: 'search_vault', desc: 'Search folders, links, and notes by keyword/type', sampleArgs: '{"query": ""}' },
  { name: 'list_starred', desc: 'List all starred folders, links, and notes', sampleArgs: '{}' },
  {
    name: 'create_folder',
    desc: 'Create a new folder inside a parent folder',
    sampleArgs: '{"name": "AI Research", "parentFolderId": "root", "color": "#6366f1"}',
  },
  {
    name: 'add_link',
    desc: 'Save a web, YouTube, TikTok, or Instagram link',
    sampleArgs: '{"title": "Model Context Protocol Docs", "url": "https://modelcontextprotocol.io", "folderId": "root"}',
  },
  {
    name: 'add_note',
    desc: 'Save a text note to a folder',
    sampleArgs: '{"title": "Agent Note", "content": "Saved directly via LinkVaultPro MCP.", "folderId": "root"}',
  },
  {
    name: 'update_item',
    desc: 'Update title, URL, content, or starred status of an item',
    sampleArgs: '{"itemId": "ITEM_ID", "starred": true}',
  },
  { name: 'delete_item', desc: 'Delete a link or note by itemId', sampleArgs: '{"itemId": "ITEM_ID"}' },
  { name: 'delete_folder', desc: 'Delete a non-root folder by folderId', sampleArgs: '{"folderId": "FOLDER_ID"}' },
];

type ClientCategory = 'ide' | 'opensource' | 'pocket-other';

type ClientTab =
  | 'cursor'
  | 'claude-code'
  | 'claude-desktop'
  | 'vscode'
  | 'hermes'
  | 'opencode'
  | 'openclaw'
  | 'openbot'
  | 'muse'
  | 'other'
  | 'curl';

const CLIENT_GROUPS: Record<
  ClientCategory,
  { label: string; clients: Array<{ id: ClientTab; label: string }> }
> = {
  ide: {
    label: 'IDE & Desktop',
    clients: [
      { id: 'cursor', label: 'Cursor / Windsurf' },
      { id: 'claude-code', label: 'Claude Code' },
      { id: 'claude-desktop', label: 'Claude Desktop' },
      { id: 'vscode', label: 'VS Code' },
    ],
  },
  opensource: {
    label: 'Open Source Agents',
    clients: [
      { id: 'hermes', label: 'Hermes Agent' },
      { id: 'opencode', label: 'OpenCode' },
      { id: 'openclaw', label: 'OpenClaw' },
      { id: 'openbot', label: 'OpenBot' },
    ],
  },
  'pocket-other': {
    label: 'Pocket AI & Other',
    clients: [
      { id: 'muse', label: 'Muse.ai (Pocket)' },
      { id: 'other', label: 'Other / Generic' },
      { id: 'curl', label: 'cURL' },
    ],
  },
};

export const McpModal: React.FC<McpModalProps> = ({
  isOpen,
  onClose,
  isSignedIn,
  vaultVersion,
  lastSyncedAt,
  isSyncingMcp,
  tokens,
  activity,
  onRefresh,
  onForceSync,
  onCreateToken,
  onRevokeToken,
  onRunPlayground,
}) => {
  const [activeTab, setActiveTab] = useState<'connect' | 'playground' | 'activity'>('connect');
  const [clientCategory, setClientCategory] = useState<ClientCategory>('opensource');
  const [clientTab, setClientTab] = useState<ClientTab>('hermes');
  const [tokenLabel, setTokenLabel] = useState('AI Agent');
  const [creatingToken, setCreatingToken] = useState(false);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Playground state
  const [selectedTool, setSelectedTool] = useState<string>('list_folders');
  const [argsJson, setArgsJson] = useState<string>('{}');
  const [playgroundOutput, setPlaygroundOutput] = useState<string>('');
  const [playgroundError, setPlaygroundError] = useState<string | null>(null);
  const [runningTool, setRunningTool] = useState(false);

  const endpointUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp';

  useEffect(() => {
    if (isOpen) {
      onRefresh();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingToken(true);
    try {
      const token = await onCreateToken(tokenLabel.trim() || 'AI Agent');
      if (token) {
        setNewlyCreatedToken(token);
        setTokenLabel('');
      }
    } finally {
      setCreatingToken(false);
    }
  };

  const displayToken = newlyCreatedToken || '<YOUR_MCP_TOKEN>';

  const handleSelectCategory = (cat: ClientCategory) => {
    setClientCategory(cat);
    const firstClient = CLIENT_GROUPS[cat].clients[0];
    if (firstClient) {
      setClientTab(firstClient.id);
    }
  };

  const getClientSnippet = (): {
    filename: string;
    code: string;
    note?: string;
    secondary?: { filename: string; code: string };
  } => {
    switch (clientTab) {
      case 'cursor':
        return {
          filename: '.cursor/mcp.json',
          code: JSON.stringify(
            {
              mcpServers: {
                linkvaultpro: {
                  url: endpointUrl,
                  headers: {
                    Authorization: `Bearer ${displayToken}`,
                  },
                },
              },
            },
            null,
            2
          ),
        };
      case 'claude-code':
        return {
          filename: 'Terminal (Claude Code CLI)',
          code: `claude mcp add --transport http linkvaultpro "${endpointUrl}" \\\n  --header "Authorization: Bearer ${displayToken}"`,
        };
      case 'claude-desktop':
        return {
          filename: 'claude_desktop_config.json',
          code: JSON.stringify(
            {
              mcpServers: {
                linkvaultpro: {
                  command: 'npx',
                  args: [
                    '-y',
                    'mcp-remote',
                    endpointUrl,
                    '--header',
                    `Authorization: Bearer ${displayToken}`,
                  ],
                },
              },
            },
            null,
            2
          ),
        };
      case 'vscode':
        return {
          filename: '.vscode/mcp.json',
          code: JSON.stringify(
            {
              servers: {
                linkvaultpro: {
                  type: 'http',
                  url: endpointUrl,
                  headers: {
                    Authorization: `Bearer ${displayToken}`,
                  },
                },
              },
            },
            null,
            2
          ),
        };
      case 'hermes':
        return {
          filename: '~/.hermes/config.yaml',
          note: 'Tambahkan blok ini ke ~/.hermes/config.yaml pada Hermes Agent (Nous Research), lalu restart sesi Hermes.',
          code: `mcp_servers:\n  linkvaultpro:\n    url: "${endpointUrl}"\n    transport: "http"\n    headers:\n      Authorization: "Bearer ${displayToken}"\n    enabled: true\n    timeout: 300`,
        };
      case 'opencode':
        return {
          filename: 'opencode.json  (atau ~/.config/opencode/opencode.json)',
          note: 'Simpan di root project atau global config OpenCode, lalu cek koneksi dengan perintah: opencode mcp list',
          code: JSON.stringify(
            {
              $schema: 'https://opencode.ai/config.json',
              mcp: {
                linkvaultpro: {
                  type: 'remote',
                  url: endpointUrl,
                  headers: {
                    Authorization: `Bearer ${displayToken}`,
                  },
                  enabled: true,
                },
              },
            },
            null,
            2
          ),
        };
      case 'openclaw':
        return {
          filename: '~/.openclaw/openclaw.json  (atau Control UI → Settings → MCP)',
          note: 'Setelah menyimpan config, jalankan `openclaw gateway restart` lalu verifikasi dengan `openclaw mcp list`.',
          code: JSON.stringify(
            {
              mcp: {
                servers: {
                  linkvaultpro: {
                    transport: 'streamable-http',
                    url: endpointUrl,
                    headers: {
                      Authorization: `Bearer ${displayToken}`,
                    },
                  },
                },
              },
            },
            null,
            2
          ),
        };
      case 'openbot':
        return {
          filename: 'OpenBot MCP Config  (Settings → MCP / mcpServers)',
          note: 'Dapat ditambahkan langsung lewat OpenBot Control UI (Settings → MCP → Streamable HTTP) atau via JSON mcp-remote bridge di bawah.',
          code: JSON.stringify(
            {
              mcpServers: {
                linkvaultpro: {
                  transport: 'streamable-http',
                  url: endpointUrl,
                  headers: {
                    Authorization: `Bearer ${displayToken}`,
                  },
                },
              },
            },
            null,
            2
          ),
          secondary: {
            filename: 'OpenBot Stdio Bridge (jika hanya mendukung command/args)',
            code: JSON.stringify(
              {
                mcpServers: {
                  linkvaultpro: {
                    command: 'npx',
                    args: [
                      '-y',
                      'mcp-remote',
                      endpointUrl,
                      '--header',
                      `Authorization: Bearer ${displayToken}`,
                    ],
                  },
                },
              },
              null,
              2
            ),
          },
        };
      case 'muse':
        return {
          filename: 'Muse.ai App (Settings → Connectors → Add Custom Connector / Chat Prompt)',
          note: 'Untuk Muse.ai Pocket App, buka Settings → Connectors → Add Custom Connector, atau cukup paste prompt di bawah langsung ke chat Muse.',
          code: `Create a Custom Connector for a remote MCP server.\nName: LinkVaultPro\nTransport: remote streamable HTTP\nURL: ${endpointUrl}\nAuth Header: Authorization: Bearer ${displayToken}`,
          secondary: {
            filename: 'Muse Code (~/.config/muse/settings.json)',
            code: JSON.stringify(
              {
                mcp_servers: {
                  linkvaultpro: {
                    command: 'npx',
                    args: [
                      '-y',
                      'mcp-remote',
                      endpointUrl,
                      '--header',
                      `Authorization: Bearer ${displayToken}`,
                    ],
                  },
                },
              },
              null,
              2
            ),
          },
        };
      case 'other':
        return {
          filename: 'Universal Streamable HTTP MCP (Cline, Goose, Roo Code, Zed, Continue, Gemini CLI)',
          note: 'Gunakan konfigurasi Streamable HTTP standar di atas untuk agent modern, atau pakai stdio bridge `mcp-remote` di bawah untuk agent yang hanya mendukung command lokal.',
          code: JSON.stringify(
            {
              mcpServers: {
                linkvaultpro: {
                  type: 'streamable-http',
                  url: endpointUrl,
                  headers: {
                    Authorization: `Bearer ${displayToken}`,
                  },
                },
              },
            },
            null,
            2
          ),
          secondary: {
            filename: 'Universal Stdio Bridge (npx mcp-remote)',
            code: `npx -y mcp-remote "${endpointUrl}" --header "Authorization: Bearer ${displayToken}"`,
          },
        };
      case 'curl':
        return {
          filename: 'Shell test (tools/list)',
          code: `curl -X POST "${endpointUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${displayToken}" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
        };
    }
  };

  const handleSelectTool = (toolName: string) => {
    setSelectedTool(toolName);
    const meta = TOOL_CATALOG.find((t) => t.name === toolName);
    setArgsJson(meta?.sampleArgs || '{}');
    setPlaygroundError(null);
  };

  const handleRunTool = async () => {
    setPlaygroundError(null);
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = argsJson.trim() ? JSON.parse(argsJson) : {};
    } catch {
      setPlaygroundError('Invalid JSON arguments');
      return;
    }

    setRunningTool(true);
    try {
      const result = await onRunPlayground({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: selectedTool,
          arguments: parsedArgs,
        },
      });
      setPlaygroundOutput(JSON.stringify(result, null, 2));
    } catch (err) {
      setPlaygroundError(err instanceof Error ? err.message : 'Failed to execute MCP tool');
    } finally {
      setRunningTool(false);
    }
  };

  const snippet = getClientSnippet();

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-black text-white flex items-center justify-center">
              <Cpu size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                MCP Server for AI Agents
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Streamable HTTP
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Connect Claude, Cursor, Windsurf, or custom AI agents to your vault
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-white">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('connect')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'connect'
                  ? 'border-black text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Key size={14} />
              <span>Connect & Tokens</span>
            </button>
            <button
              onClick={() => setActiveTab('playground')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'playground'
                  ? 'border-black text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Terminal size={14} />
              <span>Tools ({TOOL_CATALOG.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'activity'
                  ? 'border-black text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Activity size={14} />
              <span>Activity ({activity.length})</span>
            </button>
          </div>
          <button
            onClick={onForceSync}
            disabled={isSyncingMcp}
            className="mb-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-black bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-60"
            title="Sync vault with MCP server"
          >
            <RefreshCw size={12} className={isSyncingMcp ? 'animate-spin' : ''} />
            <span>v{vaultVersion}</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {!isSignedIn && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-amber-800">
              <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Local Session Mode:</span> Your MCP workspace works right away for this
                session. Sign in with Google to bind MCP tokens permanently to your cloud-synced account across devices.
              </div>
            </div>
          )}

          {activeTab === 'connect' && (
            <>
              {/* Endpoint */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    MCP Endpoint URL
                  </label>
                  {lastSyncedAt && (
                    <span className="text-[11px] text-slate-400">
                      Synced {new Date(lastSyncedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={endpointUrl}
                    className="flex-1 px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
                  />
                  <button
                    onClick={() => copyText(endpointUrl, 'endpoint')}
                    className="px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-sm font-medium text-slate-700 flex items-center gap-1.5 transition-colors"
                  >
                    {copiedKey === 'endpoint' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    <span>{copiedKey === 'endpoint' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Token Generator */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Access Tokens
                </label>
                <form onSubmit={handleGenerateToken} className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={tokenLabel}
                    onChange={(e) => setTokenLabel(e.target.value)}
                    placeholder="Token label (e.g., Cursor, Claude Desktop)"
                    className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <button
                    type="submit"
                    disabled={creatingToken}
                    className="px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Plus size={15} />
                    <span>{creatingToken ? 'Creating...' : 'Generate Token'}</span>
                  </button>
                </form>

                {newlyCreatedToken && (
                  <div className="mb-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                        <ShieldCheck size={14} />
                        New token generated — copy it now (shown once)
                      </span>
                      <button
                        onClick={() => copyText(newlyCreatedToken, 'new-token')}
                        className="text-xs font-medium px-2.5 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 flex items-center gap-1"
                      >
                        {copiedKey === 'new-token' ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedKey === 'new-token' ? 'Copied!' : 'Copy Token'}</span>
                      </button>
                    </div>
                    <code className="block text-xs font-mono bg-white border border-emerald-200 rounded-lg p-2 text-slate-800 break-all select-all">
                      {newlyCreatedToken}
                    </code>
                  </div>
                )}

                {tokens.length === 0 ? (
                  <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200/70 rounded-xl p-3.5 text-center">
                    No active MCP tokens yet. Generate a token to connect an external AI agent.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tokens.map((tok) => (
                      <div
                        key={tok.id}
                        className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{tok.label}</div>
                          <div className="text-xs text-slate-500 font-mono flex items-center gap-2 mt-0.5">
                            <span>{tok.tokenPrefix}</span>
                            <span>•</span>
                            <span>
                              {tok.lastUsedAt
                                ? `Used ${new Date(tok.lastUsedAt).toLocaleString()}`
                                : 'Never used'}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => onRevokeToken(tok.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Revoke token"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Client Config Snippets */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Code2 size={14} />
                    <span>Client Setup Snippet</span>
                  </label>
                  <button
                    onClick={() => copyText(snippet.code, 'snippet')}
                    className="text-xs font-medium text-slate-700 hover:text-black flex items-center gap-1"
                  >
                    {copiedKey === 'snippet' ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    <span>{copiedKey === 'snippet' ? 'Copied' : 'Copy snippet'}</span>
                  </button>
                </div>

                {/* Category switcher */}
                <div className="inline-flex p-1 bg-slate-100 rounded-xl mb-2.5 gap-1">
                  {(Object.keys(CLIENT_GROUPS) as ClientCategory[]).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => handleSelectCategory(cat)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                        clientCategory === cat
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {CLIENT_GROUPS[cat].label}
                    </button>
                  ))}
                </div>

                {/* Client buttons inside selected category */}
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {CLIENT_GROUPS[clientCategory].clients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => setClientTab(client.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                        clientTab === client.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {client.label}
                    </button>
                  ))}
                </div>

                <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-950 text-slate-100">
                  <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] font-mono text-slate-400">
                    {snippet.filename}
                  </div>
                  <pre className="p-3 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
                    {snippet.code}
                  </pre>
                </div>

                {snippet.note && (
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed">{snippet.note}</p>
                )}

                {snippet.secondary && (
                  <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 bg-slate-950 text-slate-100">
                    <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-slate-400 truncate">
                        {snippet.secondary.filename}
                      </span>
                      <button
                        onClick={() => copyText(snippet.secondary!.code, 'snippet-secondary')}
                        className="text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1 flex-shrink-0"
                      >
                        {copiedKey === 'snippet-secondary' ? (
                          <Check size={12} className="text-emerald-400" />
                        ) : (
                          <Copy size={12} />
                        )}
                        <span>{copiedKey === 'snippet-secondary' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <pre className="p-3 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
                      {snippet.secondary.code}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'playground' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
                  Available MCP Tools
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TOOL_CATALOG.map((tool) => (
                    <button
                      key={tool.name}
                      onClick={() => handleSelectTool(tool.name)}
                      className={`text-left p-2.5 rounded-xl border transition-all ${
                        selectedTool === tool.name
                          ? 'border-black bg-slate-50 ring-1 ring-black'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="text-xs font-mono font-semibold text-slate-900">{tool.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{tool.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Arguments JSON ({selectedTool})
                  </label>
                  <button
                    onClick={handleRunTool}
                    disabled={runningTool}
                    className="px-3 py-1.5 bg-black text-white rounded-lg text-xs font-medium hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Play size={12} />
                    <span>{runningTool ? 'Running...' : 'Run MCP Tool'}</span>
                  </button>
                </div>
                <textarea
                  value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                {playgroundError && <p className="text-xs text-red-600 mt-1">{playgroundError}</p>}
              </div>

              {playgroundOutput && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    JSON-RPC 2.0 Response
                  </label>
                  <pre className="p-3 rounded-xl bg-slate-950 text-emerald-300 text-xs font-mono overflow-x-auto max-h-60">
                    {playgroundOutput}
                  </pre>
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Recent AI Agent Tool Calls
                </span>
                <button
                  onClick={onRefresh}
                  className="text-xs font-medium text-slate-600 hover:text-black flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  <span>Refresh</span>
                </button>
              </div>
              {activity.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-10 border-2 border-dashed border-slate-200 rounded-xl">
                  No AI agent requests recorded yet. Try running a tool in the Playground or connect an external agent.
                </div>
              ) : (
                <div className="space-y-2">
                  {activity.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 p-3 bg-slate-50 border border-slate-200/70 rounded-xl"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-semibold text-slate-900">{item.toolName}</span>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              item.status === 'ok'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-1">{item.summary}</p>
                      </div>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">
                        {new Date(item.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
