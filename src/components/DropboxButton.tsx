import { useState } from 'react';
import { useDropbox } from '../contexts/DropboxContext';
import { saveStorageMode } from '../lib/dropbox';
import { DropboxFolderPicker } from './DropboxFolderPicker';
import { CloudIcon } from './icons';
import { cn } from '../lib/cn';

export function DropboxButton() {
  const { status, folderPath, connect } = useDropbox();
  const [showPicker, setShowPicker] = useState(false);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';
  const isError = status === 'error';

  function handleClick() {
    if (isConnected) {
      // Connected: show folder picker (to change folder or disconnect)
      setShowPicker(true);
    } else {
      // Upgrade from local to dropbox mode
      saveStorageMode('dropbox');
      connect();
    }
  }

  const title = isConnected
    ? folderPath
      ? `Dropbox: ${folderPath}`
      : 'Dropbox connected — select a folder'
    : isConnecting
      ? 'Connecting to Dropbox...'
      : isError
        ? 'Dropbox error — click to retry'
        : 'Connect Dropbox';

  return (
    <>
      <button
        onClick={handleClick}
        disabled={isConnecting}
        title={title}
        className={cn(
          'flex items-center justify-center w-[30px] h-[30px] p-0 rounded-[6px]',
          'select-none leading-none transition-all duration-200 ease-in-out border',
          isConnecting && 'cursor-default text-text-dim border-border-dim animate-pulse',
          !isConnecting &&
            !isConnected &&
            !isError &&
            'cursor-pointer text-text-dim border-border-faint hover:text-text-muted hover:border-border-dim',
          isConnected &&
            folderPath &&
            'cursor-pointer text-connected border-connected/25 bg-connected/8',
          isConnected &&
            !folderPath &&
            'cursor-pointer text-yellow-400 border-yellow-400/25 bg-yellow-400/8',
          isError && 'cursor-pointer text-disconnected border-disconnected/25 bg-disconnected/8'
        )}
        style={
          isConnected && folderPath
            ? { filter: 'drop-shadow(0 0 4px rgba(34, 197, 94, 0.3))' }
            : isError
              ? { filter: 'drop-shadow(0 0 4px rgba(239, 68, 68, 0.3))' }
              : undefined
        }
      >
        <CloudIcon />
      </button>

      {showPicker && isConnected && <DropboxFolderPicker onClose={() => setShowPicker(false)} />}
    </>
  );
}
