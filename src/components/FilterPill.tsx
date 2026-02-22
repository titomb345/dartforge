import type React from 'react';

const ACCENT_STYLES: Record<string, string> = {
  cyan: 'bg-cyan/15 border-cyan/40 text-cyan',
  purple: 'bg-[#a78bfa]/15 border-[#a78bfa]/40 text-[#a78bfa]',
  pink: 'bg-[#ff79c6]/15 border-[#ff79c6]/40 text-[#ff79c6]',
  amber: 'bg-amber/15 border-amber/40 text-amber',
  green: 'bg-[#4ade80]/15 border-[#4ade80]/40 text-[#4ade80]',
};

const INACTIVE_STYLE =
  'bg-transparent border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle';

interface FilterPillProps {
  label: string;
  active: boolean;
  accent?: string;
  /** When true, uses amber accent regardless of active/accent props (ChatPanel exclusive filter). */
  exclusive?: boolean;
  /** Shows a small dot indicator in the top-right corner. */
  soundAlert?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function FilterPill({
  label,
  active,
  accent = 'cyan',
  exclusive,
  soundAlert,
  onClick,
  onContextMenu,
}: FilterPillProps) {
  const activeStyle = exclusive
    ? ACCENT_STYLES.amber
    : ACCENT_STYLES[accent] ?? ACCENT_STYLES.cyan;

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={onContextMenu ? 'Right-click to toggle sound alert' : undefined}
      className={`relative px-2 py-0.5 text-[10px] font-mono rounded-full border cursor-pointer transition-colors duration-150 whitespace-nowrap ${
        active || exclusive ? activeStyle : INACTIVE_STYLE
      }`}
    >
      {label}
      {soundAlert && (
        <span
          className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full"
          style={{
            backgroundColor: exclusive
              ? 'var(--color-amber)'
              : active
                ? 'var(--color-cyan)'
                : 'var(--color-text-dim)',
          }}
        />
      )}
    </button>
  );
}
