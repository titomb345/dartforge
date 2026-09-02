import type { ReactNode } from 'react';
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
  CodeIcon,
  NotesIcon,
  GearIcon,
  CoinIcon,
  WhoIcon,
  MapIcon,
  AllocIcon,
  BabelIcon,
  HelpIcon,
  CameraIcon,
  LogIcon,
  MacroIcon,
  LoadoutIcon,
  SmartphoneIcon,
} from './icons';
import { getPlatform } from '../lib/platform';
import type { Panel, PinnablePanel } from '../types';
import { shortcutFor, shortcutLabel } from '../lib/panelShortcuts';
import { PANEL_ACCENT, ACTION_ACCENT } from '../lib/accents';
import { cn } from '../lib/cn';
import { usePanelContext } from '../contexts/PanelLayoutContext';
import { StorageModeButton } from './StorageModeButton';

interface ToolbarProps {
  connected: boolean;
  /** Phones currently on the Mobile Companion. */
  companionClients?: number;
  onReconnect: () => void;
  onDisconnect: () => void;
  onScreenshot: () => void;
}

/**
 * A run of related buttons with its name set in small rotated caps at the
 * left edge, like the label strip on a rack of instruments. The name tells
 * you what kind of thing you are looking at before you read the buttons.
 */
function ToolbarGroup({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="toolbar-group-name" aria-hidden="true">
        {name}
      </span>
      {children}
    </div>
  );
}

/** "Chat (Ctrl+2)" for tooltips. */
function withShortcut(title: string, id: Panel): string {
  const sc = shortcutLabel(id);
  return sc ? `${title} (${sc})` : title;
}

function ToolbarRule() {
  return <div className="toolbar-rule w-px h-6 bg-border-dim mx-1.5 shrink-0" />;
}

export function Toolbar({
  connected,
  companionClients = 0,
  onReconnect,
  onDisconnect,
  onScreenshot,
}: ToolbarProps) {
  const { activePanel, togglePanel, isPinned } = usePanelContext();

  /** Pinnable game panel: toggles open, shows pinned state. */
  const panel = (
    id: PinnablePanel,
    label: string,
    title: string,
    icon: ReactNode,
    helpId: string
  ) => (
    <IconButton
      icon={icon}
      label={label}
      hint={shortcutFor(id)?.key}
      title={withShortcut(title, id)}
      accent={PANEL_ACCENT[id]}
      helpId={helpId}
      panelId={id}
      toggled={activePanel === id}
      pinned={isPinned(id)}
      onClick={() => togglePanel(id)}
    />
  );

  /** Slide-out tool: toggles open, never pinned. */
  const tool = (id: Panel, label: string, title: string, icon: ReactNode, helpId?: string) => (
    <IconButton
      icon={icon}
      label={label}
      hint={shortcutFor(id)?.key}
      title={withShortcut(title, id)}
      accent={PANEL_ACCENT[id]}
      helpId={helpId}
      panelId={id}
      toggled={activePanel === id}
      onClick={() => togglePanel(id)}
    />
  );

  return (
    <div className="toolbar flex items-center px-2.5 py-1 bg-bg-primary rounded-lg shrink-0">
      <button
        onClick={connected ? onDisconnect : onReconnect}
        title={connected ? 'Disconnect' : 'Reconnect'}
        data-help-id="toolbar-power"
        className={cn(
          'icon-btn-labeled flex flex-col items-center justify-center h-10 min-w-10 px-1.5 gap-[3px] rounded-[6px]',
          'select-none leading-none transition-all duration-300 ease-in-out motion-reduce:transition-none border cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current',
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
        <span className="toolbar-label">{connected ? 'Online' : 'Offline'}</span>
      </button>
      {companionClients > 0 && (
        <span
          className="ml-2 flex items-center gap-1 self-center text-[10px] font-mono text-text-muted select-none"
          title={`${companionClients} phone${companionClients === 1 ? '' : 's'} on the Mobile Companion`}
        >
          <SmartphoneIcon size={12} />
          <span>{companionClients}</span>
        </span>
      )}

      <div className="flex-1" />

      <div className="flex items-center">
        {getPlatform() === 'web' && (
          <div className="flex items-center gap-1 mr-1.5">
            <DropboxButton />
            <StorageModeButton />
          </div>
        )}

        <ToolbarGroup name="Panels">
          {panel('who', 'Who', 'Who', <WhoIcon />, 'toolbar-who')}
          {panel('chat', 'Chat', 'Chat', <ChatIcon />, 'toolbar-chat')}
          {panel('counter', 'Counters', 'Counters', <CounterIcon />, 'toolbar-counters')}
          {panel('skills', 'Skills', 'Skills', <TrendingUpIcon />, 'toolbar-skills')}
          {panel('notes', 'Notes', 'Notes', <NotesIcon />, 'toolbar-notes')}
          {panel('map', 'Map', 'Map', <MapIcon />, 'toolbar-map')}
          {panel('alloc', 'Alloc', 'Allocations', <AllocIcon />, 'toolbar-alloc')}
          {panel('loadout', 'Loadout', 'Loadout', <LoadoutIcon />, 'toolbar-loadout')}
          {panel('currency', 'Currency', 'Currency Converter', <CoinIcon />, 'toolbar-currency')}
          {panel('babel', 'Babel', 'Babel', <BabelIcon />, 'toolbar-babel')}
        </ToolbarGroup>

        <ToolbarRule />

        <ToolbarGroup name="Tools">
          {tool('aliases', 'Aliases', 'Aliases', <AliasIcon />, 'toolbar-aliases')}
          {tool('triggers', 'Triggers', 'Triggers', <TriggerIcon />, 'toolbar-triggers')}
          {tool('timers', 'Timers', 'Timers', <TimerIcon />, 'toolbar-timers')}
          {tool('variables', 'Variables', 'Variables', <VariableIcon />, 'toolbar-variables')}
          {tool('macros', 'Macros', 'Macros', <MacroIcon />, 'toolbar-macros')}
          {tool('scripts', 'Scripts', 'Scripts', <CodeIcon />, 'toolbar-scripts')}
          {tool('logs', 'Logs', 'Session Logs', <LogIcon />, 'toolbar-logs')}
        </ToolbarGroup>

        <ToolbarRule />

        <ToolbarGroup name="App">
          {tool('appearance', 'Appearance', 'Appearance', <PaletteIcon />, 'toolbar-appearance')}
          {tool('settings', 'Settings', 'Settings', <GearIcon />, 'toolbar-settings')}
          <IconButton
            icon={<CameraIcon />}
            label="Screenshot"
            title="Screenshot"
            accent={ACTION_ACCENT.screenshot}
            helpId="toolbar-screenshot"
            onClick={onScreenshot}
          />
        </ToolbarGroup>

        <ToolbarRule />

        {tool('help', 'Guide', 'Guide', <HelpIcon />, 'toolbar-help')}
      </div>
    </div>
  );
}
