interface ConnectionDotProps {
  connected: boolean;
}

export function ConnectionDot({ connected }: ConnectionDotProps) {
  const color = connected ? '#22c55e' : '#ef4444';
  return (
    <div
      title={connected ? 'Connected to DartMUD' : 'Disconnected'}
      style={{
        position: 'fixed',
        bottom: '14px',
        right: '14px',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 4px ${color}88, 0 0 12px ${color}44`,
        zIndex: 1000,
        pointerEvents: 'none',
        transition: 'background 0.4s ease, box-shadow 0.4s ease',
      }}
    />
  );
}
