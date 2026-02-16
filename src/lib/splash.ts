import { ANSI } from './ansi';

const { RESET, DIM, CYAN, GREEN, BRIGHT_RED } = ANSI;

// 256-color ANSI: \x1b[38;5;Nm
const color = (n: number) => `\x1b[1;38;5;${n}m`;

// Pink → Orange → Green → Blue gradient across 9 letters (DARTFORGE)
const GRADIENT = [
  color(198), // D - hot pink
  color(196), // A - red
  color(202), // R - orange-red
  color(208), // T - orange
  color(214), // F - gold
  color(40),  // O - green
  color(39),  // R - sky blue
  color(33),  // G - blue
  color(27),  // E - deep blue
];

// Each letter is 5 rows x 6 cols (using ██ per pixel)
const LETTERS: Record<string, string[]> = {
  D: [
    '████  ',
    '██  ██',
    '██  ██',
    '██  ██',
    '████  ',
  ],
  A: [
    ' ████ ',
    '██  ██',
    '██████',
    '██  ██',
    '██  ██',
  ],
  R: [
    '████  ',
    '██  ██',
    '████  ',
    '██ ██ ',
    '██  ██',
  ],
  T: [
    '██████',
    '  ██  ',
    '  ██  ',
    '  ██  ',
    '  ██  ',
  ],
  F: [
    '██████',
    '██    ',
    '████  ',
    '██    ',
    '██    ',
  ],
  O: [
    ' ████ ',
    '██  ██',
    '██  ██',
    '██  ██',
    ' ████ ',
  ],
  G: [
    ' █████',
    '██    ',
    '██ ███',
    '██  ██',
    ' █████',
  ],
  E: [
    '██████',
    '██    ',
    '████  ',
    '██    ',
    '██████',
  ],
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
  const colors = [198, 196, 202, 208, 214, 40, 39, 33, 27];
  let bar = '';
  for (let i = 0; i < len; i++) {
    const idx = Math.floor((i / len) * (colors.length - 1));
    const c = colors[Math.min(idx, colors.length - 1)];
    bar += `\x1b[1;38;5;${c}m━`;
  }
  return bar + RESET;
}

function center(lines: string[], width: number): string[] {
  return lines.map((line) => {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, Math.floor((width - visible.length) / 2));
    return ' '.repeat(pad) + line;
  });
}

export function getStartupSplash(cols: number): string {
  const logo = buildGradientWord('DARTFORGE', GRADIENT);
  const bar = gradientBar(cols);
  const lines = [
    '',
    '',
    ...center([bar], cols),
    '',
    ...center(logo, cols),
    '',
    ...center([bar], cols),
    '',
    ...center([`${DIM}${CYAN}DartMUD Client v0.1.0${RESET}`], cols),
    ...center([`${DIM}Connecting to dartmud.com:2525...${RESET}`], cols),
    '',
    '',
  ];
  return lines.join('\r\n');
}

export function getConnectedSplash(cols: number): string {
  const logo = buildGradientWord('DARTFORGE', GRADIENT);
  const bar = gradientBar(cols);
  const lines = [
    '',
    '',
    ...center([bar], cols),
    '',
    ...center(logo, cols),
    '',
    ...center([bar], cols),
    '',
    ...center([`${DIM}${CYAN}DartMUD Client v0.1.0${RESET}`], cols),
    ...center([`${GREEN}Connected to DartMUD${RESET}`], cols),
    '',
    '',
  ];
  return lines.join('\r\n');
}

export function getDisconnectSplash(cols: number): string {
  const len = Math.min(cols - 4, 52);
  const reds = [196, 197, 198, 199, 200, 199, 198, 197, 196];
  let bar = '';
  for (let i = 0; i < len; i++) {
    const idx = Math.floor((i / len) * (reds.length - 1));
    bar += `\x1b[1;38;5;${reds[idx]}m━`;
  }
  bar += RESET;
  const lines = [
    '',
    '',
    ...center([bar], cols),
    '',
    ...center([`${BRIGHT_RED}Connection Lost${RESET}`], cols),
    '',
    ...center([`${DIM}The link to DartMUD has been severed.${RESET}`], cols),
    ...center([`${DIM}${GREEN}Hit reconnect to try again.${RESET}`], cols),
    '',
    ...center([bar], cols),
    '',
  ];
  return lines.join('\r\n');
}
