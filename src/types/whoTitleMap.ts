export type WhoTitleId = string;

export interface WhoTitleMapping {
  id: WhoTitleId;
  whoTitle: string; // e.g., "a lavender spyder"
  playerName: string; // e.g., "Mazorn"
  confirmed: boolean; // true = confirmed, false = suspected
}
