import { useGameClock } from '../hooks/useGameClock';
import { cn } from '../lib/cn';
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
    allDates,
    cycleReckoning,
  } = useGameClock();

  return (
    <button
      onClick={cycleReckoning}
      title={allDates}
      className="game-clock relative flex items-center gap-2.5 h-[20px] pl-2.5 pr-3 rounded-[3px] select-none cursor-pointer border border-transparent transition-all duration-300"
      style={
        {
          '--gc-accent': accent,
          borderLeftWidth: 2,
          borderLeftColor: accent,
          borderLeftStyle: 'solid',
        } as React.CSSProperties
      }
    >
      {/* Time of day — icon only, text in tooltip */}
      <span className="flex items-center" style={{ color: accent }} title={timeOfDay}>
        <TimeIcon hour={hour} accent={accent} />
      </span>

      <span className="text-[11px] text-text-disabled leading-none">&middot;</span>

      {/* Date — primary readout, natural width */}
      <span className="text-[11px] leading-none text-text-label whitespace-nowrap tracking-[0.01em]">
        {formattedDate}
      </span>

      {/* Holiday badge — animated reveal, no height shift */}
      <span
        className={cn(
          'flex items-center gap-2.5 transition-all duration-500 overflow-hidden',
          holiday ? 'max-w-[300px] opacity-100' : 'max-w-0 opacity-0'
        )}
      >
        <span className="text-[11px] text-text-disabled leading-none">&middot;</span>
        <span
          className="game-clock-holiday text-[10px] leading-none px-1.5 py-[2px] rounded-[2px] tracking-wide whitespace-nowrap"
          style={{
            color: accent,
            background: `color-mix(in srgb, ${accent} 8%, transparent)`,
            boxShadow: `0 0 6px color-mix(in srgb, ${accent} 15%, transparent)`,
          }}
        >
          {holiday ?? ''}
        </span>
      </span>

      <span className="text-[11px] text-text-disabled leading-none">&middot;</span>

      {/* Reckoning label — natural width */}
      <span className="text-[11px] leading-none text-text-dim whitespace-nowrap tracking-[0.02em]">
        {reckoningLabel}
      </span>
    </button>
  );
}
