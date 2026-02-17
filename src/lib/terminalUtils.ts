import type { Terminal } from '@xterm/xterm';

/**
 * Write data to terminal with smart auto-scroll.
 * If user has scrolled up to read history, new output won't yank them back.
 * If user is at the bottom, it scrolls normally.
 */
export function smartWrite(term: Terminal, data: string) {
  const buffer = term.buffer.active;
  const scrolledUp = buffer.baseY - buffer.viewportY;

  if (scrolledUp <= 0) {
    term.write(data);
  } else {
    term.write(data, () => {
      const newBase = term.buffer.active.baseY;
      term.scrollToLine(newBase - scrolledUp);
    });
  }
}
