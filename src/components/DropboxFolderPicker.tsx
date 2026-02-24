import { useState, useEffect } from 'react';
import { useDropbox } from '../contexts/DropboxContext';
import { listFolders, listFiles, type DropboxFolderEntry } from '../lib/dropbox';
import { FolderIcon, ChevronRightIcon } from './icons';
import { cn } from '../lib/cn';

interface DropboxFolderPickerProps {
  onClose: () => void;
  /** When true, renders as a full-page blocking screen (no cancel, opaque bg) */
  blocking?: boolean;
}

export function DropboxFolderPicker({ onClose, blocking = false }: DropboxFolderPickerProps) {
  const { accessToken, selectFolder, disconnect } = useDropbox();
  const [currentPath, setCurrentPath] = useState('');
  const [folders, setFolders] = useState<DropboxFolderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasJsonFiles, setHasJsonFiles] = useState(false);
  const [checking, setChecking] = useState(false);

  // Load folders for the current path
  useEffect(() => {
    if (!accessToken) return;
    const token: string = accessToken;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [folderList, fileList] = await Promise.all([
          listFolders(token, currentPath),
          listFiles(token, currentPath),
        ]);
        if (cancelled) return;
        setFolders(folderList.sort((a, b) => a.name.localeCompare(b.name)));
        setHasJsonFiles(fileList.some((f) => f.name.endsWith('.json')));
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to list Dropbox folders:', e);
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('401')) {
          setError('Dropbox session expired. Disconnect and reconnect.');
        } else if (msg.includes('403')) {
          setError(
            'Missing permissions. Enable files.metadata.read in your Dropbox app, then disconnect and reconnect.'
          );
        } else {
          setError(`Failed to list folders: ${msg}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [accessToken, currentPath]);

  function navigateUp() {
    if (!currentPath) return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/'));
    setCurrentPath(parent);
  }

  function navigateInto(folder: DropboxFolderEntry) {
    setCurrentPath(folder.path_lower);
  }

  async function selectCurrentFolder() {
    setChecking(true);
    selectFolder(currentPath || '/');
    // In blocking mode, the phase change (PICK_FOLDER → SYNCING) unmounts this
    // component automatically. In modal mode, onClose hides the picker.
    if (!blocking) onClose();
  }

  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex items-center justify-center',
        blocking ? 'bg-[#0a0a0a]' : 'bg-black/70'
      )}
      onClick={blocking ? undefined : onClose}
    >
      {/* Atmospheric background (blocking mode only) */}
      {blocking && (
        <>
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background:
                'radial-gradient(ellipse at 50% 30%, rgba(139,233,253,0.08) 0%, transparent 60%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-20"
            style={{
              background:
                'radial-gradient(ellipse at 80% 80%, rgba(167,139,250,0.06) 0%, transparent 50%)',
            }}
          />
        </>
      )}

      <div
        className="relative w-[420px] max-w-[90vw] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Border glow */}
        <div
          className="absolute -inset-px rounded-lg opacity-40"
          style={{
            background:
              'linear-gradient(135deg, rgba(139,233,253,0.3), rgba(167,139,250,0.15), transparent 60%)',
          }}
        />

        <div className="relative bg-[#111111] rounded-lg border border-[#1e1e1e] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            <div className="text-[14px] font-semibold text-[#e0e0e0]">Select Dropbox Folder</div>
            <p className="text-[11px] text-[#666] mt-1">
              Choose the folder where your DartForge data is stored.
            </p>
          </div>

          {/* Breadcrumb */}
          <div className="px-5 pb-2">
            <div className="flex items-center gap-0.5 text-[11px] font-mono text-[#555] overflow-x-auto">
              <button
                onClick={() => setCurrentPath('')}
                className={cn(
                  'shrink-0 px-1 py-0.5 rounded hover:text-[#aaa] transition-colors cursor-pointer',
                  !currentPath && 'text-cyan'
                )}
              >
                Dropbox
              </button>
              {breadcrumbs.map((part, i) => {
                const path = '/' + breadcrumbs.slice(0, i + 1).join('/');
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <span key={path} className="flex items-center gap-0.5">
                    <ChevronRightIcon size={8} />
                    <button
                      onClick={() => setCurrentPath(path)}
                      className={cn(
                        'shrink-0 px-1 py-0.5 rounded hover:text-[#aaa] transition-colors cursor-pointer',
                        isLast && 'text-cyan'
                      )}
                    >
                      {part}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-[#1e1e1e]" />

          {/* Folder list */}
          <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[300px]">
            {loading ? (
              <div className="flex items-center justify-center h-full text-[11px] text-[#555] animate-pulse">
                Loading...
              </div>
            ) : error ? (
              <div className="p-4 text-[11px] text-disconnected">{error}</div>
            ) : (
              <div className="py-1">
                {currentPath && (
                  <button
                    onClick={navigateUp}
                    className="w-full flex items-center gap-2.5 px-5 py-2 text-left hover:bg-[#1a1a1a] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded bg-[#1e1e1e] text-[#555]">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                    </div>
                    <span className="text-[12px] text-[#888]">..</span>
                  </button>
                )}
                {folders.map((folder) => (
                  <button
                    key={folder.path_lower}
                    onClick={() => navigateInto(folder)}
                    className="w-full flex items-center gap-2.5 px-5 py-2 text-left hover:bg-[#1a1a1a] transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded bg-[#1e1e1e] text-[#555] group-hover:text-cyan transition-colors">
                      <FolderIcon size={13} />
                    </div>
                    <span className="text-[12px] text-[#bbb] group-hover:text-[#ddd] transition-colors">
                      {folder.name}
                    </span>
                  </button>
                ))}
                {folders.length === 0 && !currentPath && (
                  <div className="p-5 text-[11px] text-[#555] text-center">
                    No folders found. You can select the root.
                  </div>
                )}
                {folders.length === 0 && currentPath && (
                  <div className="p-5 text-[11px] text-[#555] text-center">No subfolders.</div>
                )}
              </div>
            )}
          </div>

          <div className="h-px bg-[#1e1e1e]" />

          {/* Footer */}
          <div className="px-5 py-3 flex items-center gap-3">
            {hasJsonFiles && (
              <div className="text-[9px] font-mono text-green uppercase tracking-wider">
                Data found
              </div>
            )}
            <button
              onClick={() => {
                disconnect();
                onClose();
              }}
              className="px-3 py-1.5 text-[11px] text-disconnected/70 hover:text-disconnected transition-colors cursor-pointer"
            >
              Disconnect
            </button>
            <div className="flex-1" />
            {!blocking && (
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-[11px] text-[#777] hover:text-[#aaa] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              onClick={selectCurrentFolder}
              disabled={loading || checking}
              className={cn(
                'px-4 py-1.5 rounded text-[11px] font-medium transition-all cursor-pointer',
                'bg-cyan/10 text-cyan border border-cyan/25 hover:bg-cyan/15 hover:border-cyan/40',
                (loading || checking) && 'opacity-50 pointer-events-none'
              )}
            >
              {checking ? 'Selecting...' : 'Use This Folder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
