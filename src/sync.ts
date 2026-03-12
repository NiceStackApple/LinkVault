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
}

export const flattenTree = (root: Folder, parentId: string | null = null): { folders: any[], items: any[] } => {
  let folders: any[] = [];
  let items: any[] = [];

  if (root.id !== 'root') {
    folders.push({
      id: root.id,
      name: root.name,
      parentId: parentId || 'root',
      createdAt: Date.now(),
      color: root.color || null,
      isPublic: root.isPublic || false,
      shareId: root.shareId || null,
      starred: root.starred || false
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
      createdAt: link.dateAdded,
      starred: link.starred || false
    });
  }

  for (const sub of root.folders) {
    const subFlattened = flattenTree(sub, root.id);
    folders = [...folders, ...subFlattened.folders];
    items = [...items, ...subFlattened.items];
  }

  return { folders, items };
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
      shareId: f.shareId
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
        starred: item.starred
      });
    }
  }

  return root;
};

export const syncToFirestore = async (userId: string, rootFolder: Folder) => {
  const { folders, items } = flattenTree(rootFolder);
  
  const foldersRef = collection(db, `users/${userId}/folders`);
  const itemsRef = collection(db, `users/${userId}/items`);
  
  const existingFoldersSnapshot = await getDocs(foldersRef);
  const existingItemsSnapshot = await getDocs(itemsRef);
  
  const existingFolderIds = new Set(existingFoldersSnapshot.docs.map(d => d.id));
  const existingItemIds = new Set(existingItemsSnapshot.docs.map(d => d.id));
  
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
    const docRef = doc(db, `users/${userId}/folders/${f.id}`);
    batch.set(docRef, f);
    existingFolderIds.delete(f.id);
    opCount++;
    if (opCount >= 450) {
      await commitBatch();
    }
  }
  
  for (const item of items) {
    const docRef = doc(db, `users/${userId}/items/${item.id}`);
    batch.set(docRef, item);
    existingItemIds.delete(item.id);
    opCount++;
    if (opCount >= 450) {
      await commitBatch();
    }
  }
  
  for (const id of existingFolderIds) {
    batch.delete(doc(db, `users/${userId}/folders/${id}`));
    opCount++;
    if (opCount >= 450) {
      await commitBatch();
    }
  }
  
  for (const id of existingItemIds) {
    batch.delete(doc(db, `users/${userId}/items/${id}`));
    opCount++;
    if (opCount >= 450) {
      await commitBatch();
    }
  }
  
  await commitBatch();
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
  
  return buildTree(folders, items);
};
