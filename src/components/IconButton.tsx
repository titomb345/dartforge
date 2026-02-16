import { type CSSProperties, type ReactNode, useState } from 'react';

interface IconButtonProps {
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  toggled?: boolean;
  accent?: string;
  onClick: () => void;
}

export function IconButton({
  icon,
  title,
  disabled,
  toggled,
  accent = '#8be9fd',
  onClick,
}: IconButtonProps) {
  const [hovered, setHovered] = useState(false);
  const active = !disabled && hovered;
  const on = toggled === true;

  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    padding: 0,
    background: on
      ? `${accent}18`
      : active
        ? `${accent}12`
        : 'transparent',
    color: disabled ? '#333' : on ? accent : active ? accent : '#666',
    border: `1px solid ${on ? `${accent}44` : active ? `${accent}44` : disabled ? '#1e1e1e' : '#2a2a2a'}`,
    borderRadius: '6px',
    cursor: disabled ? 'default' : 'pointer',
    userSelect: 'none',
    lineHeight: 1,
    transition: 'all 0.2s ease',
    filter: on ? `drop-shadow(0 0 4px ${accent}88)` : active ? `drop-shadow(0 0 3px ${accent}44)` : 'none',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon}
    </button>
  );
}
