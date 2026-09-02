import { useState, useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import { alertUser } from '../lib/platform';
import { setChatIdCounter } from '../lib/chatPatterns';
import type { ChatMessage, ChatType, ChatFilters, OutgoingMessage } from '../types/chat';
import type { SoundLibrary } from './useSoundLibrary';

const SETTINGS_FILE = 'settings.json';
const CHAT_HISTORY_FILE = 'chat-history.json';
const MAX_MESSAGES = 500;
/** Pre-1.16 keys — chat history used to be shared by every character. */
const LEGACY_MESSAGES_KEY = 'messages';
const LEGACY_OUTGOING_KEY = 'outgoing';
const messagesKey = (char: string) => `messages:${char}`;
const outgoingKey = (char: string) => `outgoing:${char}`;

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
function deserializeMessages(raw: Array<Record<string, unknown>> | null): ChatMessage[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const ts = typeof r.timestamp === 'string' ? new Date(r.timestamp) : new Date();
      if (isNaN(ts.getTime())) return null;
      return { ...r, timestamp: ts } as ChatMessage;
    })
    .filter((m): m is ChatMessage => m != null);
}

let outgoingIdCounter = 1;

function serializeOutgoing(
  msgs: OutgoingMessage[]
): Array<Omit<OutgoingMessage, 'timestamp'> & { timestamp: string }> {
  return msgs.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }));
}

function deserializeOutgoing(raw: Array<Record<string, unknown>> | null): OutgoingMessage[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const ts = typeof r.timestamp === 'string' ? new Date(r.timestamp) : new Date();
      if (isNaN(ts.getTime())) return null;
      return { id: r.id as number, command: r.command as string, timestamp: ts };
    })
    .filter((m): m is OutgoingMessage => m != null);
}

export function useChatMessages(
  activeCharacter: string | null,
  maxMessages = MAX_MESSAGES,
  notificationsRef?: React.RefObject<ChatFilters | null>,
  soundLibraryRef?: React.RefObject<SoundLibrary>,
  gaggedNpcsRef?: React.RefObject<string[]>
) {
  const dataStore = useDataStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [filters, setFilters] = useState<ChatFilters>({ ...DEFAULT_FILTERS });
  const [mutedSenders, setMutedSenders] = useState<string[]>([]);
  const [soundAlerts, setSoundAlerts] = useState<ChatFilters>({ ...DEFAULT_SOUND_ALERTS });
  const [newestFirst, setNewestFirst] = useState(true);
  const [hideOwnMessages, setHideOwnMessages] = useState(true);
  const [outgoingMessages, setOutgoingMessages] = useState<OutgoingMessage[]>([]);
  const loaded = useRef(false);
  const historyLoaded = useRef(false);
  const outgoingLoaded = useRef(false);
  /** Character key the in-memory history belongs to. */
  const historyCharRef = useRef<string | null>(null);
  const dataStoreRef = useRef(dataStore);
  dataStoreRef.current = dataStore;
  const maxMessagesRef = useRef(maxMessages);
  maxMessagesRef.current = maxMessages;

  const charKey = activeCharacter ? activeCharacter.toLowerCase() : null;

  // Refs for current values (used in handleChatMessage callback)
  const mutedSendersRef = useRef(mutedSenders);
  mutedSendersRef.current = mutedSenders;
  const soundAlertsRef = useRef(soundAlerts);
  soundAlertsRef.current = soundAlerts;

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

  // Load the active character's chat history, swapping logs when the character
  // changes. Nothing is persisted until a character is known, so the handful of
  // lines seen at the login prompt never land in someone else's log.
  useEffect(() => {
    if (!dataStore.ready) return;
    const ds = dataStoreRef.current;
    const max = maxMessagesRef.current;

    historyLoaded.current = false;
    outgoingLoaded.current = false;
    historyCharRef.current = charKey;

    if (!charKey) return;

    let cancelled = false;
    (async () => {
      try {
        let raw = await ds.get<Array<Record<string, unknown>>>(
          CHAT_HISTORY_FILE,
          messagesKey(charKey)
        );
        let rawOut = await ds.get<Array<Record<string, unknown>>>(
          CHAT_HISTORY_FILE,
          outgoingKey(charKey)
        );

        // Chat history used to be shared by every character. The first
        // character to load after upgrading adopts it (that's whoever was last
        // played) and the shared keys are retired.
        if (raw == null && rawOut == null) {
          const legacyIn = await ds.get<Array<Record<string, unknown>>>(
            CHAT_HISTORY_FILE,
            LEGACY_MESSAGES_KEY
          );
          const legacyOut = await ds.get<Array<Record<string, unknown>>>(
            CHAT_HISTORY_FILE,
            LEGACY_OUTGOING_KEY
          );
          if (legacyIn != null || legacyOut != null) {
            raw = legacyIn;
            rawOut = legacyOut;
            await ds.set(CHAT_HISTORY_FILE, messagesKey(charKey), legacyIn ?? []);
            await ds.set(CHAT_HISTORY_FILE, outgoingKey(charKey), legacyOut ?? []);
            await ds.delete(CHAT_HISTORY_FILE, LEGACY_MESSAGES_KEY);
            await ds.delete(CHAT_HISTORY_FILE, LEGACY_OUTGOING_KEY);
            await ds.save(CHAT_HISTORY_FILE);
          }
        }

        if (cancelled) return;

        // Trim to current max, then set the ID counters past the highest
        // restored ID so new messages can't collide with the loaded log.
        const restored = deserializeMessages(raw);
        const trimmed = restored.length > max ? restored.slice(-max) : restored;
        setChatIdCounter(trimmed.reduce((m, msg) => Math.max(m, msg.id), 0) + 1);
        setMessages(trimmed);

        const restoredOut = deserializeOutgoing(rawOut);
        const trimmedOut = restoredOut.length > max ? restoredOut.slice(-max) : restoredOut;
        outgoingIdCounter = trimmedOut.reduce((m, msg) => Math.max(m, msg.id), 0) + 1;
        setOutgoingMessages(trimmedOut);
      } catch (e) {
        console.error('Failed to load chat history:', e);
        if (!cancelled) {
          setMessages([]);
          setOutgoingMessages([]);
        }
      }
      if (!cancelled) {
        historyLoaded.current = true;
        outgoingLoaded.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataStore.ready, charKey]);

  // Persist chat history when messages change
  useEffect(() => {
    if (!historyLoaded.current) return;
    const char = historyCharRef.current;
    if (!char) return;
    dataStoreRef.current
      .set(CHAT_HISTORY_FILE, messagesKey(char), serializeMessages(messages))
      .catch((e) => console.error('Failed to persist chat history:', e));
  }, [messages]);

  // Persist outgoing messages when they change
  useEffect(() => {
    if (!outgoingLoaded.current) return;
    const char = historyCharRef.current;
    if (!char) return;
    dataStoreRef.current
      .set(CHAT_HISTORY_FILE, outgoingKey(char), serializeOutgoing(outgoingMessages))
      .catch((e) => console.error('Failed to persist outgoing history:', e));
  }, [outgoingMessages]);

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
    const senderLower = msg.sender.toLowerCase();
    const m = mutedSendersRef.current;
    const isMuted = m.some((name) => name.toLowerCase() === senderLower);
    const isGaggedNpc =
      gaggedNpcsRef?.current?.some((name) => name.toLowerCase() === senderLower) ?? false;

    // Sound alert
    const s = soundAlertsRef.current;
    if (!msg.isOwn && s[msg.type] && !isMuted && !isGaggedNpc && soundLibraryRef?.current) {
      const soundName = msg.type === 'tell' || msg.type === 'sz' ? 'chime2' : 'chime1';
      soundLibraryRef.current.play(soundName);
    }

    // Desktop notification when window is unfocused
    const n = notificationsRef?.current;
    if (n && !msg.isOwn && n[msg.type] && !isMuted && !isGaggedNpc && !document.hasFocus()) {
      alertUser(`${msg.sender} (${msg.type})`, msg.message, `dartforge-chat-${msg.type}`);
    }

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

  const deleteMessage = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const addOutgoingMessage = useCallback((command: string) => {
    const msg: OutgoingMessage = {
      id: outgoingIdCounter++,
      command,
      timestamp: new Date(),
    };
    setOutgoingMessages((prev) => {
      const next = [...prev, msg];
      return next.length > maxMessages ? next.slice(-maxMessages) : next;
    });
  }, []);

  const deleteOutgoingMessage = useCallback((id: number) => {
    setOutgoingMessages((prev) => prev.filter((m) => m.id !== id));
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
    outgoingMessages,
    handleChatMessage,
    toggleFilter,
    setAllFilters,
    toggleSoundAlert,
    toggleNewestFirst,
    toggleHideOwnMessages,
    muteSender,
    unmuteSender,
    clearMessages,
    deleteMessage,
    addOutgoingMessage,
    deleteOutgoingMessage,
    updateSender,
  };
}
