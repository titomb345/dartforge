import { forwardRef } from 'react';

/* ── Accent color mappings ──────────────────────────────────── */

const FOCUS_COLORS = {
  cyan: 'focus:border-cyan/40',
  red: 'focus:border-red/40',
  purple: 'focus:border-[#a78bfa]/40',
  pink: 'focus:border-[#ff79c6]/40',
  green: 'focus:border-[#4ade80]/40',
} as const;

const BTN_ACCENT = {
  cyan: 'bg-cyan/15 border-cyan/30 text-cyan hover:bg-cyan/25',
  red: 'bg-red/15 border-red/30 text-red hover:bg-red/25',
  purple: 'bg-[#a78bfa]/10 border-[#a78bfa]/40 text-[#a78bfa] hover:bg-[#a78bfa]/20',
  pink: 'bg-[#ff79c6]/10 border-[#ff79c6]/40 text-[#ff79c6] hover:bg-[#ff79c6]/20',
  green: 'bg-[#4ade80]/10 border-[#4ade80]/40 text-[#4ade80] hover:bg-[#4ade80]/20',
} as const;

const SIZE_CLASSES = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-[11px] px-2 py-1',
  lg: 'text-[12px] px-2 py-1',
} as const;

type Accent = keyof typeof FOCUS_COLORS;
type Size = keyof typeof SIZE_CLASSES;

/* ── MudInput ───────────────────────────────────────────────── */

interface MudInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  accent?: Accent;
  size?: Size;
}

export const MudInput = forwardRef<HTMLInputElement, MudInputProps>(
  ({ accent = 'cyan', size = 'md', className, ...props }, ref) => (
    <input
      ref={ref}
      type="text"
      spellCheck={false}
      autoComplete="off"
      className={`font-mono bg-bg-input border border-border-dim rounded text-text-primary placeholder:text-text-dim focus:outline-none transition-colors duration-150 ${SIZE_CLASSES[size]} ${FOCUS_COLORS[accent]} ${className ?? ''}`}
      {...props}
    />
  ),
);
MudInput.displayName = 'MudInput';

/* ── MudTextarea ────────────────────────────────────────────── */

interface MudTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  accent?: Accent;
  size?: Size;
}

export const MudTextarea = forwardRef<HTMLTextAreaElement, MudTextareaProps>(
  ({ accent = 'cyan', size = 'md', className, ...props }, ref) => (
    <textarea
      ref={ref}
      spellCheck={false}
      autoComplete="off"
      className={`font-mono bg-bg-input border border-border-dim rounded text-text-primary placeholder:text-text-dim focus:outline-none transition-colors duration-150 resize-y ${SIZE_CLASSES[size]} ${FOCUS_COLORS[accent]} ${className ?? ''}`}
      {...props}
    />
  ),
);
MudTextarea.displayName = 'MudTextarea';

/* ── MudButton ──────────────────────────────────────────────── */

interface MudButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  accent?: Accent;
  variant?: 'accent' | 'ghost';
  size?: Size;
}

export const MudButton = forwardRef<HTMLButtonElement, MudButtonProps>(
  ({ accent = 'cyan', variant = 'accent', size = 'md', className, ...props }, ref) => {
    const base =
      'font-mono font-semibold rounded border cursor-pointer transition-colors duration-150 disabled:opacity-25 disabled:cursor-default';

    const variantClass =
      variant === 'accent'
        ? BTN_ACCENT[accent]
        : 'border-border-dim text-text-dim hover:text-text-label';

    return (
      <button
        ref={ref}
        className={`${base} ${SIZE_CLASSES[size]} ${variantClass} ${className ?? ''}`}
        {...props}
      />
    );
  },
);
MudButton.displayName = 'MudButton';
