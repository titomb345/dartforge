import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useChatContext } from '../contexts/ChatContext';
import { useSignatureContext } from '../contexts/SignatureContext';
import type { ChatType } from '../types/chat';
import type { PinnablePanelProps } from '../types';
import { panelRootClass } from '../lib/panelUtils';
import { SortAscIcon, SortDescIcon, ChatIcon } from './icons';
import { FilterPill } from './FilterPill';
import { PinMenuButton } from './PinMenuButton';
import { PinnedControls } from './PinnedControls';
import { ChatMessageRow } from './ChatMessageRow';
import { MutedSection } from './MutedPopover';
import { SignaturesSection } from './SignaturesPopover';
import { IdentifyForm } from './IdentifyForm';

const CHAT_TYPE_LABELS: Record<ChatType, string> = {
  say: 'Say',
  shout: 'Shout',
  ooc: 'OOC',
  tell: 'Tell',
  sz: 'SZ',
};

export function ChatPanel({ mode = 'slideout' }: PinnablePanelProps) {
  const {
    messages,
    filters,
    mutedSenders,
    soundAlerts,
    newestFirst,
    toggleFilter,
    setAllFilters,
    toggleSoundAlert,
    toggleNewestFirst,
    muteSender,
    unmuteSender,
    updateSender,
  } = useChatContext();
  const { sortedMappings, createMapping } = useSignatureContext();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearEdgeRef = useRef(true);
  const [exclusiveFilter, setExclusiveFilter] = useState<ChatType | null>(null);
  const [identifyingMsgId, setIdentifyingMsgId] = useState<number | null>(null);
  const [showMuted, setShowMuted] = useState(false);
  const [showSigs, setShowSigs] = useState(false);

  const isPinned = mode === 'pinned';

  // Filter and sort messages
  const visibleMessages = useMemo(() => {
    const filtered = messages.filter((msg) => {
      if (!filters[msg.type]) return false;
      if (mutedSenders.some((s) => s.toLowerCase() === msg.sender.toLowerCase())) return false;
      return true;
    });
    return newestFirst ? [...filtered].reverse() : filtered;
  }, [messages, filters, mutedSenders, newestFirst]);

  // Track scroll position to determine auto-scroll behavior
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    if (newestFirst) {
      isNearEdgeRef.current = el.scrollTop < threshold;
    } else {
      isNearEdgeRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    }
  };

  // Auto-scroll on new messages
  useEffect(() => {
    if (isNearEdgeRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = newestFirst ? 0 : el.scrollHeight;
    }
  }, [visibleMessages.length, newestFirst]);

  const allActive = Object.values(filters).every(Boolean);
  const noneActive = Object.values(filters).every((v) => !v);

  const toggleAll = () => {
    if (exclusiveFilter) setExclusiveFilter(null);
    if (allActive) return;
    const all = { ...filters } as Record<ChatType, boolean>;
    for (const type of Object.keys(filters) as ChatType[]) all[type] = true;
    setAllFilters(all as Record<ChatType, boolean> & Record<string, boolean>);
  };

  const handleFilterClick = (type: ChatType) => {
    if (exclusiveFilter === type) {
      toggleFilter(type);
      setExclusiveFilter(null);
      return;
    }
    if (exclusiveFilter) {
      setExclusiveFilter(null);
      toggleFilter(type);
      return;
    }
    if (filters[type]) {
      const exclusive: Record<string, boolean> = {};
      for (const t of Object.keys(filters) as ChatType[]) exclusive[t] = t === type;
      setAllFilters(exclusive as Record<ChatType, boolean> & Record<string, boolean>);
      setExclusiveFilter(type);
    } else {
      toggleFilter(type);
    }
  };

  const handleFilterRightClick = (e: React.MouseEvent, type: ChatType) => {
    e.preventDefault();
    toggleSoundAlert(type);
  };

  const handleIdentify = useCallback((msgId: number) => {
    setIdentifyingMsgId((prev) => (prev === msgId ? null : msgId));
  }, []);

  const handleIdentifySave = useCallback(
    (signature: string, playerName: string) => {
      createMapping(signature, playerName);
      updateSender(signature, playerName);
      setIdentifyingMsgId(null);
    },
    [createMapping, updateSender]
  );

  const toggleMutedSection = useCallback(() => {
    setShowMuted((v) => !v);
    setShowSigs(false);
  }, []);

  const toggleSigsSection = useCallback(() => {
    setShowSigs((v) => !v);
    setShowMuted(false);
  }, []);

  const identifyingMsg =
    identifyingMsgId != null ? messages.find((m) => m.id === identifyingMsgId) : null;

  return (
    <div className={panelRootClass(isPinned)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-text-heading flex items-center gap-1.5">
            <ChatIcon size={12} /> Chat
          </span>
          <button
            onClick={toggleNewestFirst}
            title={
              newestFirst
                ? 'Newest first (click for oldest first)'
                : 'Oldest first (click for newest first)'
            }
            className="flex items-center justify-center w-5 h-5 rounded-[3px] cursor-pointer text-text-dim hover:text-text-label transition-colors duration-150"
          >
            {newestFirst ? <SortAscIcon size={10} /> : <SortDescIcon size={10} />}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {isPinned ? <PinnedControls /> : <PinMenuButton panel="chat" />}
        </div>
      </div>

      {/* Filter pills + management badges */}
      <div
        data-help-id="chat-filters"
        className="flex items-center gap-1 px-2 py-2 border-b border-border-subtle flex-wrap shrink-0"
      >
        <FilterPill label="All" active={allActive && !exclusiveFilter} onClick={toggleAll} />
        {(Object.keys(CHAT_TYPE_LABELS) as ChatType[]).map((type) => (
          <FilterPill
            key={type}
            label={CHAT_TYPE_LABELS[type]}
            active={filters[type]}
            exclusive={exclusiveFilter === type}
            soundAlert={soundAlerts[type]}
            onClick={() => handleFilterClick(type)}
            onContextMenu={(e) => handleFilterRightClick(e, type)}
          />
        ))}
      </div>

      {/* Muted / Sigs toggles */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-subtle shrink-0">
        <button
          onClick={toggleMutedSection}
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border cursor-pointer transition-colors duration-150 whitespace-nowrap ${
            showMuted
              ? 'bg-red/15 border-red/30 text-red'
              : 'border-transparent text-text-dim hover:text-red/70'
          }`}
        >
          Muted{mutedSenders.length > 0 ? ` (${mutedSenders.length})` : ''}
        </button>
        <button
          onClick={toggleSigsSection}
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border cursor-pointer transition-colors duration-150 whitespace-nowrap ${
            showSigs
              ? 'bg-cyan/15 border-cyan/30 text-cyan'
              : 'border-transparent text-text-dim hover:text-cyan/70'
          }`}
        >
          Sigs{sortedMappings.length > 0 ? ` (${sortedMappings.length})` : ''}
        </button>
      </div>

      {/* Inline muted senders editor */}
      {showMuted && (
        <MutedSection mutedSenders={mutedSenders} onMute={muteSender} onUnmute={unmuteSender} />
      )}

      {/* Inline signatures editor */}
      {showSigs && <SignaturesSection />}

      {/* Inline identify form */}
      {identifyingMsg && (
        <div className="px-2 py-1 border-b border-border-subtle shrink-0">
          <div className="text-[9px] text-text-dim mb-0.5">
            Identify sender for:{' '}
            <span className="text-text-label italic">{identifyingMsg.message}</span>
          </div>
          <IdentifyForm
            message={identifyingMsg.message}
            onSave={handleIdentifySave}
            onCancel={() => setIdentifyingMsgId(null)}
          />
        </div>
      )}

      {/* Message list */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-1">
        {visibleMessages.length === 0 && (
          <div className="px-3 py-4 text-xs text-text-dim">
            {noneActive
              ? 'No filters active. Enable a chat type above.'
              : 'No messages yet. Chat will appear here as it happens.'}
          </div>
        )}
        {visibleMessages.map((msg) => (
          <ChatMessageRow key={msg.id} msg={msg} onMute={muteSender} onIdentify={handleIdentify} />
        ))}
      </div>
    </div>
  );
}
