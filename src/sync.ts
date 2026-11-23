import { db } from './firebase';
import { collection, doc, getDocs, writeBatch, deleteDoc, setDoc } from 'firebase/firestore';

export interface LinkItem {
  id: string;
  title: string;
  url: string;
  content?: string;
  type: 'youtube' | 'tiktok' | 'instagram' | 'general' | 'note';
  dateAdded: number;
  starred?: boolean;
  previewImage?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  folders: Folder[];
  links: LinkItem[];
  starred?: boolean;
  color?: string;
  isPublic?: boolean;
  shareId?: string | null;
  type?: string;
  shortcutShareId?: string;
  shortcutOwnerName?: string;
  createdAt?: number;
}

export const flattenTree = (root: Folder, parentId: string | null = null): { folders: any[], items: any[] } => {
  let folders: any[] = [];
  let items: any[] = [];

  if (root.id !== 'root') {
    folders.push({
      id: root.id,
      name: root.name,
      parentId: parentId || 'root',
      createdAt: root.createdAt !== undefined ? root.createdAt : 0,
      color: root.color || null,
      isPublic: root.isPublic || false,
      shareId: root.shareId || null,
      starred: root.starred || false,
      type: root.type || null,
      shortcutShareId: root.shortcutShareId || null,
      shortcutOwnerName: root.shortcutOwnerName || null
    });
  }

  for (const link of root.links) {
    items.push({
      id: link.id,
      type: link.type,
      title: link.title,
      url: link.url || '',
      content: link.content || '',
      folderId: root.id,
      createdAt: link.dateAdded !== undefined ? link.dateAdded : 0,
      starred: link.starred || false,
      previewImage: link.previewImage || null
    });
  }

  for (const sub of root.folders) {
    const subFlattened = flattenTree(sub, root.id);
    folders = [...folders, ...subFlattened.folders];
    items = [...items, ...subFlattened.items];
  }

  return { folders, items };
};

const serializeFolderRecord = (f: any): string =>
  JSON.stringify({
    id: String(f.id ?? ''),
    name: String(f.name ?? ''),
    parentId: String(f.parentId || 'root'),
    createdAt: Number(f.createdAt ?? f.dateAdded ?? 0),
    color: f.color || null,
    isPublic: Boolean(f.isPublic),
    shareId: f.shareId || null,
    starred: Boolean(f.starred),
    type: f.type || null,
    shortcutShareId: f.shortcutShareId || null,
    shortcutOwnerName: f.shortcutOwnerName || null
  });

const serializeItemRecord = (item: any): string =>
  JSON.stringify({
    id: String(item.id ?? ''),
    type: String(item.type ?? 'general'),
    title: String(item.title ?? ''),
    url: String(item.url || ''),
    content: String(item.content || ''),
    folderId: String(item.folderId || 'root'),
    createdAt: Number(item.createdAt ?? item.dateAdded ?? 0),
    starred: Boolean(item.starred),
    previewImage: item.previewImage || null
  });

export const serializeVaultForDiff = (root: Folder): string => {
  const { folders, items } = flattenTree(root);
  const sortedFolders = folders
    .map(f => `${f.id}:${serializeFolderRecord(f)}`)
    .sort();
  const sortedItems = items
    .map(i => `${i.id}:${serializeItemRecord(i)}`)
    .sort();
  return JSON.stringify({ f: sortedFolders, i: sortedItems });
};

type SyncSnapshot = {
  folders: Map<string, string>;
  items: Map<string, string>;
};

const lastSyncedSnapshots = new Map<string, SyncSnapshot>();

export const clearSyncSnapshot = (userId?: string) => {
  if (userId) {
    lastSyncedSnapshots.delete(userId);
  } else {
    lastSyncedSnapshots.clear();
  }
};

export const buildTree = (folders: any[], items: any[]): Folder => {
  const root: Folder = {
    id: 'root',
    name: 'Root',
    folders: [],
    links: []
  };

  const folderMap = new Map<string, Folder>();
  folderMap.set('root', root);

  for (const f of folders) {
    folderMap.set(f.id, {
      id: f.id,
      name: f.name,
      folders: [],
      links: [],
      starred: f.starred,
      color: f.color,
      isPublic: f.isPublic,
      shareId: f.shareId,
      type: f.type,
      shortcutShareId: f.shortcutShareId,
      shortcutOwnerName: f.shortcutOwnerName,
      createdAt: f.createdAt || f.dateAdded || 0
    });
  }

  for (const f of folders) {
    const parentId = f.parentId || 'root';
    const parent = folderMap.get(parentId);
    const folder = folderMap.get(f.id);
    if (parent && folder) {
      parent.folders.push(folder);
    } else if (folder) {
      root.folders.push(folder);
    }
  }

  for (const item of items) {
    const folderId = item.folderId || 'root';
    const folder = folderMap.get(folderId);
    if (folder) {
      folder.links.push({
        id: item.id,
        title: item.title,
        url: item.url,
        content: item.content,
        type: item.type,
        dateAdded: item.createdAt,
        starred: item.starred,
        previewImage: item.previewImage || null
      });
    }
  }

  return root;
};

export const syncToFirestore = async (userId: string, rootFolder: Folder) => {
  const { folders, items } = flattenTree(rootFolder);

  let baseline = lastSyncedSnapshots.get(userId);

  if (!baseline) {
    const foldersRef = collection(db, `users/${userId}/folders`);
    const itemsRef = collection(db, `users/${userId}/items`);

    const [existingFoldersSnapshot, existingItemsSnapshot] = await Promise.all([
      getDocs(foldersRef),
      getDocs(itemsRef)
    ]);

    const folderMap = new Map<string, string>();
    for (const d of existingFoldersSnapshot.docs) {
      folderMap.set(d.id, serializeFolderRecord({ id: d.id, ...d.data() }));
    }

    const itemMap = new Map<string, string>();
    for (const d of existingItemsSnapshot.docs) {
      itemMap.set(d.id, serializeItemRecord({ id: d.id, ...d.data() }));
    }

    baseline = { folders: folderMap, items: itemMap };
    lastSyncedSnapshots.set(userId, baseline);
  }

  const nextFolderMap = new Map<string, string>();
  const nextItemMap = new Map<string, string>();

  let batch = writeBatch(db);
  let opCount = 0;

  const commitBatch = async () => {
    if (opCount > 0) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
    }
  };

  for (const f of folders) {
    const serialized = serializeFolderRecord(f);
    nextFolderMap.set(f.id, serialized);
    if (baseline.folders.get(f.id) !== serialized) {
      const docRef = doc(db, `users/${userId}/folders/${f.id}`);
      batch.set(docRef, f);
      opCount++;
      if (opCount >= 450) {
        await commitBatch();
      }
    }
  }

  for (const item of items) {
    const serialized = serializeItemRecord(item);
    nextItemMap.set(item.id, serialized);
    if (baseline.items.get(item.id) !== serialized) {
      const docRef = doc(db, `users/${userId}/items/${item.id}`);
      batch.set(docRef, item);
      opCount++;
      if (opCount >= 450) {
        await commitBatch();
      }
    }
  }

  for (const existingId of baseline.folders.keys()) {
    if (!nextFolderMap.has(existingId)) {
      batch.delete(doc(db, `users/${userId}/folders/${existingId}`));
      opCount++;
      if (opCount >= 450) {
        await commitBatch();
      }
    }
  }

  for (const existingId of baseline.items.keys()) {
    if (!nextItemMap.has(existingId)) {
      batch.delete(doc(db, `users/${userId}/items/${existingId}`));
      opCount++;
      if (opCount >= 450) {
        await commitBatch();
      }
    }
  }

  if (opCount === 0) {
    return;
  }

  await commitBatch();
  lastSyncedSnapshots.set(userId, { folders: nextFolderMap, items: nextItemMap });
};

export const fetchFromFirestore = async (userId: string): Promise<Folder> => {
  const foldersRef = collection(db, `users/${userId}/folders`);
  const itemsRef = collection(db, `users/${userId}/items`);
  
  const [foldersSnapshot, itemsSnapshot] = await Promise.all([
    getDocs(foldersRef),
    getDocs(itemsRef)
  ]);
  
  const folders = foldersSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  const items = itemsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

  // Cache baseline snapshot immediately so initial load never triggers redundant writes
  const folderMap = new Map<string, string>();
  for (const f of folders) {
    folderMap.set(f.id, serializeFolderRecord(f));
  }
  const itemMap = new Map<string, string>();
  for (const item of items) {
    itemMap.set(item.id, serializeItemRecord(item));
  }
  lastSyncedSnapshots.set(userId, { folders: folderMap, items: itemMap });
  
  return buildTree(folders, items);
};
