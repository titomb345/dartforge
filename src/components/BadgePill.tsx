export function BadgePill({
  label,
  count,
  active,
  onClick,
  accent = 'default',
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  accent?: 'default' | 'red';
}) {
  const accentStyles = {
    default: active
      ? 'bg-cyan/15 border-cyan/40 text-cyan'
      : 'border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle',
    red: active
      ? 'bg-red/15 border-red/40 text-red'
      : 'border-border-dim text-text-dim hover:text-text-label hover:border-border-subtle',
  };

  return (
    <button
      onClick={onClick}
      className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border cursor-pointer transition-colors duration-150 whitespace-nowrap ${accentStyles[accent]}`}
    >
      {label}{count > 0 ? ` (${count})` : ''}
    </button>
  );
}
