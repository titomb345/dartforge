import type { ChatMessage } from '../types/chat';
import { VolumeOffIcon } from './icons';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';

/** Color-coded badges for non-common languages */
const LANG_COLORS: Record<string, string> = {
  magic: '#a78bfa',
  dark_tongue: '#ef4444',
  elvish: '#50fa7b',
  dwarvish: '#f59e0b',
  undercommon: '#6272a4',
  orcish: '#ff6e6e',
  goblin: '#8be9fd',
  fuzzy: '#f59e0b',
  spyder: '#888',
  mohnkeetongue: '#f59e0b',
  southern: '#888',
  western: '#888',
  ogre: '#ff6e6e',
  troll: '#ff6e6e',
  catfolk: '#f59e0b',
  gnomish: '#8be9fd',
  northern: '#888',
  eastern: '#888',
  braman: '#a78bfa',
  kreen: '#888',
  sasquatch: '#888',
  crabfolk: '#8be9fd',
  rowan: '#888',
};

const DEFAULT_LANG_COLOR = '#888';

function formatTime(date: Date, hour12: boolean): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 });
}

function LanguageBadge({ language }: { language: string }) {
  if (!language || language === 'common') return null;
  const color = LANG_COLORS[language] ?? DEFAULT_LANG_COLOR;
  return (
    <span
      className="text-[9px] font-mono px-1 py-px rounded ml-1 shrink-0"
      style={{ color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}
    >
      {language}
    </span>
  );
}

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  ooc: { label: 'OOC', color: 'text-comment' },
  shout: { label: 'SHOUT', color: 'text-amber' },
  tell: { label: 'TELL', color: 'text-pink' },
  sz: { label: 'SZ', color: 'text-cyan' },
};

export function ChatMessageRow({
  msg,
  onMute,
  onIdentify,
}: {
  msg: ChatMessage;
  onMute?: (sender: string) => void;
  onIdentify?: (msgId: number) => void;
}) {
  const { timestampFormat } = useAppSettingsContext();
  const badge = TYPE_BADGES[msg.type];
  const knownSender = msg.sender !== 'Unknown';

  return (
    <div className="group flex items-start gap-1.5 px-2 py-0.5 hover:bg-bg-secondary/50 transition-colors duration-100 min-w-0">
      {/* Timestamp */}
      <span className="text-[10px] text-text-dim font-mono shrink-0 pt-px select-none">
        {formatTime(msg.timestamp, timestampFormat === '12h')}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-0.5 min-w-0">
          {/* Sender — skip for anonymous tells/szs */}
          {knownSender && (
            <span
              className={`text-[11px] font-semibold shrink-0 ${msg.isOwn ? 'text-green' : 'text-text-label'}`}
              onContextMenu={(e) => {
                if (!msg.isOwn && onMute) {
                  e.preventDefault();
                  onMute(msg.sender);
                }
              }}
            >
              {msg.isOwn ? 'You' : msg.sender}
            </span>
          )}
          {(msg.type === 'say' || msg.type === 'shout') && <LanguageBadge language={msg.language ?? ''} />}
          {badge && (
            <span className={`text-[9px] font-mono ${badge.color} ${knownSender ? 'ml-1' : ''} shrink-0`}>{badge.label}</span>
          )}
          {msg.directed && (
            <span className="text-[9px] font-mono text-purple ml-1 shrink-0">to you</span>
          )}
          {/* Identify button — only for anonymous tells/szs */}
          {!knownSender && !msg.isOwn && onIdentify && (
            <button
              onClick={() => onIdentify(msg.id)}
              className="ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity duration-150 shrink-0 cursor-pointer text-[9px] font-mono text-amber border border-amber/40 rounded px-1 py-px leading-none"
              title="Identify sender"
            >
              ?
            </button>
          )}
          {/* Mute button on hover — only for known senders */}
          {!msg.isOwn && knownSender && onMute && (
            <button
              onClick={() => onMute(msg.sender)}
              className="ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity duration-150 shrink-0 cursor-pointer"
              title={`Mute ${msg.sender}`}
            >
              <VolumeOffIcon size={9} />
            </button>
          )}
        </div>
        <div className="text-[11px] text-text-primary break-words">{msg.message}</div>
      </div>
    </div>
  );
}
