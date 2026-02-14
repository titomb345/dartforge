export type ClassMode = 'mage' | 'fighter' | 'multi';

export interface MudOutputPayload {
  data: string;
}

export interface ConnectionStatusPayload {
  connected: boolean;
  message: string;
}
