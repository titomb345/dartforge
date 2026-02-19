import { IconButton } from './IconButton';
import { DropboxButton } from './DropboxButton';
import { PowerIcon, PaletteIcon, TrendingUpIcon, ChatIcon, CounterIcon, AliasIcon, GearIcon } from './icons';
import { getPlatform } from '../lib/platform';
import { cn } from '../lib/cn';

interface ToolbarProps {
  connected: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
  showAppearance: boolean;
  onToggleAppearance: () => void;
  showSkills: boolean;
  onToggleSkills: () => void;
  skillsPinned?: boolean;
  showChat: boolean;
  onToggleChat: () => void;
  chatPinned?: boolean;
  showCounter: boolean;
  onToggleCounter: () => void;
  counterPinned?: boolean;
  showAliases: boolean;
  onToggleAliases: () => void;
  showSettings: boolean;
  onToggleSettings: () => void;
}

export function Toolbar({
  connected,
  onReconnect,
  onDisconnect,
  showAppearance,
  onToggleAppearance,
  showSkills,
  onToggleSkills,
  skillsPinned,
  showChat,
  onToggleChat,
  chatPinned,
  showCounter,
  onToggleCounter,
  counterPinned,
  showAliases,
  onToggleAliases,
  showSettings,
  onToggleSettings,
}: ToolbarProps) {

  return (
    <div className="flex items-center px-2.5 py-1 bg-bg-primary rounded-lg">
      <button
        onClick={connected ? onDisconnect : onReconnect}
        title={connected ? 'Disconnect' : 'Reconnect'}
        className={cn(
          'flex items-center justify-center w-[30px] h-[30px] p-0 rounded-[6px]',
          'select-none leading-none transition-all duration-300 ease-in-out border cursor-pointer',
          connected
            ? 'text-connected border-connected/25 bg-connected/8'
            : 'text-disconnected border-disconnected/25 bg-disconnected/8'
        )}
        style={{
          filter: connected
            ? 'drop-shadow(0 0 4px rgba(34, 197, 94, 0.4))'
            : 'drop-shadow(0 0 4px rgba(239, 68, 68, 0.4))',
        }}
      >
        <PowerIcon />
      </button>
      <div className="w-px h-[18px] bg-border-dim mx-1.5" />

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        {getPlatform() === 'web' && <DropboxButton />}
        <IconButton
          icon={<ChatIcon />}
          title="Chat"
          accent="#8be9fd"
          toggled={showChat}
          pinned={chatPinned}
          onClick={onToggleChat}
        />
        <IconButton
          icon={<CounterIcon />}
          title="Counters"
          accent="#f59e0b"
          toggled={showCounter}
          pinned={counterPinned}
          onClick={onToggleCounter}
        />
        <IconButton
          icon={<TrendingUpIcon />}
          title="Skills"
          accent="#50fa7b"
          toggled={showSkills}
          pinned={skillsPinned}
          onClick={onToggleSkills}
        />
        <div className="w-px h-[18px] bg-border-dim mx-1.5" />
        <IconButton
          icon={<AliasIcon />}
          title="Aliases"
          accent="#a78bfa"
          toggled={showAliases}
          onClick={onToggleAliases}
        />
        <IconButton
          icon={<PaletteIcon />}
          title="Appearance"
          accent="#8be9fd"
          toggled={showAppearance}
          onClick={onToggleAppearance}
        />
        {getPlatform() === 'tauri' && (
          <IconButton
            icon={<GearIcon />}
            title="Settings"
            accent="#bd93f9"
            toggled={showSettings}
            onClick={onToggleSettings}
          />
        )}
      </div>
    </div>
  );
}
