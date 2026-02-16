import { useGameClock } from '../hooks/useGameClock';
import { SunIcon, MoonIcon, SunriseIcon, SunsetIcon } from './icons';

function TimeIcon({ hour, accent }: { hour: number; accent: string }) {
  const style = { filter: `drop-shadow(0 0 3px ${accent})` };
  if (hour >= 4 && hour < 6) return <SunriseIcon size={11} />;
  if (hour >= 6 && hour < 18) return <span style={style}><SunIcon size={11} /></span>;
  if (hour >= 18 && hour < 20) return <SunsetIcon size={11} />;
  return <span style={style}><MoonIcon size={11} /></span>;
}

export function GameClock() {
  const {
    formattedDate,
    hour,
    timeOfDay,
    holiday,
    reckoningLabel,
    accent,
    cycleReckoning,
  } = useGameClock();

  return (
    <button
      onClick={cycleReckoning}
      title="Click to cycle reckoning"
      className="game-clock relative flex items-center gap-2.5 pl-2.5 pr-3 py-[3px] rounded-[3px] select-none cursor-pointer border border-transparent transition-all duration-300"
      style={
        {
          '--gc-accent': accent,
          borderLeftWidth: 2,
          borderLeftColor: accent,
          borderLeftStyle: 'solid',
        } as React.CSSProperties
      }
    >
      {/* Time of day — accent colored, icon gets glow */}
      <span className="flex items-center gap-1 w-[10ch]" style={{ color: accent }}>
        <TimeIcon hour={hour} accent={accent} />
        <span className="text-[11px] leading-none tracking-wide uppercase">{timeOfDay}</span>
      </span>

      <span className="text-[11px] text-text-disabled leading-none">&middot;</span>

      {/* Date — primary readout */}
      <span className="text-[11px] leading-none text-text-label w-[32ch] text-center tracking-[0.01em]">
        {formattedDate}
      </span>

      {/* Holiday badge — rare, should feel special */}
      {holiday && (
        <>
          <span className="text-[11px] text-text-disabled leading-none">&middot;</span>
          <span
            className="game-clock-holiday text-[10px] leading-none px-1.5 py-[2px] rounded-[2px] tracking-wide"
            style={{
              color: accent,
              background: `color-mix(in srgb, ${accent} 8%, transparent)`,
              boxShadow: `0 0 6px color-mix(in srgb, ${accent} 15%, transparent)`,
            }}
          >
            {holiday}
          </span>
        </>
      )}

      <span className="text-[11px] text-text-disabled leading-none">&middot;</span>

      {/* Reckoning label — quiet metadata */}
      <span className="text-[11px] leading-none text-text-dim w-[8ch] text-right tracking-[0.02em]">
        {reckoningLabel}
      </span>
    </button>
  );
}
