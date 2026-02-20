import { useState } from 'react';
import { IconButton } from './IconButton';
import { DropboxButton } from './DropboxButton';
import { CurrencyPopover } from './CurrencyPopover';
import { PowerIcon, PaletteIcon, TrendingUpIcon, ChatIcon, CounterIcon, AliasIcon, TriggerIcon, NotesIcon, GearIcon, CoinIcon, MapIcon } from './icons';
import { getPlatform } from '../lib/platform';
import { cn } from '../lib/cn';
import { usePanelContext } from '../contexts/PanelLayoutContext';

interface ToolbarProps {
  connected: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}

export function Toolbar({
  connected,
  onReconnect,
  onDisconnect,
}: ToolbarProps) {
  const { activePanel, togglePanel, isPinned } = usePanelContext();
  const [showCurrency, setShowCurrency] = useState(false);

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
          toggled={activePanel === 'chat'}
          pinned={isPinned('chat')}
          onClick={() => togglePanel('chat')}
        />
        <IconButton
          icon={<CounterIcon />}
          title="Counters"
          accent="#f59e0b"
          toggled={activePanel === 'counter'}
          pinned={isPinned('counter')}
          onClick={() => togglePanel('counter')}
        />
        <IconButton
          icon={<TrendingUpIcon />}
          title="Skills"
          accent="#50fa7b"
          toggled={activePanel === 'skills'}
          pinned={isPinned('skills')}
          onClick={() => togglePanel('skills')}
        />
        <IconButton
          icon={<NotesIcon />}
          title="Notes"
          accent="#fbbf24"
          toggled={activePanel === 'notes'}
          pinned={isPinned('notes')}
          onClick={() => togglePanel('notes')}
        />
        <IconButton
          icon={<MapIcon />}
          title="Map"
          accent="#e8a849"
          toggled={activePanel === 'map'}
          pinned={isPinned('map')}
          onClick={() => togglePanel('map')}
        />
        <div className="relative">
          <IconButton
            icon={<CoinIcon />}
            title="Currency Converter"
            accent="#cd7f32"
            toggled={showCurrency}
            onClick={() => setShowCurrency((v) => !v)}
          />
          <CurrencyPopover open={showCurrency} onClose={() => setShowCurrency(false)} />
        </div>
        <div className="w-px h-[18px] bg-border-dim mx-1.5" />
        <IconButton
          icon={<AliasIcon />}
          title="Aliases"
          accent="#a78bfa"
          toggled={activePanel === 'aliases'}
          onClick={() => togglePanel('aliases')}
        />
        <IconButton
          icon={<TriggerIcon />}
          title="Triggers"
          accent="#ff79c6"
          toggled={activePanel === 'triggers'}
          onClick={() => togglePanel('triggers')}
        />
        <IconButton
          icon={<PaletteIcon />}
          title="Appearance"
          accent="#8be9fd"
          toggled={activePanel === 'appearance'}
          onClick={() => togglePanel('appearance')}
        />
        <IconButton
          icon={<GearIcon />}
          title="Settings"
          accent="#bd93f9"
          toggled={activePanel === 'settings'}
          onClick={() => togglePanel('settings')}
        />
      </div>
    </div>
  );
}
