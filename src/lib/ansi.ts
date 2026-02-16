// ANSI escape code constants for terminal output
export const ANSI = {
  RESET: '\x1b[0m',
  DIM: '\x1b[2m',

  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',

  BRIGHT_RED: '\x1b[1;31m',
  BRIGHT_GREEN: '\x1b[1;32m',
  BRIGHT_YELLOW: '\x1b[1;33m',
  BRIGHT_MAGENTA: '\x1b[1;35m',
  BRIGHT_CYAN: '\x1b[1;36m',
} as const;
