interface StatusReadoutProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  tooltip: string;
  glow?: boolean;
  onClick?: () => void;
}

export function StatusReadout({ icon, label, color, tooltip, glow, onClick }: StatusReadoutProps) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`status-readout relative flex items-center gap-1.5 pl-2 pr-2.5 py-[3px] rounded-[3px] select-none border border-transparent transition-all duration-500 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      style={
        {
          '--readout-color': color,
          borderLeftWidth: 2,
          borderLeftColor: color,
          borderLeftStyle: 'solid',
        } as React.CSSProperties
      }
    >
      <span
        className="flex items-center transition-all duration-500"
        style={{
          color,
          filter: glow ? `drop-shadow(0 0 3px ${color})` : 'none',
        }}
      >
        {icon}
      </span>

      <span
        className="text-[11px] leading-none tracking-wide uppercase transition-colors duration-500"
        style={{ color }}
      >
        {label}
      </span>
    </button>
  );
}
