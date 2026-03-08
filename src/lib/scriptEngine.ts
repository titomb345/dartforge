import type { TriggerMatch } from '../types/trigger';
import type { CommandRunner } from './commandUtils';
import { executeCommands } from './commandUtils';
import { getTierForCount, getImprovesToNextTier } from './skillTiers';
import { getSkillCategory } from './skillCategories';

/**
 * AsyncFunction constructor — allows `await` inside dynamically created functions.
 */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;

/** Shared delay helper — no need to recreate per invocation */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── Idle tracking ────────────────────────────────────────────────────
// In-memory timestamp of the last user-typed command (not timers/triggers/aliases).
// Initialized to Date.now() so a fresh session counts as "active".

let _lastUserInputTimeTs = Date.now();

/** Called from handleSend / quick buttons to stamp the last user-typed command time. */
export function stampUserInput(): void {
  _lastUserInputTimeTs = Date.now();
}

// ── Compiled function cache ──────────────────────────────────────────
// Key = paramNames.length + '\0' + globalScript + '\0' + body
// Avoids recompiling the same script on every trigger fire.

const fnCache = new Map<string, (...args: unknown[]) => Promise<void>>();
const MAX_CACHE_SIZE = 200;

function getOrCompile(
  paramNames: string[],
  body: string,
  globalScript: string
): (...args: unknown[]) => Promise<void> {
  const key = `${paramNames.length}\0${globalScript}\0${body}`;
  let fn = fnCache.get(key);
  if (fn) return fn;

  const fullBody = globalScript ? `${globalScript}\n${body}` : body;
  fn = new AsyncFunction(...paramNames, fullBody);

  // Evict oldest entries when cache grows too large
  if (fnCache.size >= MAX_CACHE_SIZE) {
    const first = fnCache.keys().next().value;
    if (first !== undefined) fnCache.delete(first);
  }
  fnCache.set(key, fn);
  return fn;
}

// ── Shared API builders ──────────────────────────────────────────────
// Extracted so both trigger and alias execution share one implementation.

function buildApi(runner: CommandRunner) {
  const send = async (text: string) => {
    const commands = runner.expand(String(text));
    await executeCommands(commands, runner);
  };

  const echo = (text: string) => runner.echo(String(text));

  const setVar = (name: string, value: string, scope?: 'character' | 'global') => {
    runner.setVar(String(name), String(value), scope ?? 'character');
  };

  const getVar = (name: string): string => {
    const vars = runner.getVariables();
    const found = vars.find((v) => v.name === String(name) && v.enabled);
    return found?.value ?? '';
  };

  const spam = async (count: number, text: string) => {
    const n = Math.min(Math.max(Math.floor(count), 1), 1000);
    for (let i = 0; i < n; i++) {
      await send(text);
    }
  };

  /** Returns the epoch ms of the last user-typed command (0 = none this session). */
  const lastUserInputTime = (): number => _lastUserInputTimeTs;

  // ── Skill accessors ──────────────────────────────────────────────

  const getSkillCount = (name: string): number => runner.getSkillCount(String(name));

  const getSkillLevel = (name: string): string => {
    return getTierForCount(runner.getSkillCount(String(name))).name;
  };

  const getSkillTier = (name: string): number => {
    return getTierForCount(runner.getSkillCount(String(name))).level;
  };

  const getSkillNext = (name: string): number => {
    return getImprovesToNextTier(runner.getSkillCount(String(name)));
  };

  const getSkillGroup = (name: string): string => {
    return getSkillCategory(String(name))[0];
  };

  const getSkill = (name: string): { level: string; count: number; tier: number; next: number; group: string } => {
    const n = String(name);
    const count = runner.getSkillCount(n);
    const t = getTierForCount(count);
    return { level: t.name, count, tier: t.level, next: getImprovesToNextTier(count), group: getSkillCategory(n)[0] };
  };

  const readFile = async (path: string): Promise<string> => runner.readFile(String(path));
  const writeFile = async (path: string, content: string): Promise<void> => runner.writeFile(String(path), String(content));
  const playSound = (id: number | string) => {
    if (typeof id === 'string') runner.playSound(id);
    else runner.playSound(Number(id));
  };
  const startTimer = (name: string) => runner.enableTimer(String(name));
  const stopTimer = (name: string) => runner.disableTimer(String(name));
  const enableTrigger = (name: string) => runner.enableTrigger(String(name));
  const disableTrigger = (name: string) => runner.disableTrigger(String(name));
  const enableAlias = (name: string) => runner.enableAlias(String(name));
  const disableAlias = (name: string) => runner.disableAlias(String(name));
  const getGameTime = () => runner.getGameTime();
  const getCounter = (name: string) => runner.getCounter(String(name));
  const getMovementMode = () => runner.getMovementMode();
  const setMovementMode = (mode: string) => runner.setMovementMode(String(mode));

  return {
    send, echo, setVar, getVar, spam, lastUserInputTime,
    getSkillCount, getSkillLevel, getSkillTier, getSkillNext, getSkillGroup, getSkill,
    readFile, writeFile, playSound, startTimer, stopTimer,
    enableTrigger, disableTrigger, enableAlias, disableAlias,
    getGameTime, getCounter, getMovementMode, setMovementMode,
  };
}

function charNames(activeCharacter: string | null) {
  const name = activeCharacter ?? '';
  return { name, cap: name.charAt(0).toUpperCase() + name.slice(1) };
}

// ── Trigger param layout (static — never changes) ───────────────────

const TRIGGER_PARAM_NAMES: string[] = [
  'send', 'echo', 'delay', 'setVar', 'getVar', 'spam', 'lastUserInputTime',
  'getSkillCount', 'getSkillLevel', 'getSkillTier', 'getSkillNext', 'getSkillGroup', 'getSkill',
  'readFile', 'writeFile', 'playSound', 'startTimer', 'stopTimer',
  'enableTrigger', 'disableTrigger', 'enableAlias', 'disableAlias',
  'getGameTime', 'getCounter', 'getMovementMode', 'setMovementMode',
  '$0', '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9',
  '$line', '$me', '$Me',
];

/**
 * Execute a trigger's script-mode body.
 */
export async function executeTriggerScript(
  body: string,
  match: TriggerMatch,
  activeCharacter: string | null,
  runner: CommandRunner,
  globalScript: string
): Promise<void> {
  const api = buildApi(runner);
  const ch = charNames(activeCharacter);

  const paramValues: unknown[] = [
    api.send, api.echo, delay, api.setVar, api.getVar, api.spam, api.lastUserInputTime,
    api.getSkillCount, api.getSkillLevel, api.getSkillTier, api.getSkillNext, api.getSkillGroup, api.getSkill,
    api.readFile, api.writeFile, api.playSound, api.startTimer, api.stopTimer,
    api.enableTrigger, api.disableTrigger, api.enableAlias, api.disableAlias,
    api.getGameTime, api.getCounter, api.getMovementMode, api.setMovementMode,
    match.captures[0] ?? '', match.captures[1] ?? '', match.captures[2] ?? '',
    match.captures[3] ?? '', match.captures[4] ?? '', match.captures[5] ?? '',
    match.captures[6] ?? '', match.captures[7] ?? '', match.captures[8] ?? '',
    match.captures[9] ?? '',
    match.line, ch.name, ch.cap,
  ];

  try {
    const fn = getOrCompile(TRIGGER_PARAM_NAMES, body, globalScript);
    await fn(...paramValues);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runner.echo(`\x1b[31m[Script Error] ${msg}\x1b[0m`);
  }
}

// ── Timer param layout (static — never changes) ─────────────────────

const TIMER_PARAM_NAMES: string[] = [
  'send', 'echo', 'delay', 'setVar', 'getVar', 'spam', 'lastUserInputTime',
  'getSkillCount', 'getSkillLevel', 'getSkillTier', 'getSkillNext', 'getSkillGroup', 'getSkill',
  'readFile', 'writeFile', 'playSound', 'startTimer', 'stopTimer',
  'enableTrigger', 'disableTrigger', 'enableAlias', 'disableAlias',
  'getGameTime', 'getCounter', 'getMovementMode', 'setMovementMode',
  '$me', '$Me',
];

/**
 * Execute a timer's script-mode body.
 */
export async function executeTimerScript(
  body: string,
  activeCharacter: string | null,
  runner: CommandRunner,
  globalScript: string
): Promise<void> {
  const api = buildApi(runner);
  const ch = charNames(activeCharacter);

  const paramValues: unknown[] = [
    api.send, api.echo, delay, api.setVar, api.getVar, api.spam, api.lastUserInputTime,
    api.getSkillCount, api.getSkillLevel, api.getSkillTier, api.getSkillNext, api.getSkillGroup, api.getSkill,
    api.readFile, api.writeFile, api.playSound, api.startTimer, api.stopTimer,
    api.enableTrigger, api.disableTrigger, api.enableAlias, api.disableAlias,
    api.getGameTime, api.getCounter, api.getMovementMode, api.setMovementMode,
    ch.name, ch.cap,
  ];

  try {
    const fn = getOrCompile(TIMER_PARAM_NAMES, body, globalScript);
    await fn(...paramValues);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runner.echo(`\x1b[31m[Script Error] ${msg}\x1b[0m`);
  }
}

// ── Alias param layout (static — never changes) ─────────────────────

const ALIAS_PARAM_NAMES: string[] = [
  'send', 'echo', 'delay', 'setVar', 'getVar', 'spam', 'lastUserInputTime',
  'getSkillCount', 'getSkillLevel', 'getSkillTier', 'getSkillNext', 'getSkillGroup', 'getSkill',
  'readFile', 'writeFile', 'playSound', 'startTimer', 'stopTimer',
  'enableTrigger', 'disableTrigger', 'enableAlias', 'disableAlias',
  'getGameTime', 'getCounter', 'getMovementMode', 'setMovementMode',
  '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9',
  'args', 'argList', '$me', '$Me',
];

/**
 * Execute an alias's script-mode body.
 */
export async function executeAliasScript(
  body: string,
  matchedArgs: string[],
  activeCharacter: string | null,
  runner: CommandRunner,
  globalScript: string
): Promise<void> {
  const api = buildApi(runner);
  const ch = charNames(activeCharacter);

  const paramValues: unknown[] = [
    api.send, api.echo, delay, api.setVar, api.getVar, api.spam, api.lastUserInputTime,
    api.getSkillCount, api.getSkillLevel, api.getSkillTier, api.getSkillNext, api.getSkillGroup, api.getSkill,
    api.readFile, api.writeFile, api.playSound, api.startTimer, api.stopTimer,
    api.enableTrigger, api.disableTrigger, api.enableAlias, api.disableAlias,
    api.getGameTime, api.getCounter, api.getMovementMode, api.setMovementMode,
    matchedArgs[0] ?? '', matchedArgs[1] ?? '', matchedArgs[2] ?? '',
    matchedArgs[3] ?? '', matchedArgs[4] ?? '', matchedArgs[5] ?? '',
    matchedArgs[6] ?? '', matchedArgs[7] ?? '', matchedArgs[8] ?? '',
    matchedArgs.join(' '), [...matchedArgs], ch.name, ch.cap,
  ];

  try {
    const fn = getOrCompile(ALIAS_PARAM_NAMES, body, globalScript);
    await fn(...paramValues);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runner.echo(`\x1b[31m[Script Error] ${msg}\x1b[0m`);
  }
}
