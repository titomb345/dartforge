import { ANSI } from './ansi';

const { RESET, DIM, CYAN, GREEN, BRIGHT_GREEN } = ANSI;

// 256-color ANSI: \x1b[38;5;Nm
const color = (n: number) => `\x1b[1;38;5;${n}m`;

// Pink → Orange → Green → Blue gradient across 7 letters (DARTMUD)
const GRADIENT = [
  color(198), // D - hot pink
  color(196), // A - red
  color(208), // R - orange
  color(214), // T - gold
  color(40), // M - green
  color(39), // U - cyan
  color(63), // D - purple
];

// Each letter is 5 rows x 6 cols (using ██ per pixel)
const LETTERS: Record<string, string[]> = {
  D: ['████  ', '██  ██', '██  ██', '██  ██', '████  '],
  A: [' ████ ', '██  ██', '██████', '██  ██', '██  ██'],
  R: ['████  ', '██  ██', '████  ', '██ ██ ', '██  ██'],
  T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
  M: ['██  ██', '██████', '██████', '██  ██', '██  ██'],
  U: ['██  ██', '██  ██', '██  ██', '██  ██', ' ████ '],
  E: ['██████', '██    ', '████  ', '██    ', '██████'],
  I: ['██████', '  ██  ', '  ██  ', '  ██  ', '██████'],
  S: [' █████', '██    ', ' ████ ', '    ██', '█████ '],
  C: [' █████', '██    ', '██    ', '██    ', ' █████'],
  N: ['██  ██', '███ ██', '██████', '██ ███', '██  ██'],
  O: [' ████ ', '██  ██', '██  ██', '██  ██', ' ████ '],
  P: ['████  ', '██  ██', '████  ', '██    ', '██    '],
};

function buildGradientWord(word: string, colors: string[]): string[] {
  const rows: string[] = [];
  for (let row = 0; row < 5; row++) {
    let line = '';
    for (let i = 0; i < word.length; i++) {
      const letter = LETTERS[word[i]]?.[row] ?? '      ';
      line += colors[i] + letter + RESET;
      if (i < word.length - 1) line += ' ';
    }
    rows.push(line);
  }
  return rows;
}

function gradientBar(width: number): string {
  const len = Math.min(width - 4, 60);
  const colors = [198, 196, 208, 214, 40, 39, 63];
  let bar = '';
  for (let i = 0; i < len; i++) {
    const idx = Math.floor((i / len) * (colors.length - 1));
    const c = colors[Math.min(idx, colors.length - 1)];
    bar += `\x1b[1;38;5;${c}m━`;
  }
  return bar + RESET;
}

const LEFT_PAD = '  ';

/** Left-align with padding only (for the bar) */
function align(lines: string[]): string[] {
  return lines.map((line) => LEFT_PAD + line);
}

/** Center text under the bar, then left-pad the whole thing */
function centerUnderBar(lines: string[], barWidth: number): string[] {
  return lines.map((line) => {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, Math.floor((barWidth - visible.length) / 2));
    return LEFT_PAD + ' '.repeat(pad) + line;
  });
}

function mainSplash(cols: number, statusLine: string): string {
  const barWidth = Math.min(cols - 4, 60);
  const logo = buildGradientWord('DARTMUD', GRADIENT);
  const bar = gradientBar(cols);
  const year = `${DIM}-= 1991 - ${new Date().getFullYear()} =-${RESET}`;
  const welcome = `${DIM}Welcome to the Lands of Ferdarchi!${RESET}`;
  const lines = [
    '',
    '',
    ...align([bar]),
    '',
    ...centerUnderBar(logo, barWidth),
    '',
    ...align([bar]),
    '',
    ...centerUnderBar([year], barWidth),
    '',
    ...centerUnderBar([welcome], barWidth),
    '',
    ...centerUnderBar([statusLine], barWidth),
    '',
    '',
  ];
  return lines.join('\r\n');
}

export function getStartupSplash(cols: number): string {
  return mainSplash(cols, `${GREEN}Press Enter to connect${RESET}`);
}

export function getConnectingSplash(cols: number): string {
  return mainSplash(cols, `${CYAN}Connecting...${RESET}`);
}

export function getConnectedSplash(cols: number): string {
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return mainSplash(cols, `${BRIGHT_GREEN}Connected at ${time}${RESET}`);
}

// Dark-to-bright red gradient for "DROPPED" (7 letters)
const RED_GRADIENT = [52, 88, 160, 196, 160, 88, 52].map((n) => `\x1b[1;38;5;${n}m`);

function redBar(cols: number): string {
  const len = Math.min(cols - 4, 60);
  const reds = [52, 88, 124, 160, 196, 160, 124, 88, 52];
  let bar = '';
  for (let i = 0; i < len; i++) {
    const idx = Math.floor((i / len) * (reds.length - 1));
    bar += `\x1b[38;5;${reds[idx]}m━`;
  }
  return bar + RESET;
}

export function getDisconnectSplash(cols: number): string {
  const barWidth = Math.min(cols - 4, 60);
  const logo = buildGradientWord('DROPPED', RED_GRADIENT);
  const bar = redBar(cols);
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const lines = [
    '',
    '',
    ...align([bar]),
    '',
    ...centerUnderBar(logo, barWidth),
    '',
    ...align([bar]),
    '',
    ...centerUnderBar([`${DIM}Connection lost at ${time}${RESET}`], barWidth),
    '',
    ...centerUnderBar([`${GREEN}Press enter to reconnect.${RESET}`], barWidth),
    '',
    '',
  ];
  return lines.join('\r\n');
}
