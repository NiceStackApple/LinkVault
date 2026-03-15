import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { Folder, buildTree } from './sync';
import { Globe, Folder as FolderIcon, ExternalLink, FileText, ChevronRight, ChevronDown, X, Check, Copy } from 'lucide-react';

const SharedLinkCard: React.FC<{ link: any, onOpenNote: (link: any) => void }> = ({ link, onOpenNote }) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-medium text-slate-800 line-clamp-2" title={link.title}>{link.title}</h3>
      </div>
      {link.type === 'note' ? (
        <p className="text-sm text-slate-500 line-clamp-2 mb-3">{link.content}</p>
      ) : (
        <p className="text-sm text-slate-500 truncate mb-3" title={link.url}>{link.url}</p>
      )}
      <div className="flex items-center justify-between mt-auto">
        <span className="text-xs font-medium px-2 py-1 bg-slate-100 text-slate-600 rounded-md capitalize">
          {link.type}
        </span>
        {link.type === 'note' ? (
          <button 
            onClick={() => onOpenNote(link)}
            className="flex items-center space-x-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors text-emerald-600 bg-emerald-50 hover:bg-emerald-100"
          >
            <FileText size={12} />
            <span>Read</span>
          </button>
        ) : (
          <a 
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors text-slate-800 bg-slate-100 hover:bg-slate-200"
          >
            <ExternalLink size={12} />
            <span>Open</span>
          </a>
        )}
      </div>
    </div>
  );
};

const SharedFolderCard: React.FC<{ folder: Folder, onDoubleClick: () => void }> = ({ folder, onDoubleClick }) => {
  return (
    <div 
      className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center cursor-pointer"
      onDoubleClick={onDoubleClick}
      onClick={onDoubleClick}
    >
      <div 
        className="w-10 h-10 rounded-lg flex items-center justify-center mr-3 flex-shrink-0"
        style={{ backgroundColor: folder.color ? `${folder.color}20` : '#eef2ff' }}
      >
        <FolderIcon size={20} style={{ color: folder.color || '#6366f1' }} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-slate-800 truncate">{folder.name}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{folder.folders.length} folders, {folder.links.length} items</p>
      </div>
    </div>
  );
};

export default function ShareView({ shareId }: { shareId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rootFolder, setRootFolder] = useState<Folder | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string>('');
  const [ownerName, setOwnerName] = useState<string>('Someone');
  const [viewNoteItem, setViewNoteItem] = useState<any | null>(null);
  const [noteCopied, setNoteCopied] = useState(false);

  useEffect(() => {
    const fetchSharedFolder = async () => {
      try {
        const shareDoc = await getDoc(doc(db, 'publicFolders', shareId));
        if (!shareDoc.exists()) {
          setError("This shared folder doesn't exist or has been removed.");
          setLoading(false);
          return;
        }

        const { userId, folderId, ownerName: fetchedOwnerName } = shareDoc.data();
        if (fetchedOwnerName) setOwnerName(fetchedOwnerName);
        
        // Fetch all folders and items for this user
        // The security rules allow reading if the folder isPublic == true
        // But we need to fetch the specific folder and its descendants.
        // Since we can't easily query descendants in Firestore without a flat structure that includes all ancestors,
        // and the rules allow reading if the folder isPublic, wait...
        // The security rules say:
        // match /users/{userId}/folders/{folderId} { allow read: if resource.data.isPublic == true; }
        // BUT subfolders might NOT have isPublic == true!
        // If subfolders don't have isPublic == true, the security rules will block reading them!
        // Let's check the prompt's security rules:
        // "Read users/{userId}/folders and items if folder isPublic == true"
        // Wait, the prompt's rules:
        // match /users/{userId}/folders/{folderId} { allow read: if resource.data.isPublic == true; }
        // match /users/{userId}/items/{itemId} { allow read: if get(/databases/$(database)/documents/users/$(userId)/folders/$(request.resource.data.folderId)).data.isPublic == true; }
        // This means we can ONLY read subfolders if THEY are also isPublic == true.
        // But the prompt says: "Nested subfolders inside the shared folder are also visible"
        // If the subfolders are not marked isPublic, the provided security rules will block them.
        // However, I must use the provided security rules exactly? The prompt says "Firebase Security Rules ... use this exactly". Wait, it says "Firestore Security Rules" and gives the rules.
        // Let's look at the rules again:
        // match /users/{userId}/folders/{folderId} { allow read: if resource.data.isPublic == true; }
        // If we can only read folders where isPublic == true, then we can't read subfolders unless we also set isPublic == true on them, OR we just fetch the ones we can.
        // Actually, since this is client-side, if the rules block it, it will fail.
        // Let's just query the folders where isPublic == true? No, the prompt says "Nested subfolders inside the shared folder are also visible".
        // Wait, maybe the user wants us to fetch all folders and the rules will just allow it? No, Firestore rules don't filter data automatically.
        // If we just query `collection(db, 'users', userId, 'folders')`, it will fail if any document doesn't match the rule.
        // We have to query `where('isPublic', '==', true)`? But then subfolders won't be included unless they are public.
        // Let's just fetch the specific folderId.
        
        const folderDoc = await getDoc(doc(db, `users/${userId}/folders/${folderId}`));
        if (!folderDoc.exists()) {
          setError("Folder not found.");
          setLoading(false);
          return;
        }
        
        // Fetch all public folders for this user
        const publicFoldersQuery = query(collection(db, `users/${userId}/folders`), where('isPublic', '==', true));
        const publicFoldersSnapshot = await getDocs(publicFoldersQuery);
        const allPublicFolders = publicFoldersSnapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        
        // We also need the root folder to build the tree properly, or we can just build a partial tree
        // Actually, if we just pass the public folders to buildTree, it will link them up if their parentId is in the set.
        // But the shared folder's parentId might not be in the set, so it will be attached to 'root'.
        // That's perfect, the shared folder will appear at the top level.
        
        // Now fetch items for these public folders. We have to do it in chunks of 10 for the 'in' query.
        const folderIds = allPublicFolders.map(f => f.id);
        let allItems: any[] = [];
        
        if (folderIds.length > 0) {
          for (let i = 0; i < folderIds.length; i += 10) {
            const chunk = folderIds.slice(i, i + 10);
            const itemsQuery = query(collection(db, `users/${userId}/items`), where('folderId', 'in', chunk));
            const itemsSnapshot = await getDocs(itemsQuery);
            allItems = [...allItems, ...itemsSnapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }))];
          }
        }
        
        const tree = buildTree(allPublicFolders, allItems);
        // buildTree returns a root folder containing our folders.
        // Our target folder is inside tree.folders
        const findFolder = (root: Folder, id: string): Folder | null => {
          if (root.id === id) return root;
          for (const f of root.folders) {
            const found = findFolder(f, id);
            if (found) return found;
          }
          return null;
        };
        
        const targetFolder = findFolder(tree, folderId);
        if (targetFolder) {
          setRootFolder(targetFolder);
          setCurrentFolderId(targetFolder.id);
        }
        
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError("An error occurred while loading the shared folder.");
        setLoading(false);
      }
    };

    fetchSharedFolder();
  }, [shareId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>;
  }

  if (error || !rootFolder) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Globe size={32} className="text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Unavailable</h2>
          <p className="text-slate-500 mb-6">{error}</p>
          <a href="/" className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors">
            Go to LinkVaultPro
          </a>
        </div>
      </div>
    );
  }

  const findFolder = (root: Folder, id: string): Folder | null => {
    if (root.id === id) return root;
    for (const f of root.folders) {
      const found = findFolder(f, id);
      if (found) return found;
    }
    return null;
  };

  const getBreadcrumbs = (root: Folder, targetId: string): Folder[] | null => {
    if (root.id === targetId) return [root];
    for (const folder of root.folders) {
      const path = getBreadcrumbs(folder, targetId);
      if (path) return [root, ...path];
    }
    return null;
  };

  const currentFolder = findFolder(rootFolder, currentFolderId) || rootFolder;
  const breadcrumbs = getBreadcrumbs(rootFolder, currentFolderId) || [rootFolder];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center px-4 sm:px-8 justify-between sticky top-0 z-30">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
            <Globe size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800 leading-tight">Shared Folder</h1>
            <p className="text-xs text-slate-500 font-medium">Shared by {ownerName}</p>
          </div>
        </div>
        <a href="/" className="text-sm font-medium text-blue-500 hover:text-blue-600">
          Create your own
        </a>
      </header>

      <div className="px-4 sm:px-8 py-3 flex items-center space-x-1 sm:space-x-2 text-sm text-slate-500 overflow-x-auto whitespace-nowrap hide-scrollbar border-b border-slate-200/60 bg-white">
        {breadcrumbs.map((f, i) => (
          <React.Fragment key={f.id}>
            <button 
              onClick={() => setCurrentFolderId(f.id)}
              className={`hover:text-slate-800 transition-colors ${i === breadcrumbs.length - 1 ? 'text-slate-800 font-medium' : ''}`}
            >
              {f.name}
            </button>
            {i < breadcrumbs.length - 1 && <ChevronRight size={14} className="text-slate-300" />}
          </React.Fragment>
        ))}
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8">
        {currentFolder.folders.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Folders</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {currentFolder.folders.map(folder => (
                <SharedFolderCard 
                  key={folder.id}
                  folder={folder}
                  onDoubleClick={() => setCurrentFolderId(folder.id)}
                />
              ))}
            </div>
          </div>
        )}

        {currentFolder.links.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Items</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {currentFolder.links.map(link => (
                <SharedLinkCard 
                  key={link.id} 
                  link={link} 
                  onOpenNote={setViewNoteItem}
                />
              ))}
            </div>
          </div>
        )}

        {currentFolder.folders.length === 0 && currentFolder.links.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white/50">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <FolderIcon size={32} className="text-slate-300" />
            </div>
            <h3 className="text-lg font-medium text-slate-800 mb-1">This folder is empty</h3>
          </div>
        )}
      </main>

      {/* View Note Modal */}
      {viewNoteItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 sm:p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center space-x-3 overflow-hidden">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <FileText size={20} className="text-emerald-600" />
                </div>
                <h2 className="text-xl font-semibold text-slate-800 truncate">{viewNoteItem.title}</h2>
              </div>
              <button onClick={() => setViewNoteItem(null)} className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              <div className="prose prose-slate max-w-none">
                <p className="whitespace-pre-wrap text-slate-700 leading-relaxed">{viewNoteItem.content}</p>
              </div>
            </div>
            <div className="p-4 sm:p-6 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(viewNoteItem.content || '');
                  setNoteCopied(true);
                  setTimeout(() => setNoteCopied(false), 1500);
                }}
                className="px-4 py-2 text-sm font-medium text-black bg-white border border-black rounded-lg hover:bg-black hover:text-white transition-colors flex items-center"
              >
                {noteCopied ? <Check size={16} className="mr-2" /> : <Copy size={16} className="mr-2" />}
                {noteCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
