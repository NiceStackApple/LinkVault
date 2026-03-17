import React, { useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { doc, getDoc, collection, getDocs, query, where, setDoc, onSnapshot } from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Folder, buildTree } from './sync';
import { Globe, Folder as FolderIcon, ExternalLink, FileText, ChevronRight, ChevronDown, X, Check, Copy, ArrowUp, Link as LinkIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { faviconBase64 } from './faviconBase64';

const SharedLinkCard: React.FC<{ link: any, onOpenNote: (link: any) => void }> = ({ link, onOpenNote }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(link.type === 'note' ? (link.content || '') : (link.url || ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col">
      {link.previewImage && (
        <div className="h-32 w-full bg-slate-100 border-b border-slate-100 overflow-hidden">
          <img src={link.previewImage} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        </div>
      )}
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-medium text-slate-800 line-clamp-2" title={link.title}>{link.title}</h3>
        </div>
        {link.type === 'note' ? (
          <p className="text-sm text-slate-500 line-clamp-2 mb-3">{link.content}</p>
        ) : (
          <p className="text-sm text-slate-500 truncate mb-3" title={link.url}>{link.url}</p>
        )}
        <div className="flex items-center justify-between mt-auto pt-2">
          <span className="text-xs font-medium px-2 py-1 bg-slate-100 text-slate-600 rounded-md capitalize">
            {link.type}
          </span>
          <div className="flex space-x-2">
            <button 
              onClick={handleCopy}
              className="flex items-center space-x-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors text-slate-800 bg-slate-100 hover:bg-slate-200"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
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

const UpFolderCard: React.FC<{ onClick: () => void, parentName: string }> = ({ onClick, parentName }) => {
  return (
    <div 
      className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center cursor-pointer"
      onClick={onClick}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center mr-3 flex-shrink-0 bg-slate-100 text-slate-500">
        <ArrowUp size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-slate-800 truncate">..</h3>
        <p className="text-xs text-slate-500 mt-0.5">Go up to {parentName}</p>
      </div>
    </div>
  );
};

export default function ShareView({ 
  shareId, 
  isShortcutView = false, 
  onRemoveShortcut, 
  onGoBackToApp,
  onSaveSuccess
}: { 
  shareId: string; 
  isShortcutView?: boolean; 
  onRemoveShortcut?: () => void; 
  onGoBackToApp?: () => void; 
  onSaveSuccess?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rootFolder, setRootFolder] = useState<Folder | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string>('');
  const [ownerName, setOwnerName] = useState<string>('Someone');
  const [ownerPhotoUrl, setOwnerPhotoUrl] = useState<string | null>(null);
  const [viewNoteItem, setViewNoteItem] = useState<any | null>(null);
  const [noteCopied, setNoteCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  const checkIfSaved = async () => {
    if (!currentUser || !shareId) return setIsSaved(false);
    
    try {
      const q = query(
        collection(db, `users/${currentUser.uid}/folders`),
        where("type", "==", "shortcut"),
        where("shortcutShareId", "==", shareId)
      );
      const snapshot = await getDocs(q);
      setIsSaved(!snapshot.empty);
    } catch (e) {
      console.error("Error checking saved state", e);
    }
  };

  useEffect(() => {
    checkIfSaved();

    const handleFocus = () => {
      checkIfSaved();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkIfSaved();
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser, shareId]);

  useEffect(() => {
    const fetchSharedFolder = async () => {
      try {
        const shareDoc = await getDoc(doc(db, 'publicFolders', shareId));
        if (!shareDoc.exists()) {
          setError("This shared folder doesn't exist or has been removed.");
          setLoading(false);
          return;
        }

        const { userId, folderId, ownerName: fetchedOwnerName, ownerPhotoUrl: fetchedPhotoUrl } = shareDoc.data();
        if (fetchedOwnerName) setOwnerName(fetchedOwnerName);
        if (fetchedPhotoUrl) setOwnerPhotoUrl(fetchedPhotoUrl);
        
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

  useEffect(() => {
    if (rootFolder && ownerName) {
      document.title = `${rootFolder.name} — LinkVaultPro`;
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        metaDescription.setAttribute("content", `Shared folder by ${ownerName} on LinkVaultPro`);
      }
    }
  }, [rootFolder, ownerName]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        <div className="bg-slate-200 animate-pulse h-32 w-full border-b border-slate-300"></div>
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8">
          <div className="h-6 w-32 bg-slate-200 animate-pulse rounded mb-4"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-slate-200 animate-pulse rounded-xl"></div>)}
          </div>
          <div className="h-6 w-32 bg-slate-200 animate-pulse rounded mb-4"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-32 bg-slate-200 animate-pulse rounded-xl"></div>)}
          </div>
        </main>
      </div>
    );
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
          {isShortcutView && onRemoveShortcut ? (
            <button 
              onClick={onRemoveShortcut}
              className="px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors"
            >
              Remove shortcut
            </button>
          ) : (
            <a href="/" className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors">
              Go to LinkVaultPro
            </a>
          )}
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

  const handleSaveToLVP = async () => {
    if (!auth.currentUser) {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.error("Sign in failed", err);
        return;
      }
    }

    if (!auth.currentUser || !rootFolder) return;

    setIsSaving(true);
    try {
      const userUid = auth.currentUser.uid;

      // Check if shortcut already exists
      const existingQuery = query(
        collection(db, `users/${userUid}/folders`), 
        where('type', '==', 'shortcut'),
        where('shortcutShareId', '==', shareId)
      );
      const existingSnapshot = await getDocs(existingQuery);
      
      if (!existingSnapshot.empty) {
        await checkIfSaved();
        setIsSaving(false);
        return;
      }

      const newFolderId = 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

      await setDoc(doc(db, `users/${userUid}/folders/${newFolderId}`), {
        name: rootFolder.name,
        parentId: 'root',
        color: rootFolder.color || null,
        isPublic: false,
        dateAdded: Date.now(),
        type: 'shortcut',
        shortcutShareId: shareId,
        shortcutOwnerName: ownerName
      });

      await checkIfSaved();
      if (onSaveSuccess) {
        onSaveSuccess();
      } else {
        showToast("Shortcut added to your Root folder");
      }
    } catch (err) {
      console.error("Failed to save folder", err);
      alert("Failed to save folder to your account.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`${isShortcutView ? 'h-full' : 'min-h-screen'} bg-slate-50 flex flex-col font-sans text-slate-900`}>
      {isShortcutView && (
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2 flex items-center justify-between text-sm text-indigo-700">
          <div className="flex items-center">
            <LinkIcon size={16} className="mr-2" />
            <span>Shortcut to {ownerName}'s folder</span>
          </div>
          <div className="flex items-center space-x-3">
            <a href={`#/share/${shareId}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-indigo-900 flex items-center">
              View original <ChevronRight size={14} className="ml-0.5" />
            </a>
            {onGoBackToApp && (
              <button onClick={onGoBackToApp} className="font-medium text-slate-600 hover:text-slate-900 bg-white px-2 py-1 rounded border border-slate-200 shadow-sm">
                Close
              </button>
            )}
          </div>
        </div>
      )}
      <div className={`bg-gradient-to-b from-slate-100 to-slate-50 border-b border-slate-200 px-4 sm:px-8 ${isShortcutView ? 'py-3' : 'py-5'}`}>
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            {ownerPhotoUrl ? (
              <img src={ownerPhotoUrl} alt={ownerName} className="w-12 h-12 rounded-full border-2 border-white shadow-sm" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xl border-2 border-white shadow-sm">
                {ownerName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-1">{rootFolder.name}</h1>
              <div className="flex items-center text-sm text-slate-600 gap-2">
                <span>Shared by @{ownerName}</span>
                <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                <span>{rootFolder.folders.length} folders • {rootFolder.links.length} items</span>
              </div>
            </div>
          </div>
          {!isShortcutView && (
            <button 
              onClick={handleSaveToLVP}
              disabled={isSaving || isSaved}
              className="px-5 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-70"
            >
              {isSaved ? <Check size={18} /> : (isSaving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <span>+</span>)}
              {isSaved ? 'Already saved' : 'Save to my LVP'}
            </button>
          )}
        </div>
      </div>

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
        {(currentFolder.folders.length > 0 || currentFolderId !== rootFolder.id || isShortcutView) && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Folders</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {currentFolderId !== rootFolder.id ? (
                <UpFolderCard 
                  onClick={() => {
                    const parent = breadcrumbs[breadcrumbs.length - 2];
                    if (parent) setCurrentFolderId(parent.id);
                  }} 
                  parentName={breadcrumbs[breadcrumbs.length - 2]?.name || 'parent'}
                />
              ) : (
                isShortcutView && onGoBackToApp && (
                  <UpFolderCard 
                    onClick={onGoBackToApp} 
                    parentName="your folders"
                  />
                )
              )}
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

      {/* Branding Footer */}
      {!isShortcutView && (
        <footer className="bg-slate-900 text-white py-4 px-4 sm:px-8 mt-auto">
          <div className="max-w-7xl mx-auto flex items-center justify-between text-sm">
            <div className="text-slate-400">
              Powered by <span className="font-bold text-white">LinkVault<span className="font-normal">Pro</span></span>
            </div>
            <a 
              href="https://linkvaultpro.vercel.app" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-300 hover:text-white transition-colors flex items-center gap-1"
            >
              Try it free <ChevronRight size={14} />
            </a>
          </div>
        </footer>
      )}

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

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-6 right-6 bg-slate-800 text-white px-4 py-3 rounded-lg shadow-xl flex items-center space-x-3 z-50"
          >
            <div className="bg-emerald-500/20 p-1 rounded-full">
              <Check size={16} className="text-emerald-400" />
            </div>
            <span className="font-medium text-sm">{toastMessage}</span>
            <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white ml-2">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
