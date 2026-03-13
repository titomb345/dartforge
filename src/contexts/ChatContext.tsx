import { createContext, useContext } from 'react';
import type { ChatMessage, ChatType, ChatFilters, OutgoingMessage } from '../types/chat';

export interface ChatState {
  messages: ChatMessage[];
  filters: ChatFilters;
  mutedSenders: string[];
  soundAlerts: ChatFilters;
  newestFirst: boolean;
  hideOwnMessages: boolean;
  outgoingMessages: OutgoingMessage[];
  toggleFilter: (type: ChatType) => void;
  setAllFilters: (filters: ChatFilters) => void;
  toggleSoundAlert: (type: ChatType) => void;
  toggleNewestFirst: () => void;
  toggleHideOwnMessages: () => void;
  muteSender: (name: string) => void;
  unmuteSender: (name: string) => void;
  updateSender: (signature: string, playerName: string) => void;
  deleteMessage: (id: number) => void;
  addOutgoingMessage: (command: string) => void;
  deleteOutgoingMessage: (id: number) => void;
}

const ChatContext = createContext<ChatState | null>(null);

export const ChatProvider = ChatContext.Provider;

export function useChatContext(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within a ChatProvider');
  return ctx;
}
