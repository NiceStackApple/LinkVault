import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { faviconBase64 } from './faviconBase64';
import { 
  Folder as FolderIcon, 
  ChevronRight, 
  ChevronDown, 
  Plus, 
  Link as LinkIcon, 
  Trash2, 
  Download, 
  Upload,
  Copy,
  Youtube,
  Instagram,
  Globe,
  Video,
  Menu,
  X,
  Check,
  MoreVertical,
  Star,
  ExternalLink,
  Edit2,
  AlertTriangle,
  Search,
  Square,
  FolderInput,
  FileText,
  AlignLeft,
  Scissors,
  ClipboardPaste,
  Lock,
  Clock,
  Settings,
  LogOut,
  RefreshCw,
  ArrowUp
} from 'lucide-react';

import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User, updateProfile, deleteUser } from 'firebase/auth';
import { doc, setDoc, deleteDoc, collection, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { syncToFirestore, fetchFromFirestore } from './sync';
import ShareView from './ShareView';
import { motion, AnimatePresence } from 'motion/react';

type LinkType = 'youtube' | 'tiktok' | 'instagram' | 'general' | 'note';

interface LinkItem {
  id: string;
  title: string;
  url: string;
  content?: string;
  type: LinkType;
  dateAdded: number;
  starred?: boolean;
  previewImage?: string | null;
}

interface Folder {
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
}

const FOLDER_COLORS = [
  '#64748b', '#ef4444', '#f97316', '#f59e0b', '#22c55e', 
  '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'
];

const INITIAL_STATE: Folder = {
  id: 'root',
  name: 'Root',
  folders: [],
  links: []
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15);
};

const formatTimeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
};

const detectLinkType = (url: string): LinkType => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  if (lowerUrl.includes('tiktok.com')) return 'tiktok';
  if (lowerUrl.includes('instagram.com')) return 'instagram';
  return 'general';
};

async function fetchLinkPreview(url: string): Promise<string | null> {
  try {
    // Special case: YouTube (direct CDN, no need for allorigins)
    const ytMatch = url.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (ytMatch) {
      return `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
    }

    // All other URLs: use allorigins to bypass CORS
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    
    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    const data = await response.json();
    
    if (!data.contents) return null;

    // Parse HTML to find og:image
    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, 'text/html');
    
    let ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      || doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')
      || null;

    if (ogImage && !/^https?:\/\//i.test(ogImage)) {
      try {
        const origin = new URL(url).origin;
        ogImage = new URL(ogImage, origin).href;
      } catch (e) {
        // Ignore invalid URLs
      }
    }

    return ogImage || null;
  } catch (error) {
    console.warn('Preview fetch failed for:', url);
    return null;
  }
}

const updateFolder = (root: Folder, targetId: string, updater: (f: Folder) => Folder): Folder => {
  if (root.id === targetId) {
    return updater(root);
  }
  return {
    ...root,
    folders: root.folders.map(f => updateFolder(f, targetId, updater))
  };
};

const deleteFolder = (root: Folder, targetId: string): Folder => {
  return {
    ...root,
    folders: root.folders.filter(f => f.id !== targetId).map(f => deleteFolder(f, targetId))
  };
};

const findFolder = (root: Folder, id: string): Folder | null => {
  if (root.id === id) return root;
  for (const folder of root.folders) {
    const found = findFolder(folder, id);
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

const updateLinkInTree = (root: Folder, updatedLink: LinkItem): Folder => {
  return {
    ...root,
    links: root.links.map(l => l.id === updatedLink.id ? updatedLink : l),
    folders: root.folders.map(f => updateLinkInTree(f, updatedLink))
  };
};

const deleteLinkInTree = (root: Folder, linkId: string): Folder => {
  return {
    ...root,
    links: root.links.filter(l => l.id !== linkId),
    folders: root.folders.map(f => deleteLinkInTree(f, linkId))
  };
};

const getTopLevelSelectedItems = (root: Folder, ids: string[]): { folders: Folder[], links: LinkItem[] } => {
  let folders: Folder[] = [];
  let links: LinkItem[] = [];
  
  for (const l of root.links) {
    if (ids.includes(l.id)) links.push(l);
  }
  
  for (const f of root.folders) {
    if (ids.includes(f.id)) {
      folders.push(f);
    } else {
      const childItems = getTopLevelSelectedItems(f, ids);
      folders = [...folders, ...childItems.folders];
      links = [...links, ...childItems.links];
    }
  }
  
  return { folders, links };
};

const removeItemsByIds = (root: Folder, ids: string[]): Folder => {
  return {
    ...root,
    links: root.links.filter(l => !ids.includes(l.id)),
    folders: root.folders.filter(f => !ids.includes(f.id)).map(f => removeItemsByIds(f, ids))
  };
};

const addItemsToFolder = (root: Folder, targetId: string, items: { folders: Folder[], links: LinkItem[] }): Folder => {
  if (root.id === targetId) {
    return { 
      ...root, 
      links: [...root.links, ...items.links],
      folders: [...root.folders, ...items.folders]
    };
  }
  return {
    ...root,
    folders: root.folders.map(f => addItemsToFolder(f, targetId, items))
  };
};

const updateItemsInTreeBulk = (root: Folder, ids: string[], folderUpdater: (f: Folder) => Folder, linkUpdater: (l: LinkItem) => LinkItem): Folder => {
  const updatedRoot = ids.includes(root.id) ? folderUpdater(root) : root;
  return {
    ...updatedRoot,
    links: updatedRoot.links.map(l => ids.includes(l.id) ? linkUpdater(l) : l),
    folders: updatedRoot.folders.map(f => updateItemsInTreeBulk(f, ids, folderUpdater, linkUpdater))
  };
};

// --- Components ---

const EditableFolderName = ({ name, onSave, isEditing, setIsEditing }: { name: string, onSave: (newName: string) => void, isEditing: boolean, setIsEditing: (v: boolean) => void }) => {
  const [editName, setEditName] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditName(name);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isEditing, name]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={editName}
        onChange={e => setEditName(e.target.value)}
        onBlur={() => {
          setIsEditing(false);
          if (editName.trim() && editName !== name) onSave(editName.trim());
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            setIsEditing(false);
            if (editName.trim() && editName !== name) onSave(editName.trim());
          } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditName(name);
          }
        }}
        className="w-full bg-white/50 border border-slate-300 rounded px-1 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500/50"
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <h3 
      className="font-medium text-slate-800 truncate transition-colors"
    >
      {name}
    </h3>
  );
};

const EditableLinkTitle = ({ title, onSave, isEditing, setIsEditing }: { title: string, onSave: (newTitle: string) => void, isEditing: boolean, setIsEditing: (v: boolean) => void }) => {
  const [editTitle, setEditTitle] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditTitle(title);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isEditing, title]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={editTitle}
        onChange={e => setEditTitle(e.target.value)}
        onBlur={() => {
          setIsEditing(false);
          if (editTitle.trim() && editTitle !== title) onSave(editTitle.trim());
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            setIsEditing(false);
            if (editTitle.trim() && editTitle !== title) onSave(editTitle.trim());
          } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditTitle(title);
          }
        }}
        className="w-full bg-white/50 border border-slate-300 rounded px-1 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500/50"
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <h3 
      className="font-semibold text-slate-800 truncate transition-colors text-sm"
    >
      {title}
    </h3>
  );
};

const LinkCard: React.FC<{ 
  link: LinkItem, 
  onUpdate: (l: LinkItem) => void, 
  onDelete: (id: string) => void,
  isSelected?: boolean,
  onClick?: (e: React.MouseEvent) => void,
  onDoubleClick?: (e: React.MouseEvent) => void,
  onOpenNote?: (l: LinkItem) => void,
  onOpen?: (l: LinkItem) => void
}> = ({ link, onUpdate, onDelete, isSelected, onClick, onDoubleClick, onOpenNote, onOpen }) => {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  const getFavicon = (url: string) => {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch {
      return null;
    }
  };

  const getYoutubeThumbnail = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    const id = (match && match[2].length === 11) ? match[2] : null;
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
  };

  const Icon = () => {
    switch(link.type) {
      case 'youtube': return <Youtube size={16} className="text-red-500" />;
      case 'instagram': return <Instagram size={16} className="text-pink-500" />;
      case 'tiktok': return <Video size={16} className="text-slate-800" />;
      case 'note': return <FileText size={16} className="text-emerald-500" />;
      default: return <Globe size={16} className="text-blue-500" />;
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (onDoubleClick) {
      onDoubleClick(e);
    } else {
      if (onOpen) onOpen(link);
      if (link.type === 'note' && onOpenNote) {
        onOpenNote(link);
      } else if (link.url) {
        window.open(link.url, '_blank');
      }
    }
  };

  return (
    <div 
      className={`group bg-white/60 backdrop-blur-md border shadow-sm hover:shadow-md rounded-xl overflow-visible flex flex-col transition-all relative cursor-pointer ${isSelected ? 'border-slate-800 ring-1 ring-slate-800 bg-slate-100/50' : 'border-white/40'} ${showMenu ? 'z-50' : 'z-10'}`}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
    >
      {link.type === 'note' ? (
        <div className="h-32 w-full bg-emerald-50 relative overflow-hidden rounded-t-xl p-4 border-b border-emerald-100/50">
          <p className="text-xs text-slate-600 line-clamp-4 whitespace-pre-wrap font-mono">
            {link.content || 'Empty note...'}
          </p>
          <div className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow-sm">
            <Icon />
          </div>
        </div>
      ) : link.type === 'youtube' && getYoutubeThumbnail(link.url) ? (
        <div className="h-32 w-full bg-slate-100 relative overflow-hidden rounded-t-xl">
          <img src={getYoutubeThumbnail(link.url)!} alt={link.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          <div className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow-sm">
            <Icon />
          </div>
        </div>
      ) : link.previewImage ? (
        <div className="h-[140px] w-full bg-slate-100 relative overflow-hidden rounded-t-xl">
          <img src={link.previewImage} alt={link.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          <div className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow-sm">
            <Icon />
          </div>
        </div>
      ) : (
        <div className="h-32 w-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative rounded-t-xl">
          {getFavicon(link.url) ? (
            <img src={getFavicon(link.url)!} alt="favicon" className="w-12 h-12 rounded-lg shadow-sm bg-white p-1" referrerPolicy="no-referrer" />
          ) : (
            <Globe size={32} className="text-slate-300" />
          )}
          <div className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow-sm">
            <Icon />
          </div>
        </div>
      )}
      
      {link.starred && (
        <div className="absolute top-2 left-2 bg-yellow-400/90 p-1.5 rounded-full shadow-sm text-white z-10">
          <Star size={14} className="fill-current" />
        </div>
      )}
      
      <div className="p-4 flex-1 flex flex-col relative">
        <div className="flex justify-between items-start mb-1">
          <div className="flex-1 min-w-0 mr-2">
            <EditableLinkTitle 
              title={link.title} 
              onSave={(newTitle) => onUpdate({ ...link, title: newTitle })} 
              isEditing={isEditing}
              setIsEditing={setIsEditing}
            />
          </div>
          
          <div className="relative" ref={menuRef}>
            <button 
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); setShowDeleteConfirm(false); }}
            >
              <MoreVertical size={16} />
            </button>
            
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-slate-100 py-1 z-20">
                {!showDeleteConfirm ? (
                  <>
                    <button 
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center"
                      onClick={(e) => { e.stopPropagation(); onUpdate({ ...link, starred: !link.starred }); setShowMenu(false); }}
                    >
                      <Star size={14} className={`mr-2 ${link.starred ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                      {link.starred ? 'Unstar' : 'Star'}
                    </button>
                    <button 
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center"
                      onClick={(e) => { e.stopPropagation(); setIsEditing(true); setShowMenu(false); }}
                    >
                      <Edit2 size={14} className="mr-2" />
                      Rename
                    </button>
                    {link.type !== 'note' && (
                      <button 
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center"
                        onClick={async (e) => { 
                          e.stopPropagation(); 
                          setShowMenu(false);
                          const newPreview = await fetchLinkPreview(link.url);
                          if (newPreview !== undefined) {
                            onUpdate({ ...link, previewImage: newPreview });
                          }
                        }}
                      >
                        <RefreshCw size={14} className="mr-2" />
                        Refresh preview
                      </button>
                    )}
                    <div className="h-px bg-slate-100 my-1"></div>
                    <button 
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center"
                      onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                    >
                      <Trash2 size={14} className="mr-2" />
                      Delete
                    </button>
                  </>
                ) : (
                  <div className="px-3 py-2">
                    <p className="text-xs text-slate-600 mb-2 font-medium">Delete this link?</p>
                    <div className="flex space-x-2">
                      <button 
                        className="flex-1 bg-red-500 text-white text-xs py-1 rounded hover:bg-red-600"
                        onClick={(e) => { e.stopPropagation(); onDelete(link.id); }}
                      >
                        Yes
                      </button>
                      <button 
                        className="flex-1 bg-slate-100 text-slate-700 text-xs py-1 rounded hover:bg-slate-200"
                        onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
                      >
                        No
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {link.type === 'note' ? (
          <div className="text-xs text-emerald-600/80 truncate mb-4 block flex items-center">
            <AlignLeft size={12} className="mr-1" /> Text Note
          </div>
        ) : (
          <a 
            href={link.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-xs text-slate-500 truncate hover:text-slate-800 transition-colors mb-4 block"
            onClick={e => { if (onDoubleClick) e.preventDefault(); }}
          >
            {getDomain(link.url)}
          </a>
        )}
        
        <div className="mt-auto flex items-center justify-between">
          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
            {new Date(link.dateAdded).toLocaleDateString()}
          </span>
          <div className="flex space-x-2">
            {link.type !== 'note' && (
              <button 
                onClick={handleCopy}
                className={`flex items-center space-x-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors ${
                  copied ? 'bg-emerald-50 text-emerald-600' : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
                }`}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            )}
            {link.type === 'note' ? (
              <button 
                onClick={(e) => { e.stopPropagation(); if (onOpenNote) onOpenNote(link); }}
                className="flex items-center space-x-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors text-emerald-600 bg-emerald-50 hover:bg-emerald-100"
              >
                <FileText size={12} />
                <span>View</span>
              </button>
            ) : (
              <a 
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 text-xs font-medium px-2 py-1.5 rounded-md transition-colors text-slate-800 bg-slate-100 hover:bg-slate-200"
                onClick={e => e.stopPropagation()}
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
        <p className="text-xs text-slate-500 mt-0.5 truncate">Go up to {parentName}</p>
      </div>
    </div>
  );
};

const FolderCard: React.FC<{ 
  folder: Folder, 
  onDoubleClick: () => void, 
  onClick?: (e: React.MouseEvent) => void,
  onUpdate: (f: Folder) => void, 
  onDeleteRequest: (f: Folder) => void,
  onShareRequest?: (f: Folder) => void,
  isSelected?: boolean,
  user?: any
}> = ({ folder, onDoubleClick, onClick, onUpdate, onDeleteRequest, onShareRequest, isSelected, user }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div 
      className={`group bg-white/60 backdrop-blur-md border shadow-sm hover:shadow-md rounded-xl p-4 flex items-center cursor-pointer transition-all hover:border-slate-300 relative overflow-visible ${isSelected ? 'border-slate-800 ring-1 ring-slate-800 bg-slate-100/50' : 'border-white/40'} ${showMenu ? 'z-50' : 'z-10'}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title="Double-click to open"
    >
      <div 
        className="w-10 h-10 rounded-lg flex items-center justify-center mr-3 flex-shrink-0 relative"
        style={{ backgroundColor: folder.color ? `${folder.color}20` : '#eef2ff' }}
      >
        <FolderIcon size={20} style={{ color: folder.color || '#6366f1' }} />
        {folder.starred && (
          <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-0.5 border-2 border-white">
            <Star size={8} className="fill-white text-white" />
          </div>
        )}
        {folder.isPublic ? (
          <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full p-0.5 border-2 border-white" title="Publicly shared">
            <Globe size={10} className="text-white" />
          </div>
        ) : folder.type === 'shortcut' ? (
          <div className="absolute -bottom-1 -right-1 bg-indigo-500 rounded-full p-0.5 border-2 border-white" title="Shortcut">
            <LinkIcon size={10} className="text-white" />
          </div>
        ) : (
          <div className="absolute -bottom-1 -right-1 bg-slate-400 rounded-full p-0.5 border-2 border-white" title="Private folder">
            <Lock size={10} className="text-white" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <EditableFolderName 
          name={folder.name} 
          onSave={(newName) => onUpdate({ ...folder, name: newName })} 
          isEditing={isEditing}
          setIsEditing={setIsEditing}
        />
        {folder.type === 'shortcut' ? (
          <p className="text-xs text-indigo-500 mt-0.5">Shortcut • by @{folder.shortcutOwnerName || 'Someone'}</p>
        ) : (
          <p className="text-xs text-slate-500 mt-0.5">{folder.folders.length} folders, {folder.links.length} items</p>
        )}
      </div>
      
      <div className="relative" ref={menuRef}>
        <button 
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
        >
          <MoreVertical size={16} />
        </button>
        
        {showMenu && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-slate-100 py-1 z-20">
            <div className="px-3 py-2 border-b border-slate-100">
              <p className="text-xs text-slate-500 mb-2 font-medium">Folder Color</p>
              <div className="flex flex-wrap gap-1.5">
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c}
                    className={`w-5 h-5 rounded-full border ${folder.color === c ? 'ring-2 ring-offset-1 ring-slate-400' : 'border-black/10'}`}
                    style={{ backgroundColor: c }}
                    onClick={(e) => { e.stopPropagation(); onUpdate({ ...folder, color: c }); setShowMenu(false); }}
                    title="Set color"
                  />
                ))}
                <button
                   className={`w-5 h-5 rounded-full border flex items-center justify-center ${!folder.color ? 'ring-2 ring-offset-1 ring-slate-400 border-slate-300 bg-slate-100' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}
                   onClick={(e) => { e.stopPropagation(); onUpdate({ ...folder, color: undefined }); setShowMenu(false); }}
                   title="Default color"
                >
                   <X size={12} className="text-slate-400" />
                </button>
              </div>
            </div>
            <button 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center mt-1"
              onClick={(e) => { e.stopPropagation(); onUpdate({ ...folder, starred: !folder.starred }); setShowMenu(false); }}
            >
              <Star size={14} className={`mr-2 ${folder.starred ? 'fill-yellow-400 text-yellow-400' : ''}`} />
              {folder.starred ? 'Unstar' : 'Star'}
            </button>
            <button 
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center"
              onClick={(e) => { e.stopPropagation(); setIsEditing(true); setShowMenu(false); }}
            >
              <Edit2 size={14} className="mr-2" />
              Rename
            </button>
            {user && onShareRequest && folder.type !== 'shortcut' && (
              <button 
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center"
                onClick={(e) => { e.stopPropagation(); onShareRequest(folder); setShowMenu(false); }}
              >
                <Globe size={14} className="mr-2" />
                Share folder
              </button>
            )}
            <div className="h-px bg-slate-100 my-1"></div>
            <button 
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center"
              onClick={(e) => { e.stopPropagation(); onDeleteRequest(folder); setShowMenu(false); }}
            >
              <Trash2 size={14} className="mr-2" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const SidebarFolder: React.FC<{ folder: Folder, currentFolderId: string, onSelect: (id: string) => void, level?: number }> = ({ folder, currentFolderId, onSelect, level = 0 }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isSelected = folder.id === currentFolderId;
  
  return (
    <div>
      <div 
        className={`flex items-center py-1.5 px-2 rounded-md cursor-pointer transition-colors ${isSelected ? 'bg-slate-200/60 text-slate-900 font-medium' : 'hover:bg-slate-100/80 text-slate-700'}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onSelect(folder.id)}
      >
        <button 
          className="p-0.5 mr-1 rounded hover:bg-slate-200/50 text-slate-500"
          onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        >
          {folder.folders.length > 0 ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="w-[14px] inline-block" />
          )}
        </button>
        {folder.type === 'shortcut' ? (
          <LinkIcon size={16} className={`mr-2 ${isSelected ? 'text-indigo-600' : 'text-indigo-400'}`} />
        ) : (
          <FolderIcon size={16} className={`mr-2 ${isSelected ? 'text-slate-800' : 'text-slate-400'}`} />
        )}
        <span className="text-sm truncate">{folder.name}</span>
      </div>
      {isOpen && folder.folders.map(sub => (
        <SidebarFolder key={sub.id} folder={sub} currentFolderId={currentFolderId} onSelect={onSelect} level={level + 1} />
      ))}
    </div>
  );
};

const cloneLink = (link: LinkItem): LinkItem => ({
  ...link,
  id: generateId(),
  dateAdded: Date.now()
});

const cloneFolder = (folder: Folder): Folder => ({
  ...folder,
  id: generateId(),
  folders: folder.folders.map(cloneFolder),
  links: folder.links.map(cloneLink)
});

const setPublicRecursive = (folder: Folder, isPublic: boolean): Folder => {
  if (folder.type === 'shortcut') {
    return folder; // Do not change isPublic for shortcuts
  }
  return {
    ...folder,
    isPublic,
    folders: folder.folders.map(f => setPublicRecursive(f, isPublic))
  };
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (custom: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: custom * 0.06,
      ease: "easeInOut",
      duration: 0.3
    }
  }),
  exit: (custom: number) => ({
    opacity: 0,
    y: 20,
    transition: {
      delay: custom * 0.06,
      ease: "easeInOut",
      duration: 0.3
    }
  })
};

export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (hash.startsWith('#/share/')) {
    const shareId = hash.replace('#/share/', '');
    return <ShareView shareId={shareId} />;
  }

  const [user, setUser] = useState<User | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadingState, setLoadingState] = useState<'AUTH_LOADING' | 'DATA_LOADING' | 'READY'>('AUTH_LOADING');
  const [showLoading, setShowLoading] = useState(true);
  const [fadeLoading, setFadeLoading] = useState(false);

  // PWA Install Prompt State
  const [showInstallButton, setShowInstallButton] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIos, setIsIos] = useState(false);
  const [showIosTooltip, setShowIosTooltip] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallButton(true);
    };

    const handleAppInstalled = () => {
      setShowInstallButton(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // iOS detection
    const ios = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
    
    if (ios && !isInStandaloneMode) {
      setIsIos(true);
      setShowInstallButton(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIos) {
      setShowIosTooltip(true);
      setTimeout(() => setShowIosTooltip(false), 5000);
      return;
    }

    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowInstallButton(false);
      }
      setDeferredPrompt(null);
    }
  };

  useEffect(() => {
    if (loadingState === 'READY') {
      setFadeLoading(true);
      const timer = setTimeout(() => {
        setShowLoading(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loadingState]);

  const [rootFolder, setRootFolder] = useState<Folder>(() => {
    const saved = localStorage.getItem('linkvault_backup');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved data', e);
      }
    }
    return INITIAL_STATE;
  });

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setLoadingState('DATA_LOADING');
        setIsSyncing(true);
        try {
          const remoteData = await fetchFromFirestore(currentUser.uid);
          
          let mergedData = remoteData;
          // Merge local data if it exists
          const savedLocal = localStorage.getItem('linkvault_backup');
          let localData = INITIAL_STATE;
          if (savedLocal) {
            try {
              localData = JSON.parse(savedLocal);
            } catch (e) {}
          }

          if (localData.folders.length > 0 || localData.links.length > 0) {
            const newFolders = localData.folders.filter(lf => !remoteData.folders.some(rf => rf.id === lf.id));
            const newLinks = localData.links.filter(ll => !remoteData.links.some(rl => rl.id === ll.id));
            
            if (newFolders.length > 0 || newLinks.length > 0) {
              mergedData = {
                ...remoteData,
                folders: [...remoteData.folders, ...newFolders],
                links: [...remoteData.links, ...newLinks]
              };
              await syncToFirestore(currentUser.uid, mergedData);
            }
            // Clear local storage after successful merge
            localStorage.removeItem('linkvault_backup');
          } else if (remoteData.folders.length === 0 && remoteData.links.length === 0) {
            // First time login with no local data, just sync empty state
            await syncToFirestore(currentUser.uid, localData);
          }
          
          setRootFolder(mergedData);
        } catch (error) {
          console.error("Error fetching from Firestore", error);
        } finally {
          setIsSyncing(false);
          setLoadingState('READY');
        }
      } else {
        // Revert to local storage
        const saved = localStorage.getItem('linkvault_backup');
        if (saved) {
          try {
            setRootFolder(JSON.parse(saved));
          } catch (e) {}
        } else {
          setRootFolder(INITIAL_STATE);
        }
        setLoadingState('READY');
      }
    });

    timeoutId = setTimeout(() => {
      setLoadingState('READY');
    }, 10000);

    return () => {
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);
  const [isFabOpen, setIsFabOpen] = useState(false);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [displayNameInput, setDisplayNameInput] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isFetchingStats, setIsFetchingStats] = useState(false);
  const [usageStats, setUsageStats] = useState({ folders: 0, links: 0, notes: 0, shared: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarSection, setSidebarSection] = useState<'folders' | 'recent' | 'starred' | 'shared'>('folders');
  const [recents, setRecents] = useState<{ id: string, type: string, name: string, parentFolderId: string, openedAt: number }[]>([]);

  useEffect(() => {
    const key = user ? `lvp_recents_${user.uid}` : 'lvp_recents_anonymous';
    const savedRecents = localStorage.getItem(key);
    if (savedRecents) {
      try {
        setRecents(JSON.parse(savedRecents));
      } catch (e) {}
    } else {
      setRecents([]);
    }
  }, [user]);

  const recordRecent = (item: { id: string, type: string, name: string, parentFolderId: string }) => {
    setRecents(prev => {
      const filtered = prev.filter(r => r.id !== item.id);
      const updated = [{ ...item, openedAt: Date.now() }, ...filtered].slice(0, 10);
      const key = user ? `lvp_recents_${user.uid}` : 'lvp_recents_anonymous';
      localStorage.setItem(key, JSON.stringify(updated));
      return updated;
    });
  };

  const handleOpenFolder = (folderId: string) => {
    setCurrentFolderId(folderId);
    const folder = findFolder(rootFolder, folderId);
    if (folder && folderId !== 'root') {
      const path = getBreadcrumbs(rootFolder, folderId);
      const parent = path && path.length > 1 ? path[path.length - 2] : null;
      recordRecent({
        id: folder.id,
        type: 'folder',
        name: folder.name,
        parentFolderId: parent ? parent.id : 'root'
      });
    }
  };

  const handleOpenLink = (link: LinkItem, parentFolderId: string) => {
    recordRecent({
      id: link.id,
      type: link.type,
      name: link.title,
      parentFolderId
    });
  };

  const renderStarredItems = () => {
    const starredFolders: { folder: Folder, parentName: string }[] = [];
    const starredLinks: { link: LinkItem, parentName: string, parentFolderId: string }[] = [];

    const findStarred = (folder: Folder, parentName: string) => {
      if (folder.starred && folder.id !== 'root') {
        starredFolders.push({ folder, parentName });
      }
      for (const link of folder.links) {
        if (link.starred) {
          starredLinks.push({ link, parentName: folder.name, parentFolderId: folder.id });
        }
      }
      for (const sub of folder.folders) {
        findStarred(sub, folder.name);
      }
    };

    findStarred(rootFolder, 'Root');

    if (starredFolders.length === 0 && starredLinks.length === 0) {
      return <div className="text-sm text-slate-500 text-center py-4">No starred items yet</div>;
    }

    return (
      <>
        {starredFolders.map(item => (
          <div 
            key={item.folder.id}
            className="flex items-center py-2 px-2 rounded-md cursor-pointer hover:bg-slate-100/80 transition-colors"
            onClick={() => { handleOpenFolder(item.folder.id); setIsSidebarOpen(false); }}
          >
            <div className="mr-3 flex-shrink-0 relative">
              <FolderIcon size={16} className="text-slate-400" />
              <Star size={8} className="text-yellow-400 absolute -top-1 -right-1 fill-yellow-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-700 truncate font-medium">{item.folder.name}</div>
              <div className="text-[10px] text-slate-400 truncate">in {item.parentName}</div>
            </div>
          </div>
        ))}
        {starredLinks.map(item => (
          <div 
            key={item.link.id}
            className="flex items-center py-2 px-2 rounded-md cursor-pointer hover:bg-slate-100/80 transition-colors"
            onClick={() => { 
              handleOpenFolder(item.parentFolderId); 
              setIsSidebarOpen(false); 
              // Optional: highlight the link
            }}
          >
            <div className="mr-3 flex-shrink-0 relative">
              {item.link.type === 'note' ? <FileText size={16} className="text-emerald-500" /> :
               item.link.type === 'youtube' ? <Youtube size={16} className="text-red-500" /> :
               item.link.type === 'instagram' ? <Instagram size={16} className="text-pink-500" /> :
               item.link.type === 'tiktok' ? <Video size={16} className="text-slate-800" /> :
               <Globe size={16} className="text-blue-500" />}
              <Star size={8} className="text-yellow-400 absolute -top-1 -right-1 fill-yellow-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-700 truncate font-medium">{item.link.title}</div>
              <div className="text-[10px] text-slate-400 truncate">in {item.parentName}</div>
            </div>
          </div>
        ))}
      </>
    );
  };

  const renderSharedFolders = () => {
    const sharedFolders: { folder: Folder, parentName: string }[] = [];

    const findShared = (folder: Folder, parentName: string) => {
      if (folder.isPublic && folder.id !== 'root') {
        sharedFolders.push({ folder, parentName });
      }
      for (const sub of folder.folders) {
        findShared(sub, folder.name);
      }
    };

    findShared(rootFolder, 'Root');

    if (sharedFolders.length === 0) {
      return <div className="text-sm text-slate-500 text-center py-4">No shared folders yet</div>;
    }

    return (
      <>
        {sharedFolders.map(item => (
          <div 
            key={item.folder.id}
            className="group flex items-center py-2 px-2 rounded-md cursor-pointer hover:bg-slate-100/80 transition-colors"
            onClick={() => { handleOpenFolder(item.folder.id); setIsSidebarOpen(false); }}
          >
            <div className="mr-3 flex-shrink-0">
              <Globe size={16} className="text-blue-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-700 truncate font-medium">{item.folder.name}</div>
              <div className="text-[10px] text-slate-400 truncate">in {item.parentName}</div>
            </div>
            <button
              className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-all"
              onClick={(e) => {
                e.stopPropagation();
                if (item.folder.shareId) {
                  const shareUrl = `${window.location.origin}/share/${item.folder.shareId}`;
                  navigator.clipboard.writeText(shareUrl);
                  // Optional: show toast
                }
              }}
              title="Copy link"
            >
              <Copy size={14} />
            </button>
          </div>
        ))}
      </>
    );
  };

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [explicitBulkMode, setExplicitBulkMode] = useState(false);
  const isBulkMode = selectedItemIds.length >= 2 || explicitBulkMode;
  
  // Clear selection when changing folders or searching
  useEffect(() => {
    setSelectedItemIds([]);
    setExplicitBulkMode(false);
  }, [currentFolderId, searchQuery]);
  
  const [clipboard, setClipboard] = useState<{ ids: string[], action: 'copy' | 'cut' } | null>(null);
  
  const [isUnityModalOpen, setIsUnityModalOpen] = useState(false);
  const [unityFolderName, setUnityFolderName] = useState('');

  // Modals
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [folderToShare, setFolderToShare] = useState<Folder | null>(null);
  const [viewNoteItem, setViewNoteItem] = useState<LinkItem | null>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editNoteContent, setEditNoteContent] = useState('');
  const [noteCopied, setNoteCopied] = useState(false);
  
  // Form states
  const [newFolderName, setNewFolderName] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');

  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteCountdown, setDeleteCountdown] = useState(0);

  useEffect(() => {
    if (folderToDelete?.type === 'shortcut') {
      setDeleteCountdown(3);
      const interval = setInterval(() => {
        setDeleteCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [folderToDelete]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-save
  useEffect(() => {
    if (user) {
      if (!isSyncing) {
        syncToFirestore(user.uid, rootFolder).catch(console.error);
      }
    } else {
      localStorage.setItem('linkvault_backup', JSON.stringify(rootFolder));
    }
  }, [rootFolder, user, isSyncing]);

  // Disable bulk mode when no items are selected
  useEffect(() => {
    if (selectedItemIds.length === 0 && explicitBulkMode) {
      setExplicitBulkMode(false);
    }
  }, [selectedItemIds.length, explicitBulkMode]);

  const currentFolder = findFolder(rootFolder, currentFolderId) || rootFolder;
  const breadcrumbs = getBreadcrumbs(rootFolder, currentFolderId) || [rootFolder];

  const searchVault = (root: Folder, query: string): { folders: Folder[], links: { link: LinkItem, parentFolderId: string }[] } => {
    const lowerQuery = query.toLowerCase();
    let results = { folders: [] as Folder[], links: [] as { link: LinkItem, parentFolderId: string }[] };

    const searchRecursive = (folder: Folder) => {
      if (folder.name.toLowerCase().includes(lowerQuery) && folder.id !== 'root') {
        results.folders.push(folder);
      }
      for (const link of folder.links) {
        if (link.title.toLowerCase().includes(lowerQuery) || link.url.toLowerCase().includes(lowerQuery)) {
          results.links.push({ link, parentFolderId: folder.id });
        }
      }
      for (const sub of folder.folders) {
        searchRecursive(sub);
      }
    };

    searchRecursive(root);
    return results;
  };

  const searchResults = searchQuery.trim() ? searchVault(rootFolder, searchQuery) : null;

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    
    // Find parent folder to check if it's public
    const parentFolder = currentFolderId === 'root' ? rootFolder : findFolder(rootFolder, currentFolderId);
    const isPublic = parentFolder?.isPublic || false;
    
    const newFolder: Folder = {
      id: generateId(),
      name: newFolderName.trim(),
      folders: [],
      links: [],
      isPublic
    };
    
    setRootFolder(prev => updateFolder(prev, currentFolderId, f => ({
      ...f,
      folders: [...f.folders, newFolder]
    })));
    
    setNewFolderName('');
    setIsCreateFolderModalOpen(false);
  };

  const handleAddLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLinkUrl.trim() || !newLinkTitle.trim()) return;
    
    let url = newLinkUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    
    const type = detectLinkType(url);
    const linkId = generateId();
    
    const newLink: LinkItem = {
      id: linkId,
      title: newLinkTitle.trim(),
      url,
      type,
      dateAdded: Date.now(),
      previewImage: null
    };
    
    setRootFolder(prev => updateFolder(prev, currentFolderId, f => ({
      ...f,
      links: [...f.links, newLink]
    })));
    
    setNewLinkUrl('');
    setNewLinkTitle('');
    setIsAddLinkModalOpen(false);

    // Fetch preview in background
    fetchLinkPreview(url).then(previewImage => {
      if (previewImage) {
        setRootFolder(prev => {
          let updated = false;
          const updateLinkInFolder = (folder: Folder): Folder => {
            const linkIndex = folder.links.findIndex(l => l.id === linkId);
            if (linkIndex !== -1) {
              updated = true;
              const newLinks = [...folder.links];
              newLinks[linkIndex] = { ...newLinks[linkIndex], previewImage };
              return { ...folder, links: newLinks };
            }
            if (!updated) {
              return {
                ...folder,
                folders: folder.folders.map(updateLinkInFolder)
              };
            }
            return folder;
          };
          return updateLinkInFolder(prev);
        });
      }
    });
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle.trim() && !newNoteContent.trim()) return;
    
    const newNote: LinkItem = {
      id: generateId(),
      title: newNoteTitle.trim() || 'Untitled Note',
      url: '',
      content: newNoteContent,
      type: 'note',
      dateAdded: Date.now(),
      previewImage: null
    };

    setRootFolder(prev => updateFolder(prev, currentFolderId, f => ({
      ...f,
      links: [newNote, ...f.links]
    })));

    setNewNoteTitle('');
    setNewNoteContent('');
    setIsAddNoteModalOpen(false);
  };

  const handleUpdateNoteContent = (id: string, newContent: string) => {
    setRootFolder(prev => updateLinkInTree(prev, { ...viewNoteItem!, content: newContent }));
    setViewNoteItem(prev => prev ? { ...prev, content: newContent } : null);
    setIsEditingNote(false);
  };

  const handleDeleteFolder = (id: string) => {
    setRootFolder(prev => deleteFolder(prev, id));
    if (currentFolderId === id) {
      setCurrentFolderId('root');
    }
  };

  const handleDeleteLink = (id: string) => {
    setRootFolder(prev => deleteLinkInTree(prev, id));
  };

  const handleUpdateLink = (updatedLink: LinkItem) => {
    setRootFolder(prev => updateLinkInTree(prev, updatedLink));
  };

  const handleUpdateFolder = (updatedFolder: Folder) => {
    setRootFolder(prev => updateFolder(prev, updatedFolder.id, () => updatedFolder));
  };

  const toggleItemSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (explicitBulkMode) {
      setSelectedItemIds(prev => 
        prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]
      );
    } else {
      setSelectedItemIds(prev => 
        prev.includes(id) && prev.length === 1 ? [] : [id]
      );
    }
  };

  const handleBulkDelete = () => {
    if (confirm(`Are you sure you want to delete ${selectedItemIds.length} items?`)) {
      setRootFolder(prev => removeItemsByIds(prev, selectedItemIds));
      setSelectedItemIds([]);
      setExplicitBulkMode(false);
    }
  };

  const handleBulkStar = () => {
    setRootFolder(prev => updateItemsInTreeBulk(prev, selectedItemIds, f => ({ ...f, starred: true }), l => ({ ...l, starred: true })));
    setSelectedItemIds([]);
    setExplicitBulkMode(false);
  };

  const handleCut = () => {
    setClipboard({ ids: selectedItemIds, action: 'cut' });
    setSelectedItemIds([]);
    setExplicitBulkMode(false);
  };

  const handleCopyItems = () => {
    setClipboard({ ids: selectedItemIds, action: 'copy' });
    setSelectedItemIds([]);
    setExplicitBulkMode(false);
  };

  const handlePaste = () => {
    if (!clipboard) return;

    setRootFolder(prev => {
      const itemsToPaste = getTopLevelSelectedItems(prev, clipboard.ids);
      
      let tree = prev;
      if (clipboard.action === 'cut') {
        tree = removeItemsByIds(tree, clipboard.ids);
      }

      const finalItems = clipboard.action === 'copy' 
        ? {
            folders: itemsToPaste.folders.map(cloneFolder),
            links: itemsToPaste.links.map(cloneLink)
          }
        : itemsToPaste;

      return addItemsToFolder(tree, currentFolderId, finalItems);
    });

    if (clipboard.action === 'cut') {
      setClipboard(null);
    }
  };

  const handleUnity = (e: React.FormEvent) => {
    e.preventDefault();
    if (!unityFolderName.trim()) return;
    
    // Find parent folder to check if it's public
    const parentFolder = currentFolderId === 'root' ? rootFolder : findFolder(rootFolder, currentFolderId);
    const isPublic = parentFolder?.isPublic || false;
    
    const newFolderId = Date.now().toString();
    const newFolder: Folder = {
      id: newFolderId,
      name: unityFolderName.trim(),
      folders: [],
      links: [],
      isPublic
    };

    setRootFolder(prev => {
      const itemsToMove = getTopLevelSelectedItems(prev, selectedItemIds);
      let treeWithoutItems = removeItemsByIds(prev, selectedItemIds);
      
      newFolder.folders = itemsToMove.folders.map(f => setPublicRecursive(f, isPublic));
      newFolder.links = itemsToMove.links;
      
      return updateFolder(treeWithoutItems, currentFolderId, f => ({
        ...f,
        folders: [...f.folders, newFolder]
      }));
    });

    setSelectedItemIds([]);
    setExplicitBulkMode(false);
    setIsUnityModalOpen(false);
    setUnityFolderName('');
  };

  const handleRenameFolder = (id: string, newName: string) => {
    setRootFolder(prev => updateFolder(prev, id, f => ({ ...f, name: newName })));
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(rootFolder, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "linkvault_backup.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (importedData && importedData.id === 'root' && Array.isArray(importedData.folders)) {
          setRootFolder(importedData);
          setCurrentFolderId('root');
        } else {
          showToast("Invalid backup file format.", 'error');
        }
      } catch (err) {
        showToast("Error parsing backup file.", 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const fetchUsageStats = async () => {
    if (!user) return;
    setIsFetchingStats(true);
    try {
      const foldersRef = collection(db, `users/${user.uid}/folders`);
      const itemsRef = collection(db, `users/${user.uid}/items`);
      const [foldersSnap, itemsSnap] = await Promise.all([
        getDocs(foldersRef),
        getDocs(itemsRef)
      ]);
      
      let foldersCount = foldersSnap.size;
      let linksCount = 0;
      let notesCount = 0;
      let sharedCount = 0;

      foldersSnap.forEach(doc => {
        if (doc.data().isPublic) sharedCount++;
      });

      itemsSnap.forEach(doc => {
        if (doc.data().type === 'note') notesCount++;
        else linksCount++;
      });

      setUsageStats({ folders: foldersCount, links: linksCount, notes: notesCount, shared: sharedCount });
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setIsFetchingStats(false);
    }
  };

  useEffect(() => {
    if (isSettingsModalOpen && user) {
      setDisplayNameInput(user.displayName || '');
      fetchUsageStats();
    }
  }, [isSettingsModalOpen, user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    try {
      await updateProfile(user, { displayName: displayNameInput });
      // Update local user state to reflect changes immediately
      setUser({ ...user, displayName: displayNameInput } as User);
      showToast('Profile updated successfully');
    } catch (error) {
      console.error("Error updating profile:", error);
      showToast('Failed to update profile', 'error');
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeletingAccount(true);
    try {
      // 1. Delete all user's Firestore data
      const foldersRef = collection(db, `users/${user.uid}/folders`);
      const itemsRef = collection(db, `users/${user.uid}/items`);
      const [foldersSnap, itemsSnap] = await Promise.all([
        getDocs(foldersRef),
        getDocs(itemsRef)
      ]);

      let batch = writeBatch(db);
      let opCount = 0;

      const commitBatch = async () => {
        if (opCount > 0) {
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        }
      };

      for (const doc of foldersSnap.docs) {
        batch.delete(doc.ref);
        opCount++;
        if (opCount >= 450) await commitBatch();
      }

      for (const doc of itemsSnap.docs) {
        batch.delete(doc.ref);
        opCount++;
        if (opCount >= 450) await commitBatch();
      }

      // 2. Delete publicFolders
      const publicFoldersRef = collection(db, 'publicFolders');
      const q = query(publicFoldersRef, where('userId', '==', user.uid));
      const publicFoldersSnap = await getDocs(q);
      
      for (const doc of publicFoldersSnap.docs) {
        batch.delete(doc.ref);
        opCount++;
        if (opCount >= 450) await commitBatch();
      }

      await commitBatch();

      // 3. Delete Auth account
      await deleteUser(user);
      
      // 4. Sign out and redirect
      await signOut(auth);
      setRootFolder({ id: 'root', name: 'Root', folders: [], links: [] });
      setIsSettingsModalOpen(false);
      setIsDeletingAccount(false);
    } catch (error) {
      console.error("Error deleting account:", error);
      showToast('Failed to delete account. You may need to sign in again to perform this action.', 'error');
      setIsDeletingAccount(false);
    }
  };

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in:", error);
      showToast('Failed to sign in', 'error');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setRootFolder({ id: 'root', name: 'Root', folders: [], links: [] });
      setCurrentFolderId('root');
      showToast('Signed out successfully');
    } catch (error) {
      console.error("Error signing out:", error);
      showToast('Failed to sign out', 'error');
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-slate-200 selection:text-slate-900">
      {/* Loading Screen Overlay */}
      {showLoading && (
        <div 
          className={`fixed inset-0 bg-slate-50 z-[100] flex flex-col items-center justify-center transition-opacity duration-500 ${fadeLoading ? 'opacity-0' : 'opacity-100'}`}
        >
          <h1 className="text-3xl font-bold tracking-tight text-black mb-8">LinkVault<span className="font-normal">Pro</span></h1>
          <div className="loader"></div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[99] lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-[100] w-72 bg-white/80 backdrop-blur-xl border-r border-slate-200/60 
        flex flex-col transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-5 border-b border-slate-200/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img src={faviconBase64} alt="LinkVaultPro Logo" className="w-8 h-8 rounded-lg" referrerPolicy="no-referrer" />
            <h1 className="text-xl font-bold tracking-tight text-black">LinkVault<span className="font-normal">Pro</span></h1>
          </div>
          <button className="lg:hidden text-slate-500 hover:text-slate-800" onClick={() => setIsSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        {/* Sidebar Navigation */}
        <div className="flex items-center justify-around p-2 border-b border-slate-200/60 bg-slate-50/50">
          <button 
            onClick={() => setSidebarSection('folders')}
            className={`p-2 rounded-lg flex flex-col items-center justify-center w-14 transition-colors ${sidebarSection === 'folders' ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
            title="My Folders"
          >
            <FolderIcon size={20} />
            <span className="text-[10px] mt-1 font-medium">Folders</span>
          </button>
          <button 
            onClick={() => setSidebarSection('recent')}
            className={`p-2 rounded-lg flex flex-col items-center justify-center w-14 transition-colors ${sidebarSection === 'recent' ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
            title="Recent"
          >
            <Clock size={20} />
            <span className="text-[10px] mt-1 font-medium">Recent</span>
          </button>
          <button 
            onClick={() => setSidebarSection('starred')}
            className={`p-2 rounded-lg flex flex-col items-center justify-center w-14 transition-colors ${sidebarSection === 'starred' ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
            title="Starred"
          >
            <Star size={20} />
            <span className="text-[10px] mt-1 font-medium">Starred</span>
          </button>
          <button 
            onClick={() => setSidebarSection('shared')}
            className={`p-2 rounded-lg flex flex-col items-center justify-center w-14 transition-colors ${sidebarSection === 'shared' ? 'bg-slate-200 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
            title="Shared"
          >
            <Globe size={20} />
            <span className="text-[10px] mt-1 font-medium">Shared</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          {sidebarSection === 'folders' && (
            <SidebarFolder 
              folder={rootFolder} 
              currentFolderId={currentFolderId} 
              onSelect={(id) => { handleOpenFolder(id); setIsSidebarOpen(false); }} 
            />
          )}
          {sidebarSection === 'recent' && (
            <div className="space-y-1">
              {recents.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-4">No recent activity</div>
              ) : (
                recents.map(recent => (
                  <div 
                    key={recent.id + recent.openedAt}
                    className="flex items-center py-2 px-2 rounded-md cursor-pointer hover:bg-slate-100/80 transition-colors"
                    onClick={() => {
                      if (recent.type === 'folder') {
                        handleOpenFolder(recent.id);
                      } else {
                        handleOpenFolder(recent.parentFolderId);
                        // Optional: highlight item
                      }
                      setIsSidebarOpen(false);
                    }}
                  >
                    <div className="mr-3 flex-shrink-0">
                      {recent.type === 'folder' ? <FolderIcon size={16} className="text-slate-400" /> : 
                       recent.type === 'note' ? <FileText size={16} className="text-emerald-500" /> :
                       recent.type === 'youtube' ? <Youtube size={16} className="text-red-500" /> :
                       recent.type === 'instagram' ? <Instagram size={16} className="text-pink-500" /> :
                       recent.type === 'tiktok' ? <Video size={16} className="text-slate-800" /> :
                       <Globe size={16} className="text-blue-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-700 truncate font-medium">{recent.name}</div>
                      <div className="text-[10px] text-slate-400">{formatTimeAgo(recent.openedAt)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          {sidebarSection === 'starred' && (
            <div className="space-y-1">
              {renderStarredItems()}
            </div>
          )}
          {sidebarSection === 'shared' && (
            <div className="space-y-1">
              {renderSharedFolders()}
            </div>
          )}
        </div>

        {!user && (
          <div className="p-4 border-t border-slate-200/60 bg-slate-50/50">
            <div className="flex space-x-2">
              <button 
                onClick={handleExport}
                className="flex-1 flex items-center justify-center space-x-2 py-2 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-black transition-colors shadow-sm"
              >
                <Download size={16} />
                <span>Export</span>
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center space-x-2 py-2 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-black transition-colors shadow-sm"
              >
                <Upload size={16} />
                <span>Import</span>
              </button>
              <input 
                type="file" 
                accept=".json" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleImport}
              />
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100/50 relative z-[1]">
        {/* Header Area */}
        <div className="sticky top-0 z-[60] flex flex-col shadow-sm">
          {selectedItemIds.length > 0 ? (
            <header className="h-16 bg-slate-100/90 backdrop-blur-md border-b border-slate-200 flex items-center px-4 sm:px-8 justify-between gap-4">
              <div className="flex items-center">
                <button onClick={() => { setSelectedItemIds([]); setExplicitBulkMode(false); }} className="p-2 text-slate-500 hover:bg-slate-200 rounded-full mr-2">
                  <X size={20} />
                </button>
                <span className="font-medium text-slate-900">{selectedItemIds.length} selected</span>
              </div>
              
              <div className="flex items-center space-x-2">
                {!isBulkMode ? (
                  <button 
                    onClick={() => setExplicitBulkMode(true)}
                    className="px-4 py-1.5 bg-slate-200 text-slate-800 hover:bg-slate-300 rounded-lg text-sm font-medium transition-colors"
                  >
                    Activate Bulk Mode
                  </button>
                ) : (
                  <>
                    <button onClick={handleCopyItems} className="p-2 text-slate-600 hover:bg-slate-200 rounded-full" title="Copy">
                      <Copy size={20} />
                    </button>
                    <button onClick={handleCut} className="p-2 text-slate-600 hover:bg-slate-200 rounded-full" title="Cut">
                      <Scissors size={20} />
                    </button>
                    <button onClick={handleBulkStar} className="p-2 text-slate-600 hover:bg-slate-200 rounded-full" title="Star">
                      <Star size={20} />
                    </button>
                    <button onClick={handleBulkDelete} className="p-2 text-slate-600 hover:bg-slate-200 rounded-full" title="Delete">
                      <Trash2 size={20} />
                    </button>
                    <button onClick={() => setIsUnityModalOpen(true)} className="p-2 text-slate-600 hover:bg-slate-200 rounded-full" title="Unity in new folder">
                      <FolderInput size={20} />
                    </button>
                  </>
                )}
              </div>
            </header>
          ) : (
            <header className="h-16 bg-white/60 backdrop-blur-md border-b border-slate-200/60 flex items-center px-4 sm:px-8 justify-between gap-4">
              <div className="flex items-center min-w-0 relative">
                <button 
                  className="mr-2 lg:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-md flex-shrink-0"
                  onClick={() => setIsSidebarOpen(true)}
                >
                  <Menu size={20} />
                </button>
                {showInstallButton && (
                  <div className="relative">
                    <button
                      onClick={handleInstallClick}
                      className="md:hidden flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 mr-2 transition-colors"
                    >
                      <Download size={14} />
                      <span>Install</span>
                    </button>
                    {showIosTooltip && (
                      <div className="absolute top-full left-0 mt-2 w-48 p-2 bg-slate-800 text-white text-xs rounded shadow-lg z-50">
                        To install: tap the Share button (□↑) then 'Add to Home Screen'
                        <div className="absolute -top-1 left-4 w-2 h-2 bg-slate-800 transform rotate-45"></div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 max-w-md relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search size={16} className="text-slate-400" />
                </div>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 bg-slate-100/50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/50 focus:bg-white transition-colors"
                />
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0">
                <button 
                  onClick={() => setIsCreateFolderModalOpen(true)}
                  className="hidden md:flex items-center space-x-1.5 py-1.5 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                >
                  <FolderIcon size={16} className="text-slate-500" />
                  <span className="hidden sm:inline">New Folder</span>
                </button>
                <button 
                  onClick={() => setIsAddNoteModalOpen(true)}
                  className="hidden md:flex items-center space-x-1.5 py-1.5 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                >
                  <FileText size={16} className="text-slate-500" />
                  <span className="hidden sm:inline">Add Note</span>
                </button>
                <button 
                  onClick={() => setIsAddLinkModalOpen(true)}
                  className="hidden md:flex items-center space-x-1.5 py-1.5 px-3 bg-black rounded-lg text-sm font-medium text-white hover:bg-slate-800 transition-all shadow-sm shadow-slate-200"
                >
                  <Plus size={16} />
                  <span className="hidden sm:inline">Add Link</span>
                </button>
                <div className="hidden md:block h-6 w-px bg-slate-200 mx-2"></div>
                {user ? (
                  <div className="relative">
                    <button 
                      className="flex items-center space-x-2 focus:outline-none"
                      onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                    >
                      <img src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=random`} alt={user.displayName || 'User'} className="w-8 h-8 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
                      <span className="text-sm font-medium text-slate-700 hidden sm:block">{user.displayName?.split(' ')[0]}</span>
                    </button>
                    {isProfileMenuOpen && createPortal(
                      <>
                        <div 
                          className="fixed inset-0 z-[9999]" 
                          onClick={() => setIsProfileMenuOpen(false)}
                        />
                        <div className="fixed right-4 sm:right-8 top-[72px] w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-[9999] animate-in fade-in zoom-in-95 duration-100">
                          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                            <p className="text-sm font-medium text-slate-800 truncate">{user.displayName}</p>
                            <p className="text-xs text-slate-500 truncate">{user.email}</p>
                          </div>
                          <button 
                            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center transition-colors mt-1"
                            onClick={() => {
                              setIsProfileMenuOpen(false);
                              setIsSettingsModalOpen(true);
                            }}
                          >
                            <Settings size={16} className="mr-2 text-slate-400" />
                            Settings
                          </button>
                          <div className="h-px bg-slate-100 my-1"></div>
                          <button 
                            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center transition-colors mb-1"
                            onClick={() => {
                              setIsProfileMenuOpen(false);
                              handleSignOut();
                            }}
                          >
                            <LogOut size={16} className="mr-2 text-red-400" />
                            Sign Out
                          </button>
                        </div>
                      </>,
                      document.body
                    )}
                  </div>
                ) : (
                  <button onClick={handleSignIn} className="flex items-center space-x-2 py-1.5 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all shadow-sm">
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-4 h-4" />
                    <span className="hidden sm:inline">Sign In</span>
                  </button>
                )}
              </div>
            </header>
          )}

          {/* Breadcrumbs Row */}
          <div className="px-4 sm:px-8 py-2 flex items-center space-x-1 sm:space-x-2 text-sm text-slate-500 overflow-x-auto whitespace-nowrap hide-scrollbar border-b border-slate-200/60 bg-slate-50/90 backdrop-blur-md">
            {breadcrumbs.map((f, i) => (
              <React.Fragment key={f.id}>
                <span 
                  className={`cursor-pointer transition-colors font-medium ${i === breadcrumbs.length - 1 ? 'text-slate-800' : 'hover:text-black'}`}
                  onClick={() => handleOpenFolder(f.id)}
                >
                  {f.name}
                </span>
                {i < breadcrumbs.length - 1 && <ChevronRight size={14} className="flex-shrink-0 text-slate-400" />}
              </React.Fragment>
            ))}
          </div>

          {/* Clipboard Banner */}
          {clipboard && (
            <div className="bg-slate-100 border-b border-slate-200 px-4 sm:px-8 py-2 flex items-center justify-between text-sm">
              <div className="flex items-center text-slate-800">
                {clipboard.action === 'cut' ? <Scissors size={16} className="mr-2" /> : <Copy size={16} className="mr-2" />}
                <span>{clipboard.ids.length} item(s) ready to {clipboard.action}</span>
              </div>
              <div className="flex space-x-2">
                <button onClick={() => setClipboard(null)} className="px-3 py-1.5 text-slate-600 hover:bg-slate-200 rounded-md transition-colors">Cancel</button>
                <button onClick={handlePaste} className="px-3 py-1.5 bg-black text-white hover:bg-slate-800 rounded-md transition-colors flex items-center shadow-sm">
                  <ClipboardPaste size={16} className="mr-1.5" />
                  Paste Here
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Content Area */}
        {currentFolder.type === 'shortcut' && currentFolder.shortcutShareId ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <ShareView 
              shareId={currentFolder.shortcutShareId} 
              isShortcutView={true} 
              onRemoveShortcut={() => {
                handleDeleteFolder(currentFolder.id);
                handleOpenFolder('root');
              }}
              onGoBackToApp={() => handleOpenFolder('root')}
              onSaveSuccess={() => showToast("Shortcut added to your Root folder")}
            />
          </div>
        ) : (
          <div 
            className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar"
            onClick={() => {
              if (selectedItemIds.length > 0 || explicitBulkMode) {
                setSelectedItemIds([]);
                setExplicitBulkMode(false);
              }
            }}
          >
            <div className="max-w-7xl mx-auto">
              
              {searchResults ? (
              <div>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
                  Search Results for "{searchQuery}"
                </h2>
                
                {searchResults.folders.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Folders</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {searchResults.folders.map(folder => (
                        <FolderCard 
                          key={folder.id}
                          folder={folder}
                          onDoubleClick={() => {
                            handleOpenFolder(folder.id);
                            setSearchQuery('');
                          }}
                          onClick={(e) => toggleItemSelection(folder.id, e)}
                          onUpdate={(updatedFolder) => handleUpdateFolder(updatedFolder)}
                          onDeleteRequest={(f) => setFolderToDelete(f)}
                          onShareRequest={(f) => { setFolderToShare(f); setIsShareModalOpen(true); }}
                          isSelected={selectedItemIds.includes(folder.id)}
                          user={user}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {searchResults.links.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Items</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {searchResults.links.map(item => (
                        <LinkCard 
                          key={item.link.id} 
                          link={item.link} 
                          onUpdate={handleUpdateLink}
                          onDelete={handleDeleteLink}
                          isSelected={selectedItemIds.includes(item.link.id)}
                          onClick={(e) => toggleItemSelection(item.link.id, e)}
                          onOpenNote={setViewNoteItem}
                          onOpen={(link) => handleOpenLink(link, item.parentFolderId)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {searchResults.folders.length === 0 && searchResults.links.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                      <Search size={32} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-800 mb-1">No results found</h3>
                    <p className="text-sm text-slate-500 max-w-sm">We couldn't find anything matching "{searchQuery}". Try a different search term.</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Folders Section */}
                {(currentFolder.folders.length > 0 || currentFolderId !== 'root') && (
                  <div className="mb-8">
                    <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Folders</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {currentFolderId !== 'root' && (
                        <UpFolderCard 
                          onClick={() => {
                            const parentId = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : 'root';
                            handleOpenFolder(parentId);
                          }}
                          parentName={breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].name : 'Root'}
                        />
                      )}
                      {currentFolder.folders.map(folder => (
                        <FolderCard 
                          key={folder.id}
                          folder={folder}
                          onDoubleClick={() => handleOpenFolder(folder.id)}
                          onClick={(e) => toggleItemSelection(folder.id, e)}
                          onUpdate={(updatedFolder) => handleUpdateFolder(updatedFolder)}
                          onDeleteRequest={(f) => setFolderToDelete(f)}
                          onShareRequest={(f) => { setFolderToShare(f); setIsShareModalOpen(true); }}
                          isSelected={selectedItemIds.includes(folder.id)}
                          user={user}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Items Section */}
                {currentFolder.links.length > 0 && (
                  <div>
                    <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Items</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {currentFolder.links.map(link => (
                        <LinkCard 
                          key={link.id} 
                          link={link} 
                          onUpdate={handleUpdateLink}
                          onDelete={handleDeleteLink}
                          isSelected={selectedItemIds.includes(link.id)}
                          onClick={(e) => toggleItemSelection(link.id, e)}
                          onOpenNote={setViewNoteItem}
                          onOpen={(link) => handleOpenLink(link, currentFolderId)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {currentFolder.folders.length === 0 && currentFolder.links.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-64 text-center">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                      <FolderIcon size={32} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-800 mb-1">This folder is empty</h3>
                    <p className="text-sm text-slate-500 max-w-sm mb-6">Create a new folder or add a link to get started organizing your content.</p>
                    <div className="flex space-x-3">
                      <button 
                        onClick={() => setIsCreateFolderModalOpen(true)}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                      >
                        New Folder
                      </button>
                      <button 
                        onClick={() => setIsAddLinkModalOpen(true)}
                        className="px-4 py-2 bg-black rounded-lg text-sm font-medium text-white hover:bg-slate-800 transition-colors shadow-sm"
                      >
                        Add Link
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        )}
      </main>

      {/* Share Folder Modal */}
      {isShareModalOpen && folderToShare && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-800 flex items-center">
                <Globe size={20} className="mr-2 text-blue-500" />
                Share "{folderToShare.name}"
              </h2>
              <button onClick={() => setIsShareModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-5">
              {!folderToShare.isPublic ? (
                <div className="text-center py-4">
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Globe size={32} className="text-blue-500" />
                  </div>
                  <h3 className="text-lg font-medium text-slate-800 mb-2">Make this folder public</h3>
                  <p className="text-sm text-slate-500 mb-6">
                    Anyone with the link will be able to view this folder and its contents. They won't be able to edit or delete anything.
                  </p>
                  <button
                    onClick={async () => {
                      if (!user) return;
                      const shareId = generateId();
                      const updatedFolder = { ...setPublicRecursive(folderToShare, true), shareId };
                      handleUpdateFolder(updatedFolder);
                      
                      // Also create publicFolders document
                      try {
                        await setDoc(doc(db, 'publicFolders', shareId), {
                          userId: user.uid,
                          folderId: folderToShare.id,
                          folderName: folderToShare.name,
                          ownerName: user.displayName || 'Someone',
                          ownerPhotoUrl: user.photoURL || null,
                          createdAt: Date.now()
                        });
                      } catch (err) {
                        console.error("Failed to create public folder index", err);
                      }
                      setFolderToShare(updatedFolder);
                    }}
                    className="w-full py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
                  >
                    Create shareable link
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">Shareable Link</label>
                    <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center">
                      <Globe size={10} className="mr-1" /> Public
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 mb-4">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/#/share/${folderToShare.shareId}`}
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600 focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/#/share/${folderToShare.shareId}`);
                        showToast('Link copied to clipboard!');
                      }}
                      className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                      title="Copy link"
                    >
                      <Copy size={18} />
                    </button>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6 flex items-start">
                    <AlertTriangle size={16} className="text-amber-500 mt-0.5 mr-2 flex-shrink-0" />
                    <p className="text-xs text-amber-700">
                      <strong>Warning:</strong> Anyone with this link can view this folder and all its subfolders and items.
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      if (!user || !folderToShare.shareId) return;
                      const shareId = folderToShare.shareId;
                      const updatedFolder = { ...setPublicRecursive(folderToShare, false), shareId: undefined };
                      handleUpdateFolder(updatedFolder);
                      
                      // Delete publicFolders document
                      try {
                        await deleteDoc(doc(db, 'publicFolders', shareId));
                      } catch (err) {
                        console.error("Failed to delete public folder index", err);
                      }
                      setFolderToShare(updatedFolder);
                    }}
                    className="w-full py-2.5 bg-white border border-red-200 text-red-600 rounded-lg font-medium hover:bg-red-50 transition-colors"
                  >
                    Revoke access
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      
      {/* Add Note Modal */}
      {isAddNoteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-800">Add New Note</h3>
              <button onClick={() => setIsAddNoteModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddNote} className="p-6">
              <div className="mb-4">
                <label htmlFor="noteTitle" className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  id="noteTitle"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-slate-800"
                  placeholder="e.g., Meeting Notes"
                  autoFocus
                />
              </div>
              <div className="mb-6">
                <label htmlFor="noteContent" className="block text-sm font-medium text-slate-700 mb-1">Content</label>
                <textarea
                  id="noteContent"
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-slate-800 min-h-[150px] resize-y"
                  placeholder="Write your note here..."
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsAddNoteModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newNoteTitle.trim() && !newNoteContent.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View/Edit Note Modal */}
      {viewNoteItem && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-emerald-50/50">
              <div className="flex items-center text-emerald-700">
                <FileText size={20} className="mr-2" />
                <h3 className="text-lg font-semibold">{viewNoteItem.title}</h3>
              </div>
              <button onClick={() => { setViewNoteItem(null); setIsEditingNote(false); }} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {isEditingNote ? (
                <textarea
                  value={editNoteContent}
                  onChange={(e) => {
                    setEditNoteContent(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onFocus={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  className="w-full min-h-[300px] p-3 border-2 border-black rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:border-black resize-none text-slate-700 leading-relaxed bg-white overflow-hidden"
                  placeholder="Write your note here..."
                  autoFocus
                />
              ) : (
                <div className="prose prose-slate max-w-none min-h-[300px]">
                  <p className="whitespace-pre-wrap text-slate-700 leading-relaxed">{viewNoteItem.content || 'Empty note...'}</p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50">
              <span className="text-xs text-slate-400">
                Last edited: {new Date(viewNoteItem.dateAdded).toLocaleString()}
              </span>
              <div className="flex space-x-3">
                {isEditingNote ? (
                  <>
                    <button
                      onClick={() => setIsEditingNote(false)}
                      className="px-4 py-2 text-sm font-medium text-black bg-white border border-black rounded-lg hover:bg-black hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleUpdateNoteContent(viewNoteItem.id, editNoteContent)}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors flex items-center"
                    >
                      <Check size={16} className="mr-2" />
                      Save
                    </button>
                  </>
                ) : (
                  <>
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
                    <button
                      onClick={() => {
                        setEditNoteContent(viewNoteItem.content || '');
                        setIsEditingNote(true);
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors flex items-center"
                    >
                      <Edit2 size={16} className="mr-2" />
                      Edit
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Unity Modal */}
      {isUnityModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-800">Unity in New Folder</h3>
              <button onClick={() => setIsUnityModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleUnity} className="p-6">
              <p className="text-sm text-slate-600 mb-4">Create a new folder to move {selectedItemIds.length} items into:</p>
              <div className="mb-4">
                <label htmlFor="unityFolderName" className="block text-sm font-medium text-slate-700 mb-1">Folder Name</label>
                <input
                  type="text"
                  id="unityFolderName"
                  value={unityFolderName}
                  onChange={(e) => setUnityFolderName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-slate-800"
                  placeholder="e.g., Project Resources"
                  autoFocus
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsUnityModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!unityFolderName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create & Move
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Folder Modal */}
      {folderToDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-red-100 bg-red-50 flex justify-between items-center">
              <div className="flex items-center text-red-600">
                <AlertTriangle size={20} className="mr-2" />
                <h3 className="text-lg font-semibold">Delete {folderToDelete.type === 'shortcut' ? 'Shortcut' : 'Folder'}</h3>
              </div>
              <button onClick={() => { setFolderToDelete(null); setDeleteConfirmationText(''); }} className="text-red-400 hover:text-red-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              {folderToDelete.type === 'shortcut' ? (
                <>
                  <p className="text-sm text-slate-700 mb-4">
                    Remove shortcut to <strong>"{folderToDelete.name}"</strong>?
                  </p>
                  <p className="text-sm text-slate-500 mb-6">
                    This will only remove the shortcut, not the original folder.
                  </p>
                  <div className="flex justify-end space-x-3 mt-6">
                    <button
                      type="button"
                      onClick={() => { setFolderToDelete(null); setDeleteConfirmationText(''); }}
                      className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={deleteCountdown > 0}
                      onClick={() => {
                        handleDeleteFolder(folderToDelete.id);
                        setFolderToDelete(null);
                        setDeleteConfirmationText('');
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deleteCountdown > 0 ? `Delete (${deleteCountdown})` : 'Delete'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-700 mb-4">
                    You are about to delete the folder <strong>"{folderToDelete.name}"</strong>.
                  </p>
                  
                  {(folderToDelete.folders.length > 0 || folderToDelete.links.length > 0) && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-orange-800 font-medium mb-1">Warning: This folder is not empty!</p>
                      <p className="text-xs text-orange-700">
                        It contains {folderToDelete.folders.length} sub-folder(s) and {folderToDelete.links.length} item(s). 
                        Deleting this folder will permanently remove all its contents.
                      </p>
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      To confirm, type <strong>{folderToDelete.name}</strong> below:
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={deleteConfirmationText}
                      onChange={(e) => setDeleteConfirmationText(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      placeholder={folderToDelete.name}
                    />
                  </div>

                  <div className="flex justify-end space-x-3 mt-6">
                    <button
                      type="button"
                      onClick={() => { setFolderToDelete(null); setDeleteConfirmationText(''); }}
                      className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={deleteConfirmationText !== folderToDelete.name}
                      onClick={() => {
                        handleDeleteFolder(folderToDelete.id);
                        setFolderToDelete(null);
                        setDeleteConfirmationText('');
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete Permanently
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {isCreateFolderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-800">Create New Folder</h3>
              <button onClick={() => setIsCreateFolderModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="p-6">
              <div className="mb-4">
                <label htmlFor="folderName" className="block text-sm font-medium text-slate-700 mb-1">Folder Name</label>
                <input
                  id="folderName"
                  type="text"
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-slate-800"
                  placeholder="e.g., Research, Inspiration, Work"
                />
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsCreateFolderModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Link Modal */}
      {isAddLinkModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-800">Add New Link</h3>
              <button onClick={() => setIsAddLinkModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddLink} className="p-6">
              <div className="mb-4">
                <label htmlFor="linkUrl" className="block text-sm font-medium text-slate-700 mb-1">URL</label>
                <input
                  id="linkUrl"
                  type="url"
                  autoFocus
                  required
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-slate-800"
                  placeholder="https://example.com"
                />
              </div>
              <div className="mb-4">
                <label htmlFor="linkTitle" className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                <input
                  id="linkTitle"
                  type="text"
                  required
                  value={newLinkTitle}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-slate-800"
                  placeholder="A descriptive title"
                />
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsAddLinkModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newLinkUrl.trim() || !newLinkTitle.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col relative z-[10000]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-semibold text-slate-800 flex items-center">
                <Settings size={20} className="mr-2 text-slate-500" />
                Settings
              </h3>
              <button 
                onClick={() => setIsSettingsModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {/* Profile Section */}
              <div className="mb-8">
                <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">Profile</h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Display Name</label>
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={displayNameInput}
                        onChange={(e) => setDisplayNameInput(e.target.value)}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-slate-800"
                        placeholder="Your name"
                      />
                      <button
                        onClick={handleSaveProfile}
                        disabled={!displayNameInput.trim() || displayNameInput === user?.displayName}
                        className="px-4 py-2 text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input
                      type="text"
                      value={user?.email || ''}
                      disabled
                      className="w-full px-3 py-2 border border-slate-200 bg-slate-50 text-slate-500 rounded-lg cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>

              {/* Contact & Community Section */}
              <div className="mb-8">
                <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">Contact & Community</h4>
                
                <div className="space-y-6">
                  {/* Community */}
                  <div>
                    <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Community</h5>
                    <a 
                      href="https://discord.gg/s3q8Fa7gkM" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center justify-between w-full p-3 border border-slate-200 rounded-xl hover:bg-[#5865F2]/5 transition-colors group"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-lg bg-[#5865F2]/10 flex items-center justify-center text-[#5865F2]">
                          <span className="text-xl">🎮</span>
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium text-slate-800 group-hover:text-[#5865F2] transition-colors">Join our Discord</p>
                          <p className="text-xs text-slate-500">Share feedback, suggestions, or just say hi</p>
                        </div>
                      </div>
                      <div className="text-slate-400 group-hover:text-[#5865F2] transition-colors flex items-center space-x-1">
                        <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
                        <ExternalLink size={14} />
                      </div>
                    </a>
                  </div>

                  {/* Follow Us */}
                  <div>
                    <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Follow Us</h5>
                    <div className="space-y-3">
                      <a 
                        href="https://www.instagram.com/aktprojects_/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center justify-between w-full p-3 border border-slate-200 rounded-xl hover:bg-pink-50 transition-colors group"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-[#fd5949] to-[#d6249f] flex items-center justify-center text-white">
                            <Instagram size={20} />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-medium text-slate-800 group-hover:text-[#d6249f] transition-colors">@aktprojects_</p>
                            <p className="text-xs text-slate-500">Project Updates</p>
                          </div>
                        </div>
                        <div className="text-slate-400 group-hover:text-[#d6249f] transition-colors flex items-center space-x-1">
                          <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
                          <ExternalLink size={14} />
                        </div>
                      </a>

                      <a 
                        href="https://www.instagram.com/tsaqifnico_/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center justify-between w-full p-3 border border-slate-200 rounded-xl hover:bg-pink-50 transition-colors group"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-[#fd5949] to-[#d6249f] flex items-center justify-center text-white">
                            <Instagram size={20} />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-medium text-slate-800 group-hover:text-[#d6249f] transition-colors">@tsaqifnico_</p>
                            <p className="text-xs text-slate-500">Developer</p>
                          </div>
                        </div>
                        <div className="text-slate-400 group-hover:text-[#d6249f] transition-colors flex items-center space-x-1">
                          <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">Open</span>
                          <ExternalLink size={14} />
                        </div>
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Usage Stats Section */}
              <div className="mb-8">
                <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">Usage Statistics</h4>
                {isFetchingStats ? (
                  <div className="flex justify-center py-4">
                    <div className="loader border-t-slate-800 border-2 w-6 h-6"></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <div className="text-2xl font-semibold text-slate-800">{usageStats.folders}</div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">Folders</div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <div className="text-2xl font-semibold text-slate-800">{usageStats.links}</div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">Links</div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <div className="text-2xl font-semibold text-slate-800">{usageStats.notes}</div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">Notes</div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <div className="text-2xl font-semibold text-slate-800">{usageStats.shared}</div>
                      <div className="text-xs text-slate-500 uppercase tracking-wide mt-1">Shared Folders</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Danger Zone Section */}
              <div>
                <h4 className="text-sm font-semibold text-red-600 uppercase tracking-wider mb-4 border-b border-red-100 pb-2">Danger Zone</h4>
                <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                  <h5 className="font-medium text-red-800 mb-1">Delete Account</h5>
                  <p className="text-sm text-red-600/80 mb-4">
                    Permanently delete your account and all associated data. This action cannot be undone.
                  </p>
                  <button
                    onClick={() => setIsDeleteAccountModalOpen(true)}
                    disabled={isDeletingAccount}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center"
                  >
                    {isDeletingAccount ? (
                      <>
                        <div className="loader border-t-white border-2 w-4 h-4 mr-2"></div>
                        Deleting...
                      </>
                    ) : (
                      'Delete Account'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {isDeleteAccountModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[10000] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-red-100 bg-red-50 flex justify-between items-center">
              <div className="flex items-center text-red-600">
                <AlertTriangle size={20} className="mr-2" />
                <h3 className="text-lg font-semibold">Delete Account</h3>
              </div>
              <button 
                onClick={() => setIsDeleteAccountModalOpen(false)} 
                disabled={isDeletingAccount}
                className="text-red-400 hover:text-red-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-700 mb-4">
                Are you absolutely sure you want to delete your account? This will permanently erase all your folders, links, and notes.
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
                <p className="text-sm text-red-800 font-medium">This action CANNOT be undone.</p>
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsDeleteAccountModalOpen(false)}
                  disabled={isDeletingAccount}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={isDeletingAccount}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center"
                >
                  {isDeletingAccount ? (
                    <>
                      <div className="loader border-t-white border-2 w-4 h-4 mr-2"></div>
                      Deleting...
                    </>
                  ) : (
                    'Delete Permanently'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile FAB */}
      <div className="md:hidden fixed bottom-6 right-6 z-[1000]">
        <AnimatePresence>
          {isFabOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[-1]" 
                onClick={() => setIsFabOpen(false)}
              />
              <div className="absolute bottom-full right-0 mb-4 flex flex-col items-end space-y-3">
                <motion.button
                  custom={2}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={itemVariants}
                  onClick={() => {
                    setIsFabOpen(false);
                    setIsCreateFolderModalOpen(true);
                  }}
                  className="flex items-center space-x-3 group"
                >
                  <span className="bg-white px-3 py-1.5 rounded-full shadow-sm text-slate-800 text-[13px] font-medium border border-slate-100">New Folder</span>
                  <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-800">
                    <FolderIcon size={18} />
                  </div>
                </motion.button>
                
                <motion.button
                  custom={1}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={itemVariants}
                  onClick={() => {
                    setIsFabOpen(false);
                    setIsAddNoteModalOpen(true);
                  }}
                  className="flex items-center space-x-3 group"
                >
                  <span className="bg-white px-3 py-1.5 rounded-full shadow-sm text-slate-800 text-[13px] font-medium border border-slate-100">Add Note</span>
                  <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-800">
                    <FileText size={18} />
                  </div>
                </motion.button>

                <motion.button
                  custom={0}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  variants={itemVariants}
                  onClick={() => {
                    setIsFabOpen(false);
                    setIsAddLinkModalOpen(true);
                  }}
                  className="flex items-center space-x-3 group"
                >
                  <span className="bg-white px-3 py-1.5 rounded-full shadow-sm text-slate-800 text-[13px] font-medium border border-slate-100">Add Link</span>
                  <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-800">
                    <LinkIcon size={18} />
                  </div>
                </motion.button>
              </div>
            </>
          )}
        </AnimatePresence>
        
        <button
          onClick={() => setIsFabOpen(!isFabOpen)}
          className="w-[120px] h-12 bg-black text-white rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-colors duration-200"
        >
          <motion.div
            animate={{ rotate: isFabOpen ? 45 : 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <Plus size={20} />
          </motion.div>
          <span className="text-[15px] font-medium">Add</span>
        </button>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[10001] animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className={`px-4 py-3 rounded-xl shadow-lg border flex items-center space-x-3 ${
            toast.type === 'error' 
              ? 'bg-red-50 border-red-200 text-red-800' 
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}>
            {toast.type === 'error' ? <AlertTriangle size={18} /> : <Check size={18} />}
            <p className="text-sm font-medium">{toast.message}</p>
            <button 
              onClick={() => setToast(null)}
              className={`p-1 rounded-md transition-colors ${
                toast.type === 'error' ? 'hover:bg-red-100' : 'hover:bg-emerald-100'
              }`}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
