import { useState, useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import { alertUser } from '../lib/platform';
import { setChatIdCounter } from '../lib/chatPatterns';
import type { ChatMessage, ChatType, ChatFilters } from '../types/chat';
import type { Chimes } from './useCustomChimes';

const SETTINGS_FILE = 'settings.json';
const CHAT_HISTORY_FILE = 'chat-history.json';
const MAX_MESSAGES = 500;

const DEFAULT_FILTERS: ChatFilters = {
  say: false,
  shout: false,
  ooc: true,
  tell: true,
  sz: true,
};

const DEFAULT_SOUND_ALERTS: ChatFilters = {
  say: true,
  shout: true,
  ooc: true,
  tell: true,
  sz: true,
};

/** Serialize ChatMessage[] for JSON storage (Date → ISO string). */
function serializeMessages(
  msgs: ChatMessage[]
): Array<Omit<ChatMessage, 'timestamp'> & { timestamp: string }> {
  return msgs.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }));
}

/** Deserialize stored messages back to ChatMessage[] (ISO string → Date). */
function deserializeMessages(
  raw: Array<Record<string, unknown>> | null
): ChatMessage[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const ts = typeof r.timestamp === 'string' ? new Date(r.timestamp) : new Date();
      if (isNaN(ts.getTime())) return null;
      return { ...r, timestamp: ts } as ChatMessage;
    })
    .filter((m): m is ChatMessage => m != null);
}

export function useChatMessages(
  maxMessages = MAX_MESSAGES,
  notificationsRef?: React.RefObject<ChatFilters | null>,
  chimesRef?: React.RefObject<Chimes>
) {
  const dataStore = useDataStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [filters, setFilters] = useState<ChatFilters>({ ...DEFAULT_FILTERS });
  const [mutedSenders, setMutedSenders] = useState<string[]>([]);
  const [soundAlerts, setSoundAlerts] = useState<ChatFilters>({ ...DEFAULT_SOUND_ALERTS });
  const [newestFirst, setNewestFirst] = useState(true);
  const [hideOwnMessages, setHideOwnMessages] = useState(true);
  const loaded = useRef(false);
  const historyLoaded = useRef(false);

  // Refs for current values (used in handleChatMessage callback)
  const mutedSendersRef = useRef(mutedSenders);
  mutedSendersRef.current = mutedSenders;
  const soundAlertsRef = useRef(soundAlerts);
  soundAlertsRef.current = soundAlerts;
  const hideOwnMessagesRef = useRef(hideOwnMessages);
  hideOwnMessagesRef.current = hideOwnMessages;

  // Load persisted chat settings
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const savedFilters = await dataStore.get<ChatFilters>(SETTINGS_FILE, 'chatFilters');
        if (savedFilters) setFilters(savedFilters);
        const savedMuted = await dataStore.get<string[]>(SETTINGS_FILE, 'chatMutedSenders');
        if (savedMuted) setMutedSenders(savedMuted);
        const savedAlerts = await dataStore.get<ChatFilters>(SETTINGS_FILE, 'chatSoundAlerts');
        if (savedAlerts) setSoundAlerts(savedAlerts);
        const savedNewest = await dataStore.get<boolean>(SETTINGS_FILE, 'chatNewestFirst');
        if (savedNewest != null) setNewestFirst(savedNewest);
        const savedHideOwn = await dataStore.get<boolean>(SETTINGS_FILE, 'chatHideOwnMessages');
        if (savedHideOwn != null) setHideOwnMessages(savedHideOwn);
      } catch (e) {
        console.error('Failed to load chat settings:', e);
      }
      loaded.current = true;
    })();
  }, [dataStore.ready]);

  // Load persisted chat history
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const raw = await dataStore.get<Array<Record<string, unknown>>>(
          CHAT_HISTORY_FILE,
          'messages'
        );
        const restored = deserializeMessages(raw);
        if (restored.length > 0) {
          // Trim to current max
          const trimmed =
            restored.length > maxMessages ? restored.slice(-maxMessages) : restored;
          // Set ID counter past the highest restored ID
          const maxId = trimmed.reduce((max, m) => Math.max(max, m.id), 0);
          setChatIdCounter(maxId + 1);
          setMessages(trimmed);
        }
      } catch (e) {
        console.error('Failed to load chat history:', e);
      }
      historyLoaded.current = true;
    })();
  }, [dataStore.ready]);

  // Persist chat history when messages change
  useEffect(() => {
    if (!historyLoaded.current) return;
    dataStore
      .set(CHAT_HISTORY_FILE, 'messages', serializeMessages(messages))
      .catch((e) => console.error('Failed to persist chat history:', e));
  }, [messages]);

  // Persist on change
  useEffect(() => {
    if (!loaded.current) return;
    dataStore.set(SETTINGS_FILE, 'chatFilters', filters).catch(console.error);
  }, [filters]);

  useEffect(() => {
    if (!loaded.current) return;
    dataStore.set(SETTINGS_FILE, 'chatMutedSenders', mutedSenders).catch(console.error);
  }, [mutedSenders]);

  useEffect(() => {
    if (!loaded.current) return;
    dataStore.set(SETTINGS_FILE, 'chatSoundAlerts', soundAlerts).catch(console.error);
  }, [soundAlerts]);

  useEffect(() => {
    if (!loaded.current) return;
    dataStore.set(SETTINGS_FILE, 'chatNewestFirst', newestFirst).catch(console.error);
  }, [newestFirst]);

  useEffect(() => {
    if (!loaded.current) return;
    dataStore.set(SETTINGS_FILE, 'chatHideOwnMessages', hideOwnMessages).catch(console.error);
  }, [hideOwnMessages]);

  const handleChatMessage = useCallback((msg: ChatMessage) => {
    const m = mutedSendersRef.current;
    const isMuted = m.some((name) => name.toLowerCase() === msg.sender.toLowerCase());

    // Sound alert
    const s = soundAlertsRef.current;
    if (!msg.isOwn && s[msg.type] && !isMuted && chimesRef?.current) {
      const audio =
        msg.type === 'tell' || msg.type === 'sz'
          ? chimesRef.current.chime2
          : chimesRef.current.chime1;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }

    // Desktop notification when window is unfocused
    const n = notificationsRef?.current;
    if (n && !msg.isOwn && n[msg.type] && !isMuted && !document.hasFocus()) {
      alertUser(`${msg.sender} (${msg.type})`, msg.message, `dartforge-chat-${msg.type}`);
    }

    // Skip own say/shout/ooc messages when hide-own is active
    if (msg.isOwn && hideOwnMessagesRef.current) return;

    setMessages((prev) => {
      const next = [...prev, msg];
      return next.length > maxMessages ? next.slice(-maxMessages) : next;
    });
  }, []);

  const toggleFilter = useCallback((type: ChatType) => {
    setFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const setAllFilters = useCallback((next: ChatFilters) => {
    setFilters(next);
  }, []);

  const toggleSoundAlert = useCallback((type: ChatType) => {
    setSoundAlerts((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const toggleNewestFirst = useCallback(() => {
    setNewestFirst((prev) => !prev);
  }, []);

  const toggleHideOwnMessages = useCallback(() => {
    setHideOwnMessages((prev) => !prev);
  }, []);

  const muteSender = useCallback((name: string) => {
    setMutedSenders((prev) => {
      const lower = name.toLowerCase();
      if (prev.some((s) => s.toLowerCase() === lower)) return prev;
      return [...prev, name];
    });
  }, []);

  const unmuteSender = useCallback((name: string) => {
    setMutedSenders((prev) => prev.filter((s) => s.toLowerCase() !== name.toLowerCase()));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Retroactive resolution: scan existing Unknown-sender messages for a signature match
  const updateSender = useCallback((signature: string, playerName: string) => {
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((msg) => {
        if (msg.sender !== 'Unknown') return msg;
        if (msg.message.endsWith(signature)) {
          changed = true;
          return {
            ...msg,
            sender: playerName,
            message: msg.message.slice(0, -signature.length).trimEnd(),
          };
        }
        return msg;
      });
      return changed ? next : prev;
    });
  }, []);

  return {
    messages,
    filters,
    mutedSenders,
    soundAlerts,
    newestFirst,
    hideOwnMessages,
    handleChatMessage,
    toggleFilter,
    setAllFilters,
    toggleSoundAlert,
    toggleNewestFirst,
    toggleHideOwnMessages,
    muteSender,
    unmuteSender,
    clearMessages,
    updateSender,
  };
}
