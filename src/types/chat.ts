export type ChatType = 'say' | 'shout' | 'ooc' | 'tell' | 'sz';

export interface ChatMessage {
  id: number;
  type: ChatType;
  sender: string;
  message: string;
  language?: string;
  raw: string;
  timestamp: Date;
  directed?: boolean;
  isOwn?: boolean;
}

export type ChatFilters = Record<ChatType, boolean>;
