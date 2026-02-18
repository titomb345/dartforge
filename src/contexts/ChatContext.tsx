import { createContext, useContext } from 'react';
import type { ChatMessage, ChatType, ChatFilters } from '../types/chat';

export interface ChatState {
  messages: ChatMessage[];
  filters: ChatFilters;
  mutedSenders: string[];
  toggleFilter: (type: ChatType) => void;
  muteSender: (name: string) => void;
  unmuteSender: (name: string) => void;
}

const ChatContext = createContext<ChatState | null>(null);

export const ChatProvider = ChatContext.Provider;

export function useChatContext(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within a ChatProvider');
  return ctx;
}
