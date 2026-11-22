import {
  VaultFolder,
  VaultLinkItem,
  LinkType,
  collectStarred,
  deleteFolderFromTree,
  deleteItemFromTree,
  detectLinkType,
  extractYoutubeThumbnail,
  findFolderById,
  flattenFolders,
  generateId,
  getFolderPath,
  getWorkspaceVault,
  recordActivity,
  sanitizeHttpUrl,
  saveWorkspaceVault,
  searchVaultTree,
  updateItemInTree,
} from './mcpStore';

export const MCP_SERVER_INFO = {
  name: 'linkvaultpro-mcp',
  version: '1.0.0',
};

export const MCP_PROTOCOL_VERSION = '2025-03-26';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
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
        folderId: {
          type: 'string',
          description: 'Folder ID to inspect (default: "root").',
        },
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
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder inside a parent folder (defaults to "root").',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the new folder.',
        },
        parentFolderId: {
          type: 'string',
          description: 'ID of the parent folder (default: "root").',
        },
        color: {
          type: 'string',
          description: 'Optional hex color code such as "#6366f1".',
        },
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
        title: {
          type: 'string',
          description: 'Title for the saved link.',
        },
        url: {
          type: 'string',
          description: 'Full http:// or https:// URL to save.',
        },
        folderId: {
          type: 'string',
          description: 'Target folder ID (default: "root").',
        },
        starred: {
          type: 'boolean',
          description: 'Whether to mark this link as starred.',
        },
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
        title: {
          type: 'string',
          description: 'Title of the note.',
        },
        content: {
          type: 'string',
          description: 'Full text content of the note.',
        },
        folderId: {
          type: 'string',
          description: 'Target folder ID (default: "root").',
        },
        starred: {
          type: 'boolean',
          description: 'Whether to mark this note as starred.',
        },
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
        itemId: {
          type: 'string',
          description: 'ID of the link or note to update.',
        },
        title: {
          type: 'string',
          description: 'Optional new title.',
        },
        url: {
          type: 'string',
          description: 'Optional new http:// or https:// URL (for links).',
        },
        content: {
          type: 'string',
          description: 'Optional new text content (for notes).',
        },
        starred: {
          type: 'boolean',
          description: 'Optional new starred status.',
        },
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
      properties: {
        itemId: {
          type: 'string',
          description: 'ID of the link or note to delete.',
        },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_folder',
    description: 'Delete a folder and all nested subfolders/items inside it by folderId. Cannot delete "root".',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: {
          type: 'string',
          description: 'ID of the folder to delete.',
        },
      },
      required: ['folderId'],
      additionalProperties: false,
    },
  },
];

export const MCP_RESOURCES = [
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

export const MCP_PROMPTS = [
  {
    name: 'organize_vault',
    description: 'Analyze the user LinkVault Pro bookmarks and suggest a cleaner folder structure.',
    arguments: [],
  },
  {
    name: 'summarize_folder',
    description: 'Summarize all links and notes stored inside a specific LinkVault Pro folder.',
    arguments: [
      {
        name: 'folderId',
        description: 'Target folder ID (default: root)',
        required: false,
      },
    ],
  },
];

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcOk(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function rpcErr(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data !== undefined ? { code, message, data } : { code, message } };
}

function toolResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
}

function isValidHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

function executeTool(
  workspaceId: string,
  name: string,
  args: Record<string, unknown>
): { content: Array<{ type: string; text: string }>; isError: boolean } {
  const { vault } = getWorkspaceVault(workspaceId);

  switch (name) {
    case 'list_folders': {
      const parentFolderId = typeof args.parentFolderId === 'string' ? args.parentFolderId.trim() : '';
      if (parentFolderId) {
        const parent = findFolderById(vault, parentFolderId);
        if (!parent) {
          recordActivity(workspaceId, name, `Folder not found: ${parentFolderId}`, 'error');
          return toolResult({ error: `Folder "${parentFolderId}" not found` }, true);
        }
        const children = parent.folders.map((f) => ({
          id: f.id,
          name: f.name,
          folderCount: f.folders.length,
          itemCount: f.links.length,
          starred: Boolean(f.starred),
          color: f.color || null,
        }));
        recordActivity(workspaceId, name, `Listed ${children.length} subfolders of "${parent.name}"`);
        return toolResult({ parentId: parent.id, parentName: parent.name, folders: children });
      }
      const all = flattenFolders(vault);
      recordActivity(workspaceId, name, `Listed ${all.length} folders`);
      return toolResult({ total: all.length, folders: all });
    }

    case 'get_folder': {
      const folderId = typeof args.folderId === 'string' && args.folderId.trim() ? args.folderId.trim() : 'root';
      const folder = findFolderById(vault, folderId);
      if (!folder) {
        recordActivity(workspaceId, name, `Folder not found: ${folderId}`, 'error');
        return toolResult({ error: `Folder "${folderId}" not found` }, true);
      }
      const pathParts = getFolderPath(vault, folder.id) || [folder.name];
      recordActivity(workspaceId, name, `Read folder "${folder.name}" (${folder.links.length} items)`);
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
      if (!queryStr) {
        return toolResult({ error: 'query is required and must be a non-empty string' }, true);
      }
      const validTypes: LinkType[] = ['youtube', 'tiktok', 'instagram', 'general', 'note'];
      const typeFilter =
        typeof args.type === 'string' && validTypes.includes(args.type as LinkType)
          ? (args.type as LinkType)
          : undefined;
      const results = searchVaultTree(vault, queryStr, typeFilter);
      recordActivity(
        workspaceId,
        name,
        `Searched "${queryStr}" -> ${results.folders.length} folders, ${results.items.length} items`
      );
      return toolResult({
        query: queryStr,
        typeFilter: typeFilter || null,
        folderMatches: results.folders,
        itemMatches: results.items,
      });
    }

    case 'list_starred': {
      const starred = collectStarred(vault);
      recordActivity(
        workspaceId,
        name,
        `Listed ${starred.folders.length} starred folders, ${starred.items.length} starred items`
      );
      return toolResult(starred);
    }

    case 'create_folder': {
      const folderName = typeof args.name === 'string' ? args.name.trim().slice(0, 120) : '';
      if (!folderName) {
        return toolResult({ error: 'Folder name is required' }, true);
      }
      const parentId =
        typeof args.parentFolderId === 'string' && args.parentFolderId.trim()
          ? args.parentFolderId.trim()
          : 'root';
      const parent = findFolderById(vault, parentId);
      if (!parent) {
        recordActivity(workspaceId, name, `Parent folder not found: ${parentId}`, 'error');
        return toolResult({ error: `Parent folder "${parentId}" not found` }, true);
      }
      const color =
        typeof args.color === 'string' && isValidHexColor(args.color.trim()) ? args.color.trim() : undefined;

      const newFolder: VaultFolder = {
        id: generateId('folder'),
        name: folderName,
        folders: [],
        links: [],
        createdAt: Date.now(),
        ...(color ? { color } : {}),
      };
      parent.folders.push(newFolder);
      const saved = saveWorkspaceVault(workspaceId, vault, { force: true });
      recordActivity(workspaceId, name, `Created folder "${folderName}" in "${parent.name}"`);
      return toolResult({
        created: true,
        folder: newFolder,
        parentId: parent.id,
        vaultVersion: saved.version,
      });
    }

    case 'add_link': {
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 200) : '';
      const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
      if (!title || !rawUrl) {
        return toolResult({ error: 'Both title and url are required' }, true);
      }
      let safeUrl: string;
      try {
        safeUrl = sanitizeHttpUrl(rawUrl);
      } catch (err) {
        return toolResult({ error: err instanceof Error ? err.message : 'Invalid URL' }, true);
      }

      const folderId =
        typeof args.folderId === 'string' && args.folderId.trim() ? args.folderId.trim() : 'root';
      const target = findFolderById(vault, folderId);
      if (!target) {
        recordActivity(workspaceId, name, `Target folder not found: ${folderId}`, 'error');
        return toolResult({ error: `Folder "${folderId}" not found` }, true);
      }

      const linkType = detectLinkType(safeUrl);
      const newLink: VaultLinkItem = {
        id: generateId('item'),
        title,
        url: safeUrl,
        type: linkType,
        dateAdded: Date.now(),
        starred: Boolean(args.starred),
        previewImage: linkType === 'youtube' ? extractYoutubeThumbnail(safeUrl) : null,
      };
      target.links.push(newLink);
      const saved = saveWorkspaceVault(workspaceId, vault, { force: true });
      recordActivity(workspaceId, name, `Added link "${title}" to "${target.name}"`);
      return toolResult({
        created: true,
        item: newLink,
        folderId: target.id,
        vaultVersion: saved.version,
      });
    }

    case 'add_note': {
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 200) : '';
      const content = typeof args.content === 'string' ? args.content.slice(0, 20000) : '';
      if (!title || !content.trim()) {
        return toolResult({ error: 'Both title and content are required' }, true);
      }

      const folderId =
        typeof args.folderId === 'string' && args.folderId.trim() ? args.folderId.trim() : 'root';
      const target = findFolderById(vault, folderId);
      if (!target) {
        recordActivity(workspaceId, name, `Target folder not found: ${folderId}`, 'error');
        return toolResult({ error: `Folder "${folderId}" not found` }, true);
      }

      const newNote: VaultLinkItem = {
        id: generateId('note'),
        title,
        url: '',
        content,
        type: 'note',
        dateAdded: Date.now(),
        starred: Boolean(args.starred),
      };
      target.links.push(newNote);
      const saved = saveWorkspaceVault(workspaceId, vault, { force: true });
      recordActivity(workspaceId, name, `Added note "${title}" to "${target.name}"`);
      return toolResult({
        created: true,
        item: newNote,
        folderId: target.id,
        vaultVersion: saved.version,
      });
    }

    case 'update_item': {
      const itemId = typeof args.itemId === 'string' ? args.itemId.trim() : '';
      if (!itemId) {
        return toolResult({ error: 'itemId is required' }, true);
      }

      const patch: Partial<VaultLinkItem> = {};
      if (typeof args.title === 'string' && args.title.trim()) {
        patch.title = args.title.trim().slice(0, 200);
      }
      if (typeof args.url === 'string' && args.url.trim()) {
        try {
          const safeUrl = sanitizeHttpUrl(args.url);
          patch.url = safeUrl;
          patch.type = detectLinkType(safeUrl);
          if (patch.type === 'youtube') {
            patch.previewImage = extractYoutubeThumbnail(safeUrl);
          }
        } catch (err) {
          return toolResult({ error: err instanceof Error ? err.message : 'Invalid URL' }, true);
        }
      }
      if (typeof args.content === 'string') {
        patch.content = args.content.slice(0, 20000);
      }
      if (typeof args.starred === 'boolean') {
        patch.starred = args.starred;
      }

      const { tree, updated } = updateItemInTree(vault, itemId, patch);
      if (!updated) {
        recordActivity(workspaceId, name, `Item not found: ${itemId}`, 'error');
        return toolResult({ error: `Item "${itemId}" not found` }, true);
      }
      const saved = saveWorkspaceVault(workspaceId, tree, { force: true });
      recordActivity(workspaceId, name, `Updated item "${updated.title}"`);
      return toolResult({ updated: true, item: updated, vaultVersion: saved.version });
    }

    case 'delete_item': {
      const itemId = typeof args.itemId === 'string' ? args.itemId.trim() : '';
      if (!itemId) {
        return toolResult({ error: 'itemId is required' }, true);
      }
      const { tree, deleted } = deleteItemFromTree(vault, itemId);
      if (!deleted) {
        recordActivity(workspaceId, name, `Item not found: ${itemId}`, 'error');
        return toolResult({ error: `Item "${itemId}" not found` }, true);
      }
      const saved = saveWorkspaceVault(workspaceId, tree, { force: true });
      recordActivity(workspaceId, name, `Deleted item ${itemId}`);
      return toolResult({ deleted: true, itemId, vaultVersion: saved.version });
    }

    case 'delete_folder': {
      const folderId = typeof args.folderId === 'string' ? args.folderId.trim() : '';
      if (!folderId || folderId === 'root') {
        return toolResult({ error: 'A non-root folderId is required' }, true);
      }
      const { tree, deleted } = deleteFolderFromTree(vault, folderId);
      if (!deleted) {
        recordActivity(workspaceId, name, `Folder not found: ${folderId}`, 'error');
        return toolResult({ error: `Folder "${folderId}" not found` }, true);
      }
      const saved = saveWorkspaceVault(workspaceId, tree, { force: true });
      recordActivity(workspaceId, name, `Deleted folder ${folderId}`);
      return toolResult({ deleted: true, folderId, vaultVersion: saved.version });
    }

    default:
      return toolResult({ error: `Unknown tool: ${name}` }, true);
  }
}

export function handleSingleMcpMessage(
  workspaceId: string,
  msg: JsonRpcRequest
): JsonRpcResponse | null {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcErr(msg?.id ?? null, -32600, 'Invalid JSON-RPC 2.0 request');
  }

  const isNotification = msg.id === undefined;
  const id = msg.id ?? null;
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;

  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') {
    return null;
  }

  switch (msg.method) {
    case 'initialize': {
      const requestedVersion =
        typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION;
      const supportedVersions = ['2025-03-26', '2024-11-05'];
      const protocolVersion = supportedVersions.includes(requestedVersion)
        ? requestedVersion
        : MCP_PROTOCOL_VERSION;
      return rpcOk(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          'LinkVault Pro MCP Server gives AI agents read and write access to the user bookmarks, folders, and notes. Use list_folders or search_vault first to find folder IDs before adding links or notes.',
      });
    }

    case 'ping':
      return rpcOk(id, {});

    case 'tools/list':
      return rpcOk(id, { tools: MCP_TOOLS });

    case 'tools/call': {
      const toolName = typeof params.name === 'string' ? params.name : '';
      const toolArgs =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (!toolName) {
        return rpcErr(id, -32602, 'Missing required parameter: name');
      }
      const exists = MCP_TOOLS.some((t) => t.name === toolName);
      if (!exists) {
        return rpcErr(id, -32602, `Unknown tool: ${toolName}`);
      }
      const result = executeTool(workspaceId, toolName, toolArgs);
      return rpcOk(id, result);
    }

    case 'resources/list':
      return rpcOk(id, { resources: MCP_RESOURCES });

    case 'resources/read': {
      const uri = typeof params.uri === 'string' ? params.uri : '';
      const { vault, version, updatedAt } = getWorkspaceVault(workspaceId);
      if (uri === 'linkvault://tree') {
        recordActivity(workspaceId, 'resources/read', 'Read resource linkvault://tree');
        return rpcOk(id, {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ version, updatedAt, root: vault }, null, 2),
            },
          ],
        });
      }
      if (uri === 'linkvault://starred') {
        const starred = collectStarred(vault);
        recordActivity(workspaceId, 'resources/read', 'Read resource linkvault://starred');
        return rpcOk(id, {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(starred, null, 2),
            },
          ],
        });
      }
      if (uri === 'linkvault://summary') {
        const folders = flattenFolders(vault);
        const totalItems = folders.reduce((sum, f) => sum + f.itemCount, 0);
        recordActivity(workspaceId, 'resources/read', 'Read resource linkvault://summary');
        return rpcOk(id, {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  version,
                  updatedAt,
                  totalFolders: Math.max(0, folders.length - 1),
                  totalItems,
                  directories: folders,
                },
                null,
                2
              ),
            },
          ],
        });
      }
      return rpcErr(id, -32602, `Unknown resource URI: ${uri}`);
    }

    case 'prompts/list':
      return rpcOk(id, { prompts: MCP_PROMPTS });

    case 'prompts/get': {
      const promptName = typeof params.name === 'string' ? params.name : '';
      const promptArgs =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, string>)
          : {};
      if (promptName === 'organize_vault') {
        const { vault } = getWorkspaceVault(workspaceId);
        return rpcOk(id, {
          description: 'Analyze and organize LinkVault Pro folders and bookmarks',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please review my LinkVault Pro directory structure and suggest improvements or duplicates to clean up:\n\n${JSON.stringify(
                  flattenFolders(vault),
                  null,
                  2
                )}`,
              },
            },
          ],
        });
      }
      if (promptName === 'summarize_folder') {
        const folderId = promptArgs.folderId || 'root';
        const { vault } = getWorkspaceVault(workspaceId);
        const folder = findFolderById(vault, folderId);
        if (!folder) {
          return rpcErr(id, -32602, `Folder "${folderId}" not found`);
        }
        return rpcOk(id, {
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
        });
      }
      return rpcErr(id, -32602, `Unknown prompt: ${promptName}`);
    }

    default:
      if (isNotification) return null;
      return rpcErr(id, -32601, `Method not found: ${msg.method}`);
  }
}
