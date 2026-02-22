import { useState, useCallback, useEffect, useRef } from 'react';
import { useDataStore } from '../contexts/DataStoreContext';
import type { ChatMessage, ChatType, ChatFilters } from '../types/chat';

const SETTINGS_FILE = 'settings.json';
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

// Shared Audio instances for chime playback
const chimeAudio = new Audio('/chime1.wav');
const chime2Audio = new Audio('/chime2.wav');

export function useChatMessages(maxMessages = MAX_MESSAGES, notificationsRef?: React.RefObject<ChatFilters | null>) {
  const dataStore = useDataStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [filters, setFilters] = useState<ChatFilters>({ ...DEFAULT_FILTERS });
  const [mutedSenders, setMutedSenders] = useState<string[]>([]);
  const [soundAlerts, setSoundAlerts] = useState<ChatFilters>({ ...DEFAULT_SOUND_ALERTS });
  const [newestFirst, setNewestFirst] = useState(true);
  const loaded = useRef(false);

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
      } catch (e) {
        console.error('Failed to load chat settings:', e);
      }
      loaded.current = true;
    })();
  }, [dataStore.ready]);

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

  const handleChatMessage = useCallback((msg: ChatMessage) => {
    const m = mutedSendersRef.current;
    const isMuted = m.some((name) => name.toLowerCase() === msg.sender.toLowerCase());

    // Sound alert
    const s = soundAlertsRef.current;
    if (!msg.isOwn && s[msg.type] && !isMuted) {
      const audio = msg.type === 'tell' || msg.type === 'sz' ? chime2Audio : chimeAudio;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }

    // Desktop notification when window is unfocused
    const n = notificationsRef?.current;
    if (n && !msg.isOwn && n[msg.type] && !isMuted && document.hidden) {
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`${msg.sender} (${msg.type})`, {
            body: msg.message,
            tag: `dartforge-chat-${msg.type}`,
          });
        }
      } catch { /* ignore */ }
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
    handleChatMessage,
    toggleFilter,
    setAllFilters,
    toggleSoundAlert,
    toggleNewestFirst,
    muteSender,
    unmuteSender,
    clearMessages,
    updateSender,
  };
}
