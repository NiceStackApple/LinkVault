import React, { useState, useEffect, useRef } from 'react';
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
  ClipboardPaste
} from 'lucide-react';

type LinkType = 'youtube' | 'tiktok' | 'instagram' | 'general' | 'note';

interface LinkItem {
  id: string;
  title: string;
  url: string;
  content?: string;
  type: LinkType;
  dateAdded: number;
  starred?: boolean;
}

interface Folder {
  id: string;
  name: string;
  folders: Folder[];
  links: LinkItem[];
  starred?: boolean;
  color?: string;
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

const detectLinkType = (url: string): LinkType => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  if (lowerUrl.includes('tiktok.com')) return 'tiktok';
  if (lowerUrl.includes('instagram.com')) return 'instagram';
  return 'general';
};

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
  onOpenNote?: (l: LinkItem) => void
}> = ({ link, onUpdate, onDelete, isSelected, onClick, onDoubleClick, onOpenNote }) => {
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
    } else if (link.type === 'note' && onOpenNote) {
      onOpenNote(link);
    } else if (link.url) {
      window.open(link.url, '_blank');
    }
  };

  return (
    <div 
      className={`group bg-white/60 backdrop-blur-md border shadow-sm hover:shadow-md rounded-xl overflow-visible flex flex-col transition-all relative cursor-pointer ${isSelected ? 'border-slate-800 ring-1 ring-slate-800 bg-slate-100/50' : 'border-white/40'}`}
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
                <Edit2 size={12} />
                <span>Edit</span>
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

const FolderCard: React.FC<{ 
  folder: Folder, 
  onDoubleClick: () => void, 
  onClick?: (e: React.MouseEvent) => void,
  onUpdate: (f: Folder) => void, 
  onDeleteRequest: (f: Folder) => void,
  isSelected?: boolean
}> = ({ folder, onDoubleClick, onClick, onUpdate, onDeleteRequest, isSelected }) => {
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
      className={`group bg-white/60 backdrop-blur-md border shadow-sm hover:shadow-md rounded-xl p-4 flex items-center cursor-pointer transition-all hover:border-slate-300 relative overflow-visible ${isSelected ? 'border-slate-800 ring-1 ring-slate-800 bg-slate-100/50' : 'border-white/40'}`}
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
      </div>
      <div className="flex-1 min-w-0">
        <EditableFolderName 
          name={folder.name} 
          onSave={(newName) => onUpdate({ ...folder, name: newName })} 
          isEditing={isEditing}
          setIsEditing={setIsEditing}
        />
        <p className="text-xs text-slate-500 mt-0.5">{folder.folders.length} folders, {folder.links.length} items</p>
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
        <FolderIcon size={16} className={`mr-2 ${isSelected ? 'text-slate-800' : 'text-slate-400'}`} />
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

export default function App() {
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

  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [explicitBulkMode, setExplicitBulkMode] = useState(false);
  const isBulkMode = selectedItemIds.length >= 2 || explicitBulkMode;
  
  const [clipboard, setClipboard] = useState<{ ids: string[], action: 'copy' | 'cut' } | null>(null);
  
  const [isUnityModalOpen, setIsUnityModalOpen] = useState(false);
  const [unityFolderName, setUnityFolderName] = useState('');

  // Modals
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false);
  const [viewNoteItem, setViewNoteItem] = useState<LinkItem | null>(null);
  
  // Form states
  const [newFolderName, setNewFolderName] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');

  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-save
  useEffect(() => {
    localStorage.setItem('linkvault_backup', JSON.stringify(rootFolder));
  }, [rootFolder]);

  const currentFolder = findFolder(rootFolder, currentFolderId) || rootFolder;
  const breadcrumbs = getBreadcrumbs(rootFolder, currentFolderId) || [rootFolder];

  const searchVault = (root: Folder, query: string): { folders: Folder[], links: LinkItem[] } => {
    const lowerQuery = query.toLowerCase();
    let results = { folders: [] as Folder[], links: [] as LinkItem[] };

    const searchRecursive = (folder: Folder) => {
      if (folder.name.toLowerCase().includes(lowerQuery) && folder.id !== 'root') {
        results.folders.push(folder);
      }
      for (const link of folder.links) {
        if (link.title.toLowerCase().includes(lowerQuery) || link.url.toLowerCase().includes(lowerQuery)) {
          results.links.push(link);
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
    
    const newFolder: Folder = {
      id: generateId(),
      name: newFolderName.trim(),
      folders: [],
      links: []
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
    
    const newLink: LinkItem = {
      id: generateId(),
      title: newLinkTitle.trim(),
      url,
      type,
      dateAdded: Date.now()
    };
    
    setRootFolder(prev => updateFolder(prev, currentFolderId, f => ({
      ...f,
      links: [...f.links, newLink]
    })));
    
    setNewLinkUrl('');
    setNewLinkTitle('');
    setIsAddLinkModalOpen(false);
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
      dateAdded: Date.now()
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
    
    const newFolderId = Date.now().toString();
    const newFolder: Folder = {
      id: newFolderId,
      name: unityFolderName.trim(),
      folders: [],
      links: []
    };

    setRootFolder(prev => {
      const itemsToMove = getTopLevelSelectedItems(prev, selectedItemIds);
      let treeWithoutItems = removeItemsByIds(prev, selectedItemIds);
      
      newFolder.folders = itemsToMove.folders;
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
          alert("Invalid backup file format.");
        }
      } catch (err) {
        alert("Error parsing backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-slate-200 selection:text-slate-900">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-20 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-30 w-72 bg-white/80 backdrop-blur-xl border-r border-slate-200/60 
        flex flex-col transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-5 border-b border-slate-200/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img src="/favicon.png" alt="LinkVaultPro Logo" className="w-8 h-8 rounded-lg" referrerPolicy="no-referrer" />
            <h1 className="text-xl font-bold tracking-tight text-black">LinkVault<span className="font-normal">Pro</span></h1>
          </div>
          <button className="lg:hidden text-slate-500 hover:text-slate-800" onClick={() => setIsSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          <SidebarFolder 
            folder={rootFolder} 
            currentFolderId={currentFolderId} 
            onSelect={(id) => { setCurrentFolderId(id); setIsSidebarOpen(false); }} 
          />
        </div>

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
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100/50">
        {/* Header Area */}
        <div className="sticky top-0 z-10 flex flex-col shadow-sm">
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
              <div className="flex items-center min-w-0">
                <button 
                  className="mr-2 lg:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-md flex-shrink-0"
                  onClick={() => setIsSidebarOpen(true)}
                >
                  <Menu size={20} />
                </button>
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
                  className="flex items-center space-x-1.5 py-1.5 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                >
                  <FolderIcon size={16} className="text-slate-500" />
                  <span className="hidden sm:inline">New Folder</span>
                </button>
                <button 
                  onClick={() => setIsAddNoteModalOpen(true)}
                  className="flex items-center space-x-1.5 py-1.5 px-3 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                >
                  <FileText size={16} className="text-slate-500" />
                  <span className="hidden sm:inline">Add Note</span>
                </button>
                <button 
                  onClick={() => setIsAddLinkModalOpen(true)}
                  className="flex items-center space-x-1.5 py-1.5 px-3 bg-black rounded-lg text-sm font-medium text-white hover:bg-slate-800 transition-all shadow-sm shadow-slate-200"
                >
                  <Plus size={16} />
                  <span className="hidden sm:inline">Add Link</span>
                </button>
              </div>
            </header>
          )}

          {/* Breadcrumbs Row */}
          <div className="px-4 sm:px-8 py-2 flex items-center space-x-1 sm:space-x-2 text-sm text-slate-500 overflow-x-auto whitespace-nowrap hide-scrollbar border-b border-slate-200/60 bg-slate-50/90 backdrop-blur-md">
            {breadcrumbs.map((f, i) => (
              <React.Fragment key={f.id}>
                <span 
                  className={`cursor-pointer transition-colors font-medium ${i === breadcrumbs.length - 1 ? 'text-slate-800' : 'hover:text-black'}`}
                  onClick={() => setCurrentFolderId(f.id)}
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
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
                            setCurrentFolderId(folder.id);
                            setSearchQuery('');
                          }}
                          onClick={(e) => toggleItemSelection(folder.id, e)}
                          onUpdate={(updatedFolder) => handleUpdateFolder(updatedFolder)}
                          onDeleteRequest={(f) => setFolderToDelete(f)}
                          isSelected={selectedItemIds.includes(folder.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {searchResults.links.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Items</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {searchResults.links.map(link => (
                        <LinkCard 
                          key={link.id} 
                          link={link} 
                          onUpdate={handleUpdateLink}
                          onDelete={handleDeleteLink}
                          isSelected={selectedItemIds.includes(link.id)}
                          onClick={(e) => toggleItemSelection(link.id, e)}
                          onOpenNote={setViewNoteItem}
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
                {currentFolder.folders.length > 0 && (
                  <div className="mb-8">
                    <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Folders</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {currentFolder.folders.map(folder => (
                        <FolderCard 
                          key={folder.id}
                          folder={folder}
                          onDoubleClick={() => setCurrentFolderId(folder.id)}
                          onClick={(e) => toggleItemSelection(folder.id, e)}
                          onUpdate={(updatedFolder) => handleUpdateFolder(updatedFolder)}
                          onDeleteRequest={(f) => setFolderToDelete(f)}
                          isSelected={selectedItemIds.includes(folder.id)}
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
      </main>

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
              <button onClick={() => setViewNoteItem(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <textarea
                value={viewNoteItem.content || ''}
                onChange={(e) => handleUpdateNoteContent(viewNoteItem.id, e.target.value)}
                className="w-full h-full min-h-[300px] p-0 border-0 focus:ring-0 resize-none text-slate-700 leading-relaxed bg-transparent"
                placeholder="Write your note here..."
              />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50">
              <span className="text-xs text-slate-400">
                Last edited: {new Date(viewNoteItem.dateAdded).toLocaleString()}
              </span>
              <button
                onClick={() => setViewNoteItem(null)}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
              >
                Done
              </button>
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
                <h3 className="text-lg font-semibold">Delete Folder</h3>
              </div>
              <button onClick={() => { setFolderToDelete(null); setDeleteConfirmationText(''); }} className="text-red-400 hover:text-red-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
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

    </div>
  );
}
