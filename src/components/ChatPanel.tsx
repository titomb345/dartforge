import { useEffect, useRef, useState, useMemo } from 'react';
import { useChatContext } from '../contexts/ChatContext';
import type { ChatMessage, ChatType } from '../types/chat';
import type { DockSide } from '../types';
import { PinIcon, PinOffIcon, ArrowLeftIcon, ArrowRightIcon, ChevronUpIcon, ChevronDownIcon, VolumeOffIcon } from './icons';

const CHAT_TYPE_LABELS: Record<ChatType, string> = {
  say: 'Say',
  shout: 'Shout',
  ooc: 'OOC',
  tell: 'Tell',
  sz: 'SZ',
};

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

interface ChatPanelProps {
  mode?: 'slideout' | 'pinned';
  onPin?: (side: DockSide) => void;
  side?: DockSide;
  onUnpin?: () => void;
  onSwapSide?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
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

function ChatMessageRow({
  msg,
  onMute,
}: {
  msg: ChatMessage;
  onMute?: (sender: string) => void;
}) {
  const isParsed = msg.type === 'say' || msg.type === 'shout' || msg.type === 'ooc';

  return (
    <div className="group flex items-start gap-1.5 px-2 py-0.5 hover:bg-bg-secondary/50 transition-colors duration-100 min-w-0">
      {/* Timestamp */}
      <span className="text-[10px] text-text-dim font-mono shrink-0 pt-px select-none">
        {formatTime(msg.timestamp)}
      </span>

      {isParsed ? (
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-0.5 min-w-0">
            {/* Sender */}
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
            {msg.type !== 'ooc' && <LanguageBadge language={msg.language ?? ''} />}
            {msg.type === 'ooc' && (
              <span className="text-[9px] font-mono text-comment ml-1 shrink-0">OOC</span>
            )}
            {msg.type === 'shout' && (
              <span className="text-[9px] font-mono text-amber ml-1 shrink-0">SHOUT</span>
            )}
            {msg.directed && (
              <span className="text-[9px] font-mono text-purple ml-1 shrink-0">to you</span>
            )}
            {/* Mute button on hover */}
            {!msg.isOwn && onMute && (
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
      ) : (
        /* Raw display for tell/sz */
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-text-primary break-words italic">{msg.raw}</div>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  mode = 'slideout',
  onPin,
  side,
  onUnpin,
  onSwapSide,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: ChatPanelProps) {
  const { messages, filters, mutedSenders, toggleFilter, muteSender, unmuteSender } = useChatContext();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const [showPinMenu, setShowPinMenu] = useState(false);

  const isPinned = mode === 'pinned';

  // Filter messages based on active filters and mute list
  const visibleMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (!filters[msg.type]) return false;
      if (mutedSenders.some((s) => s.toLowerCase() === msg.sender.toLowerCase())) return false;
      return true;
    });
  }, [messages, filters, mutedSenders]);

  // Track scroll position to determine auto-scroll behavior
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  };

  // Auto-scroll to bottom on new messages (only if near bottom)
  useEffect(() => {
    if (isNearBottomRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages.length]);

  // Check if "All" is active (all filters on)
  const allActive = Object.values(filters).every(Boolean);
  const noneActive = Object.values(filters).every((v) => !v);

  const toggleAll = () => {
    if (allActive) {
      // Turn all off (but this is weird — instead just reset to defaults)
      return;
    }
    // Turn all on
    for (const type of Object.keys(filters) as ChatType[]) {
      if (!filters[type]) toggleFilter(type);
    }
  };

  return (
    <div className={isPinned ? 'h-full flex flex-col overflow-hidden' : 'w-[360px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden'}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-semibold text-text-heading">Chat</span>
        <div className="flex items-center gap-1.5">
          {isPinned ? (
            <>
              {side === 'right' && onSwapSide && side && (
                <button
                  onClick={onSwapSide}
                  title="Move to left side"
                  className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
                >
                  <ArrowLeftIcon size={9} />
                </button>
              )}
              {canMoveUp && onMoveUp && (
                <button
                  onClick={onMoveUp}
                  title="Move up"
                  className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
                >
                  <ChevronUpIcon size={9} />
                </button>
              )}
              {canMoveDown && onMoveDown && (
                <button
                  onClick={onMoveDown}
                  title="Move down"
                  className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
                >
                  <ChevronDownIcon size={9} />
                </button>
              )}
              {onUnpin && (
                <button
                  onClick={onUnpin}
                  title="Unpin panel"
                  className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
                >
                  <PinOffIcon size={11} />
                </button>
              )}
              {side === 'left' && onSwapSide && side && (
                <button
                  onClick={onSwapSide}
                  title="Move to right side"
                  className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
                >
                  <ArrowRightIcon size={9} />
                </button>
              )}
            </>
          ) : (
            onPin && (
              <div className="relative">
                <button
                  onClick={() => setShowPinMenu((v) => !v)}
                  title="Pin panel"
                  className="flex items-center rounded text-[10px] cursor-pointer px-1.5 py-[2px] transition-all duration-200 ease-in-out border bg-transparent border-border-dim text-text-dim hover:text-cyan hover:border-cyan/40"
                >
                  <PinIcon size={10} />
                </button>
                {showPinMenu && (
                  <div className="absolute top-full right-0 mt-1 z-50 flex flex-col gap-0.5 bg-bg-secondary border border-border rounded-md p-1 shadow-lg min-w-[100px]">
                    <button
                      onClick={() => { onPin('left'); setShowPinMenu(false); }}
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer transition-colors duration-100"
                    >
                      <ArrowLeftIcon size={9} /> Pin Left
                    </button>
                    <button
                      onClick={() => { onPin('right'); setShowPinMenu(false); }}
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-text-label hover:bg-bg-primary hover:text-text-primary cursor-pointer transition-colors duration-100"
                    >
                      <ArrowRightIcon size={9} /> Pin Right
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-border-subtle flex-wrap shrink-0">
        <FilterPill label="All" active={allActive} onClick={toggleAll} />
        {(Object.keys(CHAT_TYPE_LABELS) as ChatType[]).map((type) => (
          <FilterPill
            key={type}
            label={CHAT_TYPE_LABELS[type]}
            active={filters[type]}
            onClick={() => toggleFilter(type)}
          />
        ))}
      </div>

      {/* Muted senders bar */}
      {mutedSenders.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-subtle flex-wrap shrink-0">
          <span className="text-[9px] text-text-dim shrink-0">Muted:</span>
          {mutedSenders.map((name) => (
            <button
              key={name}
              onClick={() => unmuteSender(name)}
              title={`Unmute ${name}`}
              className="text-[9px] font-mono px-1.5 py-px rounded-full border border-border-dim text-text-dim hover:text-text-label hover:border-border cursor-pointer transition-colors duration-150"
            >
              {name} ×
            </button>
          ))}
        </div>
      )}

      {/* Message list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-1"
      >
        {visibleMessages.length === 0 && (
          <div className="px-3 py-4 text-xs text-text-dim">
            {noneActive
              ? 'No filters active. Enable a chat type above.'
              : 'No messages yet. Chat will appear here as it happens.'}
          </div>
        )}
        {visibleMessages.map((msg) => (
          <ChatMessageRow
            key={msg.id}
            msg={msg}
            onMute={muteSender}
          />
        ))}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[10px] font-mono rounded-full border cursor-pointer transition-colors duration-150 whitespace-nowrap ${
        active
          ? 'bg-cyan/15 border-cyan/40 text-cyan'
          : 'bg-transparent border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle'
      }`}
    >
      {label}
    </button>
  );
}
