import type { Panel } from '../types';

/**
 * The one place the app's accent colors are decided.
 *
 * Each panel has a color that follows it everywhere: its toolbar button, its
 * status chip, its badges. Change it here and every surface agrees. The base
 * theme (backgrounds, text, borders) lives in index.css; these are the
 * per-feature colors layered on top of it.
 */
export const PANEL_ACCENT: Record<Panel, string> = {
  who: '#61afef',
  chat: '#8be9fd',
  counter: '#f59e0b',
  skills: '#50fa7b',
  notes: '#fbbf24',
  map: '#e8a849',
  alloc: '#e06c75',
  loadout: '#bd93f9',
  currency: '#cd7f32',
  babel: '#e879f9',
  aliases: '#a78bfa',
  triggers: '#ff79c6',
  timers: '#f97316',
  variables: '#4ade80',
  macros: '#e8a849',
  scripts: '#8be9fd',
  logs: '#94a3b8',
  appearance: '#8be9fd',
  settings: '#bd93f9',
  help: '#d9af50',
};

/** Toolbar actions that are not panels. */
export const ACTION_ACCENT = {
  screenshot: '#f472b6',
} as const;

/** Status chips beside the command input. */
export const CHIP_ACCENT = {
  blocked: '#f59e0b',
  movement: '#2dd4bf',
  babel: PANEL_ACCENT.babel,
  inscriber: '#60a5fa',
  caster: '#34d399',
  casterWeight: '#fbbf24',
  conc: '#c084fc',
  announce: '#fb923c',
  alignment: '#80e080',
  who: PANEL_ACCENT.who,
  equip: PANEL_ACCENT.loadout,
  antiIdle: PANEL_ACCENT.logs,
  timer: PANEL_ACCENT.timers,
} as const;
