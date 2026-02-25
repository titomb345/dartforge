import { CloudIcon } from './icons';
import { cn } from '../lib/cn';

// Block-pixel letters: 5 rows × 6 chars each (██ = on, spaces = off)
const LETTERS: Record<string, string[]> = {
  D: ['████  ', '██  ██', '██  ██', '██  ██', '████  '],
  A: [' ████ ', '██  ██', '██████', '██  ██', '██  ██'],
  R: ['████  ', '██  ██', '████  ', '██ ██ ', '██  ██'],
  T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
  M: ['██  ██', '██████', '██████', '██  ██', '██  ██'],
  U: ['██  ██', '██  ██', '██  ██', '██  ██', ' ████ '],
};

const WORD = 'DARTMUD';

// Rainbow gradient: warm → cool across the 7 letters
const COLORS = [
  '#ff6b9d', // D — hot pink
  '#ff4444', // A — red
  '#ff8833', // R — orange
  '#ffcc33', // T — gold
  '#33cc66', // M — green
  '#33ccff', // U — cyan
  '#7c6bf5', // D — purple
];

function buildRows(): { text: string; color: string }[][] {
  const rows: { text: string; color: string }[][] = [];
  for (let row = 0; row < 5; row++) {
    const segs: { text: string; color: string }[] = [];
    for (let i = 0; i < WORD.length; i++) {
      const letter = LETTERS[WORD[i]][row];
      segs.push({ text: letter, color: COLORS[i] });
      if (i < WORD.length - 1) segs.push({ text: ' ', color: 'transparent' });
    }
    rows.push(segs);
  }
  return rows;
}

const BANNER_ROWS = buildRows();

// Gradient bar matching the letter colors
function GradientBar() {
  const stops = COLORS.map((c, i) => `${c} ${(i / (COLORS.length - 1)) * 100}%`).join(', ');
  return (
    <div
      className="h-[2px] rounded-full opacity-60"
      style={{
        width: '100%',
        maxWidth: '49ch',
        background: `linear-gradient(90deg, ${stops})`,
        filter: 'blur(0.5px)',
      }}
    />
  );
}

interface WebSetupScreenProps {
  onChooseDropbox: () => void;
  onChooseLocal: () => void;
}

export function WebSetupScreen({ onChooseDropbox, onChooseLocal }: WebSetupScreenProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0a0a0a] overflow-hidden">
      {/* Shimmer keyframes */}
      <style>{`
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 0.45; }
        }
      `}</style>

      {/* Atmospheric background */}
      <div
        className="absolute inset-0 opacity-25"
        style={{
          background:
            'radial-gradient(ellipse at 50% 25%, rgba(255,107,157,0.07) 0%, transparent 55%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background:
            'radial-gradient(ellipse at 30% 75%, rgba(51,204,255,0.05) 0%, transparent 50%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-15"
        style={{
          background:
            'radial-gradient(ellipse at 80% 60%, rgba(124,107,245,0.05) 0%, transparent 45%)',
        }}
      />

      {/* DARTMUD Banner */}
      <div className="relative mb-5 flex flex-col items-center">
        {/* Glow layer behind the text */}
        <div
          className="absolute inset-0 font-mono select-none pointer-events-none"
          style={{
            fontSize: 'clamp(8px, 1.9vw, 14px)',
            lineHeight: 1.1,
            filter: 'blur(6px)',
            animation: 'glow-pulse 5s ease-in-out infinite',
          }}
          aria-hidden="true"
        >
          {BANNER_ROWS.map((segs, i) => (
            <div key={i} className="whitespace-pre">
              {segs.map((seg, j) => (
                <span key={j} style={{ color: seg.color }}>
                  {seg.text}
                </span>
              ))}
            </div>
          ))}
        </div>

        {/* Main colored text */}
        <div
          className="relative font-mono select-none"
          style={{
            fontSize: 'clamp(8px, 1.9vw, 14px)',
            lineHeight: 1.1,
          }}
        >
          {BANNER_ROWS.map((segs, i) => (
            <div key={i} className="whitespace-pre">
              {segs.map((seg, j) => (
                <span
                  key={j}
                  style={{
                    color: seg.color,
                    textShadow:
                      seg.color !== 'transparent'
                        ? `0 0 6px ${seg.color}55, 0 0 20px ${seg.color}22`
                        : 'none',
                  }}
                >
                  {seg.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Gradient bar */}
      <div className="flex justify-center mb-4">
        <GradientBar />
      </div>

      {/* Year tagline */}
      <div
        className="font-mono tracking-[0.25em] mb-1"
        style={{ fontSize: 'clamp(8px, 1.1vw, 11px)', color: '#444' }}
      >
        -= 1991 - 2025 =-
      </div>

      {/* Subtitle */}
      <div className="font-mono mb-8" style={{ fontSize: 'clamp(8px, 1vw, 10px)', color: '#333' }}>
        Welcome to The Lands of Ferdarchi
      </div>

      {/* Storage options card */}
      <div className="relative w-[400px] max-w-[85vw]">
        {/* Border glow */}
        <div
          className="absolute -inset-px rounded-lg opacity-30"
          style={{
            background:
              'linear-gradient(135deg, rgba(139,233,253,0.2), rgba(167,139,250,0.1), transparent 60%)',
          }}
        />

        <div className="relative bg-[#0f0f0f] rounded-lg border border-[#1a1a1a] overflow-hidden">
          {/* Header */}
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-[#ccc]">DartForge</span>
              <span className="text-[9px] font-mono text-cyan/40 uppercase tracking-widest">
                Setup
              </span>
            </div>
            <p className="text-[11px] text-[#555] mt-2">
              Choose how DartForge stores your settings and skill data.
            </p>
          </div>

          <div className="h-px bg-[#1a1a1a]" />

          {/* Options */}
          <div className="px-5 py-4 space-y-2.5">
            {/* Sync with Dropbox */}
            <button
              onClick={onChooseDropbox}
              className={cn(
                'w-full flex items-center gap-3 px-3.5 py-2.5 rounded transition-all',
                'border border-[#222] bg-[#111] hover:border-cyan/25 hover:bg-cyan/5',
                'cursor-pointer group'
              )}
            >
              <div className="flex items-center justify-center w-7 h-7 rounded bg-[#1a1a1a] text-[#444] group-hover:text-cyan transition-colors">
                <CloudIcon size={14} />
              </div>
              <div className="flex-1 text-left">
                <div className="text-[11px] text-[#999] font-medium">Sync with Dropbox</div>
                <div className="text-[9px] text-[#3a3a3a] mt-0.5">
                  Store data in your Dropbox — sync across devices
                </div>
              </div>
            </button>

            {/* Divider with "or" */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[#1a1a1a]" />
              <span className="text-[9px] text-[#333] font-mono uppercase">or</span>
              <div className="h-px flex-1 bg-[#1a1a1a]" />
            </div>

            {/* Use Local Storage */}
            <button
              onClick={onChooseLocal}
              className={cn(
                'w-full flex items-center gap-3 px-3.5 py-2.5 rounded transition-all',
                'border border-[#222] bg-[#111] hover:border-[#333] hover:bg-[#151515]',
                'cursor-pointer group'
              )}
            >
              <div className="flex items-center justify-center w-7 h-7 rounded bg-[#1a1a1a] text-[#444] group-hover:text-[#666] transition-colors">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M6 12h.01" />
                  <path d="M10 12h.01" />
                </svg>
              </div>
              <div className="flex-1 text-left">
                <div className="text-[11px] text-[#999] font-medium">Use Local Storage</div>
                <div className="text-[9px] text-[#3a3a3a] mt-0.5">
                  Data stays in this browser only
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
