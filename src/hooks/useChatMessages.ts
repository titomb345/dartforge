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

export function useChatMessages() {
  const dataStore = useDataStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [filters, setFilters] = useState<ChatFilters>({ ...DEFAULT_FILTERS });
  const [mutedSenders, setMutedSenders] = useState<string[]>([]);
  const loaded = useRef(false);

  // Load persisted chat settings
  useEffect(() => {
    if (!dataStore.ready) return;
    (async () => {
      try {
        const savedFilters = await dataStore.get<ChatFilters>(SETTINGS_FILE, 'chatFilters');
        if (savedFilters) setFilters(savedFilters);
        const savedMuted = await dataStore.get<string[]>(SETTINGS_FILE, 'chatMutedSenders');
        if (savedMuted) setMutedSenders(savedMuted);
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

  const handleChatMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const next = [...prev, msg];
      return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    });
  }, []);

  const toggleFilter = useCallback((type: ChatType) => {
    setFilters((prev) => ({ ...prev, [type]: !prev[type] }));
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

  return {
    messages,
    filters,
    mutedSenders,
    handleChatMessage,
    toggleFilter,
    muteSender,
    unmuteSender,
    clearMessages,
  };
}
