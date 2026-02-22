import { useEffect, useRef, useState } from 'react';
import { MudInput, MudButton } from './shared';

/** Heuristic: extract a trailing signature pattern from a message body */
function guessSignature(message: string): string {
  const patterns = [
    /(\*[^*]+\*)\s*$/,
    /(~[^~]+~)\s*$/,
    /(--\w+)\s*$/,
    /(-\w+)\s*$/,
    /(\[[^\]]+\])\s*$/,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m) return m[1];
  }
  return '';
}

/** Strip non-alpha chars from a signature to produce a name guess */
function guessPlayerName(signature: string): string {
  return signature.replace(/[^a-zA-Z]/g, '');
}

export function IdentifyForm({
  message,
  onSave,
  onCancel,
}: {
  message: string;
  onSave: (signature: string, playerName: string) => void;
  onCancel: () => void;
}) {
  const guessedSig = guessSignature(message);
  const [signature, setSignature] = useState(guessedSig);
  const [playerName, setPlayerName] = useState(guessPlayerName(guessedSig));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sig = signature.trim();
    const name = playerName.trim();
    if (sig && name) onSave(sig, name);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-1 px-2 py-1 bg-bg-secondary/50 rounded mt-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <MudInput
        ref={inputRef}
        size="sm"
        value={signature}
        onChange={(e) => setSignature(e.target.value)}
        placeholder="Signature"
        className="w-20"
      />
      <MudInput
        size="sm"
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
        placeholder="Player name"
        className="w-20"
      />
      <MudButton
        type="submit"
        size="sm"
        disabled={!signature.trim() || !playerName.trim()}
      >
        Save
      </MudButton>
      <MudButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
      >
        Cancel
      </MudButton>
    </form>
  );
}
