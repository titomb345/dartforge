import { IconButton } from './IconButton';
import { PowerIcon, ReconnectIcon, PaletteIcon } from './icons';

interface ToolbarProps {
  connected: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
  showColors: boolean;
  onToggleColors: () => void;
}

export function Toolbar({
  connected,
  onReconnect,
  onDisconnect,
  showColors,
  onToggleColors,
}: ToolbarProps) {

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '4px 10px',
        background: '#0d0d0d',
        borderBottom: '1px solid #1a1a1a',
      }}
    >
      <IconButton
        icon={connected ? <PowerIcon /> : <ReconnectIcon />}
        title={connected ? 'Disconnect' : 'Reconnect'}
        accent={connected ? '#ef4444' : '#50fa7b'}
        onClick={connected ? onDisconnect : onReconnect}
      />
      <div
        style={{
          width: '1px',
          height: '18px',
          background: '#1e1e1e',
          margin: '0 6px',
        }}
      />

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <IconButton
          icon={<PaletteIcon />}
          title="Color settings"
          accent="#8be9fd"
          toggled={showColors}
          onClick={onToggleColors}
        />
      </div>
    </div>
  );
}
