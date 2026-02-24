import { IconButton } from './IconButton';
import { DropboxButton } from './DropboxButton';
import {
  PowerIcon,
  PaletteIcon,
  TrendingUpIcon,
  ChatIcon,
  CounterIcon,
  AliasIcon,
  TriggerIcon,
  TimerIcon,
  VariableIcon,
  NotesIcon,
  GearIcon,
  CoinIcon,
  WhoIcon,
  /* MapIcon, */ AllocIcon,
  HelpIcon,
} from './icons';
import { getPlatform } from '../lib/platform';
import { cn } from '../lib/cn';
import { usePanelContext } from '../contexts/PanelLayoutContext';

interface ToolbarProps {
  connected: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}

export function Toolbar({ connected, onReconnect, onDisconnect }: ToolbarProps) {
  const { activePanel, togglePanel, isPinned } = usePanelContext();

  return (
    <div className="flex items-center px-2.5 py-1 bg-bg-primary rounded-lg">
      <button
        onClick={connected ? onDisconnect : onReconnect}
        title={connected ? 'Disconnect' : 'Reconnect'}
        data-help-id="toolbar-power"
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

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        {getPlatform() === 'web' && <DropboxButton />}
        <IconButton
          icon={<WhoIcon />}
          title="Who"
          accent="#61afef"
          helpId="toolbar-who"
          panelId="who"
          toggled={activePanel === 'who'}
          pinned={isPinned('who')}
          onClick={() => togglePanel('who')}
        />
        <IconButton
          icon={<ChatIcon />}
          title="Chat"
          accent="#8be9fd"
          helpId="toolbar-chat"
          panelId="chat"
          toggled={activePanel === 'chat'}
          pinned={isPinned('chat')}
          onClick={() => togglePanel('chat')}
        />
        <IconButton
          icon={<CounterIcon />}
          title="Counters"
          accent="#f59e0b"
          helpId="toolbar-counters"
          panelId="counter"
          toggled={activePanel === 'counter'}
          pinned={isPinned('counter')}
          onClick={() => togglePanel('counter')}
        />
        <IconButton
          icon={<TrendingUpIcon />}
          title="Skills"
          accent="#50fa7b"
          helpId="toolbar-skills"
          panelId="skills"
          toggled={activePanel === 'skills'}
          pinned={isPinned('skills')}
          onClick={() => togglePanel('skills')}
        />
        <IconButton
          icon={<NotesIcon />}
          title="Notes"
          accent="#fbbf24"
          helpId="toolbar-notes"
          panelId="notes"
          toggled={activePanel === 'notes'}
          pinned={isPinned('notes')}
          onClick={() => togglePanel('notes')}
        />
        {/* TODO: Re-enable when automapper is ready
        <IconButton
          icon={<MapIcon />}
          title="Map"
          accent="#e8a849"
          helpId="toolbar-map"
          panelId="map"
          toggled={activePanel === 'map'}
          pinned={isPinned('map')}
          onClick={() => togglePanel('map')}
        />
        */}
        <IconButton
          icon={<AllocIcon />}
          title="Allocations"
          accent="#e06c75"
          helpId="toolbar-alloc"
          panelId="alloc"
          toggled={activePanel === 'alloc'}
          pinned={isPinned('alloc')}
          onClick={() => togglePanel('alloc')}
        />
        <IconButton
          icon={<CoinIcon />}
          title="Currency Converter"
          accent="#cd7f32"
          helpId="toolbar-currency"
          panelId="currency"
          toggled={activePanel === 'currency'}
          pinned={isPinned('currency')}
          onClick={() => togglePanel('currency')}
        />
        <div className="w-px h-[18px] bg-border-dim mx-1.5" />
        <IconButton
          icon={<AliasIcon />}
          title="Aliases"
          accent="#a78bfa"
          helpId="toolbar-aliases"
          panelId="aliases"
          toggled={activePanel === 'aliases'}
          onClick={() => togglePanel('aliases')}
        />
        <IconButton
          icon={<TriggerIcon />}
          title="Triggers"
          accent="#ff79c6"
          helpId="toolbar-triggers"
          panelId="triggers"
          toggled={activePanel === 'triggers'}
          onClick={() => togglePanel('triggers')}
        />
        <IconButton
          icon={<TimerIcon />}
          title="Timers"
          accent="#f97316"
          helpId="toolbar-timers"
          panelId="timers"
          toggled={activePanel === 'timers'}
          onClick={() => togglePanel('timers')}
        />
        <IconButton
          icon={<VariableIcon />}
          title="Variables"
          accent="#4ade80"
          helpId="toolbar-variables"
          panelId="variables"
          toggled={activePanel === 'variables'}
          onClick={() => togglePanel('variables')}
        />
        <div className="w-px h-[18px] bg-border-dim mx-1.5" />
        <IconButton
          icon={<PaletteIcon />}
          title="Appearance"
          accent="#8be9fd"
          panelId="appearance"
          toggled={activePanel === 'appearance'}
          onClick={() => togglePanel('appearance')}
        />
        <IconButton
          icon={<GearIcon />}
          title="Settings"
          accent="#bd93f9"
          panelId="settings"
          toggled={activePanel === 'settings'}
          onClick={() => togglePanel('settings')}
        />
        <div className="w-px h-[18px] bg-border-dim mx-1.5" />
        <IconButton
          icon={<HelpIcon />}
          title="Guide"
          accent="#d9af50"
          helpId="toolbar-help"
          panelId="help"
          toggled={activePanel === 'help'}
          onClick={() => togglePanel('help')}
        />
      </div>
    </div>
  );
}
