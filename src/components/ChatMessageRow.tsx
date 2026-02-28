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
  orcish: '#e8734a',
  goblin: '#8be9fd',
  fuzzy: '#f0c866',
  spyder: '#b0b0b0',
  mohnkeetongue: '#ff9f43',
  southern: '#e6c07b',
  western: '#d4a476',
  ogre: '#b5a95e',
  troll: '#8ab87a',
  catfolk: '#f9a8d4',
  gnomish: '#36d7b7',
  northern: '#94c4e8',
  eastern: '#d4a5e5',
  braman: '#e06cb8',
  kreen: '#b8d84a',
  sasquatch: '#d4b48a',
  crabfolk: '#f08b7a',
  rowan: '#98c379',
};

const DEFAULT_LANG_COLOR = '#888';

/**
 * Time-only timestamp — day separators in ChatPanel handle date context,
 * so we never need "Yest", day names, or month/date prefixes here.
 */
function formatTime(date: Date, hour12: boolean, now: number): string {
  const diffMs = now - date.getTime();

  // Future or < 1 min → "now" (covers clock skew on self-sent messages)
  if (diffMs < 60_000) return 'now';

  // < 60 min → "{n}m"
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;

  // < 6 hours → "{n}h"
  const hours = Math.floor(mins / 60);
  if (hours < 6) return `${hours}h`;

  // >= 6h → time only
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  });
}

function formatFullTimestamp(date: Date, hour12: boolean): string {
  return date.toLocaleString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12,
  });
}

function LanguageBadge({ language, fontSize }: { language: string; fontSize?: number }) {
  if (!language || language === 'common') return null;
  const color = LANG_COLORS[language] ?? DEFAULT_LANG_COLOR;
  return (
    <span
      className="font-mono px-1 py-px rounded ml-1 align-middle inline-block leading-tight"
      style={{
        fontSize: `${(fontSize ?? 11) - 4}px`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
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
  now,
  fontSize,
  onMute,
  onIdentify,
}: {
  msg: ChatMessage;
  now: number;
  fontSize?: number;
  onMute?: (sender: string) => void;
  onIdentify?: (msgId: number) => void;
}) {
  const { timestampFormat } = useAppSettingsContext();
  const badge = TYPE_BADGES[msg.type];
  const knownSender = msg.sender !== 'Unknown';

  return (
    <div className="group relative flex items-start gap-1.5 px-2 py-0.5 hover:bg-bg-secondary/50 transition-colors duration-100 min-w-0">
      {/* Timestamp — time only; day separators handle date context */}
      <span
        className="text-[10px] text-text-dim font-mono shrink-0 pt-px select-none"
        title={formatFullTimestamp(msg.timestamp, timestampFormat === '12h')}
      >
        {formatTime(msg.timestamp, timestampFormat === '12h', now)}
      </span>

      {/* Sender + badges + message — all inline for compact single-line flow */}
      <div
        className="flex-1 min-w-0 text-text-primary break-words"
        style={{ fontSize: `${fontSize ?? 11}px` }}
      >
        {knownSender ? (
          <span
            className={`font-semibold ${msg.isOwn ? 'text-green' : 'text-text-label'}`}
            onContextMenu={(e) => {
              if (!msg.isOwn && onMute) {
                e.preventDefault();
                onMute(msg.sender);
              }
            }}
          >
            {msg.isOwn ? 'You' : msg.sender}
          </span>
        ) : (
          !msg.isOwn &&
          onIdentify && (
            <button
              onClick={() => onIdentify(msg.id)}
              className="text-[9px] font-mono text-amber/70 hover:text-amber border border-amber/30 hover:border-amber/50 rounded px-1 py-px leading-tight align-middle inline-block cursor-pointer transition-colors duration-150"
              title="Identify sender"
            >
              who?
            </button>
          )
        )}
        {(msg.type === 'say' || msg.type === 'shout') && (
          <LanguageBadge language={msg.language ?? ''} fontSize={fontSize} />
        )}
        {badge && (
          <span
            className={`font-mono ${badge.color} ml-1 align-middle`}
            style={{ fontSize: `${(fontSize ?? 11) - 2}px` }}
          >
            {badge.label}
          </span>
        )}
        {msg.directed && (
          <span
            className="font-mono text-purple ml-1 align-middle"
            style={{ fontSize: `${(fontSize ?? 11) - 2}px` }}
          >
            to you
          </span>
        )}
        {' '}
        {msg.message}
      </div>

      {/* Mute button — hover overlay for known senders */}
      {!msg.isOwn && knownSender && onMute && (
        <div className="absolute right-1 top-0.5 hidden group-hover:flex items-center">
          <button
            onClick={() => onMute(msg.sender)}
            className="cursor-pointer opacity-60 hover:opacity-100"
            title={`Mute ${msg.sender}`}
          >
            <VolumeOffIcon size={9} />
          </button>
        </div>
      )}
    </div>
  );
}
