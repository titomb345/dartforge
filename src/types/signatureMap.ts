export type SignatureId = string;

export interface SignatureMapping {
  id: SignatureId;
  signature: string;    // e.g., "*Maz*", "~Bob~"
  playerName: string;   // e.g., "Mazorn"
}
