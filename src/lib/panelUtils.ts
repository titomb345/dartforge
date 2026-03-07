/** Format remaining ms as "M:SS" countdown string. */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '0:00';
  const totalSec = Math.ceil(remainingMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/** CSS class for the root div of pinnable panels. */
export function panelRootClass(isPinned: boolean): string {
  return isPinned
    ? 'h-full flex flex-col overflow-hidden'
    : 'w-[360px] h-full bg-bg-primary border-l border-border-subtle flex flex-col overflow-hidden';
}

/** Capitalize first letter of a character name for display. */
export function charDisplayName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
