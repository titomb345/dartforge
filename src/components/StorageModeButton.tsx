import { loadStorageMode, clearStorageMode } from '../lib/dropbox';
import { cn } from '../lib/cn';
import { FolderIcon } from './icons';

export function StorageModeButton() {
  const mode = loadStorageMode();

  function handleClick() {
    const label = mode === 'dropbox' ? 'Dropbox Sync' : mode === 'local' ? 'Local Storage' : 'none';
    if (confirm(`Current storage: ${label}.\n\nReset and choose again?`)) {
      clearStorageMode();
      window.location.reload();
    }
  }

  return (
    <button
      onClick={handleClick}
      title={`Storage: ${mode ?? 'not set'} — click to change`}
      className={cn(
        'flex items-center justify-center w-[30px] h-[30px] p-0 rounded-[6px]',
        'select-none leading-none transition-all duration-200 ease-in-out border',
        'cursor-pointer text-text-dim border-border-faint hover:text-text-muted hover:border-border-dim'
      )}
    >
      <FolderIcon size={14} />
    </button>
  );
}
