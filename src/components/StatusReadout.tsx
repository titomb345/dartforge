interface StatusReadoutProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  tooltip: string;
  glow?: boolean;
  compact?: boolean;
  filtered?: boolean;
  onClick?: () => void;
}

export function StatusReadout({ icon, label, color, tooltip, glow, compact, filtered, onClick }: StatusReadoutProps) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`status-readout relative flex items-center rounded-[3px] select-none border border-transparent transition-all duration-200 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      style={
        {
          '--readout-color': color,
          opacity: filtered ? 0.4 : 1,
          paddingLeft: compact ? 6 : 8,
          paddingRight: compact ? 6 : 10,
          paddingTop: 3,
          paddingBottom: 3,
          borderLeftWidth: 2,
          borderLeftColor: color,
          borderLeftStyle: filtered ? 'dashed' : 'solid',
        } as React.CSSProperties
      }
    >
      <span
        className="flex items-center transition-all duration-200"
        style={{
          color,
          filter: glow && !filtered ? `drop-shadow(0 0 3px ${color})` : 'none',
        }}
      >
        {icon}
      </span>

      <span
        className="text-[11px] leading-none tracking-wide uppercase overflow-hidden whitespace-nowrap transition-all duration-200"
        style={{
          color,
          maxWidth: compact ? 0 : 200,
          opacity: compact ? 0 : 1,
          marginLeft: compact ? 0 : 6,
        }}
      >
        {label}
      </span>
    </button>
  );
}
