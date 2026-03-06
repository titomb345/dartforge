import type { ActionBlocker } from './actionBlocker';
import type { AutoInscriber } from './autoInscriber';
import type { AutoCaster } from './autoCaster';
import type { AutoConc } from './autoConc';
import { parseConvertCommand, formatMultiConversion } from './currency';
import { getSpellByAbbr, findSpellFuzzy } from './spellData';
import { getSkillByAbbr, findSkillFuzzy } from './skillData';
import { getTierForCount, getImprovesToNextTier } from './skillTiers';
import type { Variable } from '../types/variable';
import type { AnnounceMode } from '../types';
import type { ImproveCounter } from '../types/counter';

/** Shared context passed to all built-in command handlers */
export interface BuiltinContext {
  writeToTerm: (text: string) => void;
  sendCommand: (cmd: string) => Promise<void>;
  sendCommandViaRef: () => Promise<(cmd: string) => Promise<void>>;
  actionBlocker: ActionBlocker;
  actionBlockingEnabled: () => boolean;
  autoInscriber: AutoInscriber;
  autoCaster: AutoCaster;
  autoConc: AutoConc;
  cycleMovementMode: () => void;
  appSettings: {
    announceMode: AnnounceMode;
    announcePetMode: AnnounceMode;
    autoConcAction: string;
    updateAnnounceMode: (m: AnnounceMode) => void;
    updateAnnouncePetMode: (m: AnnounceMode) => void;
    updateAutoConcAction: (a: string) => void;
    updateCasterWeightItem: (v: string) => void;
    updateCasterWeightContainer: (v: string) => void;
    updateCasterWeightAdjustUp: (v: number) => void;
    updateCasterWeightAdjustDown: (v: number) => void;
  };
  mergedVariables: () => Variable[];
  setVar: (name: string, value: string, scope: 'character' | 'global') => void;
  deleteVariableByName: (name: string) => boolean;
  skillData: () => { skills: Record<string, { count: number }> };
  improveCounters: () => {
    counters: ImproveCounter[];
    activeCounterId: string | null;
    periodLengthMinutes: number;
    getElapsedMs: (c: ImproveCounter) => number;
    getPerMinuteRate: (c: ImproveCounter) => number;
    getPerPeriodRate: (c: ImproveCounter) => number;
    getPerHourRate: (c: ImproveCounter) => number;
    getSkillsSorted: (c: ImproveCounter) => Array<{ skill: string; count: number }>;
    setActiveCounterId: (id: string) => void;
  };
  counterValue: () => {
    startCounter: (id: string) => void;
    pauseCounter: (id: string) => void;
    resumeCounter: (id: string) => void;
    stopCounter: (id: string) => void;
    clearCounter: (id: string) => void;
  };
  expandAndExecute: (action: string) => Promise<void>;
}

type Handler = (trimmed: string, ctx: BuiltinContext) => Promise<boolean>;

/** Write cyan info text to the terminal. */
function echo(ctx: BuiltinContext, text: string): void {
  ctx.writeToTerm(`\x1b[36m${text}\x1b[0m\r\n`);
}

/** Write red error text to the terminal. */
function error(ctx: BuiltinContext, text: string): void {
  ctx.writeToTerm(`\x1b[31m${text}\x1b[0m\r\n`);
}

/** Callback suitable for engine .start/.stop/.set* echo parameters. */
function echoFn(ctx: BuiltinContext): (msg: string) => void {
  return (msg) => echo(ctx, msg);
}

const handleBlock: Handler = async (trimmed, ctx) => {
  if (!/^\/block\b/i.test(trimmed)) return false;
  const blocker = ctx.actionBlocker;
  if (blocker.blocked) {
    ctx.writeToTerm(`\x1b[33m[Already blocked: ${blocker.blockLabel}]\x1b[0m\r\n`); // yellow — intentionally different from echo
  } else {
    blocker.block({ key: 'manual', label: 'Manual', pattern: /^$/ });
    ctx.writeToTerm('\x1b[33m[BLOCKED — manual]\x1b[0m\r\n'); // yellow
  }
  return true;
};

const handleUnblock: Handler = async (trimmed, ctx) => {
  if (!/^\/unblock\b/i.test(trimmed)) return false;
  const blocker = ctx.actionBlocker;
  const queued = blocker.forceUnblock();
  ctx.writeToTerm( // green — intentionally different from echo
    `\x1b[32m[UNBLOCKED — ${queued.length} queued command(s) released]\x1b[0m\r\n`
  );
  for (const cmd of queued) {
    await ctx.sendCommand(cmd);
  }
  return true;
};

const handleMovemode: Handler = async (trimmed, ctx) => {
  if (!/^\/movemode\b/i.test(trimmed)) return false;
  ctx.cycleMovementMode();
  return true;
};

const handleAutoinscribe: Handler = async (trimmed, ctx) => {
  if (!/^\/autoinscribe\b/i.test(trimmed)) return false;
  const args = trimmed.slice(14).trim();
  const argsLower = args.toLowerCase();
  const inscriber = ctx.autoInscriber;

  if (argsLower === 'off' || argsLower === 'stop') {
    inscriber.stop(echoFn(ctx));
    return true;
  }

  if (argsLower.startsWith('power ')) {
    const p = parseInt(argsLower.slice(6).trim().replace(/^@/, ''), 10);
    if (isNaN(p) || p < 1) {
      error(ctx, '[Autoinscribe] Usage: /autoinscribe power @<number>');
    } else {
      inscriber.setPower(p, echoFn(ctx));
    }
    return true;
  }

  if (argsLower === 'status') {
    const s = inscriber.getState();
    if (!s.active) {
      echo(ctx, '[Autoinscribe: OFF]');
    } else {
      echo(ctx, `[Autoinscribe: ${s.spell} @${s.power}]`);
      echo(ctx, `  Phase: ${s.phase} | Cycles: ${s.cycleCount}`);
    }
    return true;
  }

  const parts = args.split(/\s+/);
  if (parts.length < 2) {
    error(ctx,
      '[Autoinscribe] Usage:\r\n' +
      '  /autoinscribe <spell> @<power>  Start inscribe loop\r\n' +
      '  /autoinscribe off               Stop inscribing\r\n' +
      '  /autoinscribe status             Show current state\r\n' +
      '  /autoinscribe power @<n>         Adjust power mid-loop'
    );
    return true;
  }

  const spellArg = parts[0];
  const powerRaw = parts[1].replace(/^@/, '');
  const powerArg = parseInt(powerRaw, 10);
  if (isNaN(powerArg) || powerArg < 1) {
    error(ctx, '[Autoinscribe] Power must be a positive number (e.g. @200).');
    return true;
  }

  const spellLookup = getSpellByAbbr(spellArg) ?? findSpellFuzzy(spellArg);
  const displaySpell = spellLookup ? spellLookup.name : spellArg;

  inscriber.start(
    spellArg,
    powerArg,
    async (cmd) => await ctx.sendCommand(cmd),
    (msg) => echo(ctx, msg.replace(spellArg, displaySpell)),
    (key, label) => {
      if (ctx.actionBlockingEnabled()) {
        ctx.actionBlocker.block({ key, label, pattern: /(?!)/ });
      }
    }
  );
  return true;
};

const handleAutocast: Handler = async (trimmed, ctx) => {
  if (!/^\/autocast\b/i.test(trimmed)) return false;
  const args = trimmed.slice(9).trim();
  const argsLower = args.toLowerCase();
  const caster = ctx.autoCaster;

  if (argsLower === 'off' || argsLower === 'stop') {
    caster.stop(echoFn(ctx));
    return true;
  }

  if (argsLower.startsWith('adjust ')) {
    const adjustRest = argsLower.slice(7).trim();

    if (adjustRest.startsWith('power ')) {
      const adjustParts = adjustRest.slice(6).trim().replace(/^@/, '').split(/\s+/);
      if (adjustParts.length === 1) {
        const p = parseInt(adjustParts[0], 10);
        if (isNaN(p) || p < 1) {
          error(ctx, '[Autocast] Usage: /autocast adjust power @<n> | /autocast adjust power <up> <down>');
        } else {
          caster.setPower(p, echoFn(ctx));
        }
      } else {
        const up = parseInt(adjustParts[0], 10);
        const down = parseInt(adjustParts[1], 10);
        if (isNaN(up) || isNaN(down) || up < 1 || down < 1) {
          error(ctx, '[Autocast] Usage: /autocast adjust power @<n> | /autocast adjust power <up> <down>');
        } else {
          caster.setAdjust(up, down, echoFn(ctx));
        }
      }
      return true;
    }

    if (adjustRest.startsWith('weight ')) {
      const adjustParts = adjustRest.slice(7).trim().split(/\s+/);
      if (adjustParts.length === 1) {
        const w = parseInt(adjustParts[0], 10);
        if (isNaN(w) || w < 0) {
          error(ctx, '[Autocast] Usage: /autocast adjust weight <n> | /autocast adjust weight <up> <down>');
        } else {
          caster.setCarriedWeight(w, echoFn(ctx));
        }
      } else {
        const up = parseInt(adjustParts[0], 10);
        const down = parseInt(adjustParts[1], 10);
        if (isNaN(up) || isNaN(down) || up < 1 || down < 1) {
          error(ctx, '[Autocast] Usage: /autocast adjust weight <n> | /autocast adjust weight <up> <down>');
        } else {
          caster.setWeightAdjust(up, down, echoFn(ctx));
          ctx.appSettings.updateCasterWeightAdjustUp(up);
          ctx.appSettings.updateCasterWeightAdjustDown(down);
        }
      }
      return true;
    }

    error(ctx, '[Autocast] Usage:\r\n  /autocast adjust power @<n>\r\n  /autocast adjust power <up> <down>\r\n  /autocast adjust weight <n>\r\n  /autocast adjust weight <up> <down>');
    return true;
  }

  if (argsLower.startsWith('set ')) {
    const setRest = args.slice(4).trim();
    const setRestLower = setRest.toLowerCase();

    if (setRestLower.startsWith('item ')) {
      const itemName = setRest.slice(5).trim();
      if (!itemName) {
        error(ctx, '[Autocast] Usage: /autocast set item <item>');
      } else {
        caster.setWeightItem(itemName, echoFn(ctx));
        ctx.appSettings.updateCasterWeightItem(itemName);
      }
      return true;
    }

    if (setRestLower.startsWith('container ')) {
      const containerName = setRest.slice(10).trim();
      if (!containerName) {
        error(ctx, '[Autocast] Usage: /autocast set container <name> | /autocast clear container\r\n  Use "none" or "clear" to remove the container.');
      } else {
        const val = /^(none|null|clear)$/i.test(containerName) ? null : containerName;
        caster.setWeightContainer(val, echoFn(ctx));
        ctx.appSettings.updateCasterWeightContainer(val ?? '');
      }
      return true;
    }

    error(ctx, '[Autocast] Usage:\r\n  /autocast set item <item>\r\n  /autocast set container <name>');
    return true;
  }

  if (argsLower === 'clear container') {
    caster.setWeightContainer(null, echoFn(ctx));
    ctx.appSettings.updateCasterWeightContainer('');
    return true;
  }

  if (argsLower === 'status') {
    const s = caster.getState();
    if (!s.active) {
      echo(ctx, '[Autocast: OFF]');
      echo(ctx, `  Power adjust: +${s.adjustUp} on fail / -${s.adjustDown} on success`);
      if (s.weightItem) {
        const loc = s.weightContainer ? ` from ${s.weightContainer}` : '';
        echo(ctx, `  Weight item:  ${s.weightItem}${loc}`);
        echo(ctx, `  Weight adjust: take ${s.weightAdjustUp} on success, put ${s.weightAdjustDown} on fail`);
      } else {
        echo(ctx, '  Weight: not configured');
      }
    } else {
      const argsStr = s.args ? ` ${s.args}` : '';
      echo(ctx, `[Autocast: ${s.spell} @${s.power}${argsStr}]`);
      echo(ctx, `  Phase: ${s.phase} | Cycles: ${s.cycleCount} | Success: ${s.successCount} | Fail: ${s.failCount}`);
      echo(ctx, `  Power adjust: +${s.adjustUp} on fail / -${s.adjustDown} on success`);
      if (s.weightMode) {
        echo(ctx, `  WEIGHT MODE: carrying ${s.carriedWeight} ${s.weightItem}`);
      }
      if (s.weightItem) {
        const loc = s.weightContainer ? ` from ${s.weightContainer}` : '';
        echo(ctx, `  Weight item:  ${s.weightItem}${loc}`);
        echo(ctx, `  Weight adjust: take ${s.weightAdjustUp} on success, put ${s.weightAdjustDown} on fail`);
      }
    }
    return true;
  }

  const parts = args.split(/\s+/);
  if (parts.length < 2) {
    error(ctx,
      '[Autocast] Usage:\r\n' +
      '  /autocast <spell> @<power> [args]   Start casting\r\n' +
      '  /autocast off                       Stop casting\r\n' +
      '  /autocast status                    Show current state\r\n' +
      '  /autocast adjust power @<n>         Set power directly\r\n' +
      '  /autocast adjust power <up> <down>  Set power adjust steps\r\n' +
      '  /autocast adjust weight <n>         Set carried weight\r\n' +
      '  /autocast adjust weight <up> <down> Set weight adjust steps\r\n' +
      '  /autocast set item <item>        Set weight item\r\n' +
      '  /autocast set container <name>      Set weight container\r\n' +
      '  /autocast clear container            Clear container (ground)'
    );
    return true;
  }

  const spellArg = parts[0];
  const powerRaw = parts[1].replace(/^@/, '');
  const powerArg = parseInt(powerRaw, 10);
  if (isNaN(powerArg) || powerArg < 1) {
    error(ctx, '[Autocast] Power must be a positive number (e.g. @200).');
    return true;
  }

  const extraArgs = parts.slice(2).join(' ') || null;
  const spellLookup = getSpellByAbbr(spellArg) ?? findSpellFuzzy(spellArg);
  const displaySpell = spellLookup ? spellLookup.name : spellArg;

  const sendViaRef = await ctx.sendCommandViaRef();
  caster.start(
    spellArg,
    powerArg,
    extraArgs,
    async (cmd) => await ctx.sendCommand(cmd),
    (msg) => echo(ctx, msg.replace(spellArg, displaySpell)),
    (key, label) => {
      if (ctx.actionBlockingEnabled()) {
        ctx.actionBlocker.block({ key, label, pattern: /(?!)/ });
      }
    },
    async (cmd) => await sendViaRef(cmd)
  );
  return true;
};

const handleAutoconc: Handler = async (trimmed, ctx) => {
  if (!/^\/autoconc\b/i.test(trimmed)) return false;
  const args = trimmed.slice(9).trim();
  const argsLower = args.toLowerCase();
  const conc = ctx.autoConc;

  if (argsLower === 'off' || argsLower === 'stop') {
    conc.stop(echoFn(ctx));
    return true;
  }

  if (argsLower === 'status') {
    const s = conc.getState();
    if (!s.active) {
      echo(ctx, `[Autoconc: OFF${s.action ? ` | Action: ${s.action}` : ''}]`);
    } else {
      echo(ctx, `[Autoconc: ${s.action}]`);
      echo(ctx, `  Phase: ${s.phase} | Cycles: ${s.cycleCount}`);
    }
    return true;
  }

  if (argsLower === 'on' || argsLower === 'start') {
    const saved = conc.action || ctx.appSettings.autoConcAction;
    if (!saved) {
      error(ctx, '[Autoconc] No action set. Use /autoconc <action> to set one first.');
    } else {
      conc.start(
        saved,
        async (cmd) => await ctx.sendCommand(cmd),
        async (action) => await ctx.expandAndExecute(action),
        echoFn(ctx)
      );
    }
    return true;
  }

  if (!args) {
    error(ctx,
      '[Autoconc] Usage:\r\n' +
      '  /autoconc <action>    Set action (does not start)\r\n' +
      '  /autoconc on          Start with saved action\r\n' +
      '  /autoconc off         Stop the loop\r\n' +
      '  /autoconc status      Show current state'
    );
    return true;
  }

  conc.setAction(args);
  ctx.appSettings.updateAutoConcAction(args);
  const verb = conc.active ? 'updated' : 'set';
  echo(ctx, `[Autoconc: action ${verb} to "${args}"]`);
  return true;
};

const VALID_ANNOUNCE_MODES = ['on', 'off', 'brief', 'verbose'] as const;
const isValidAnnounceMode = (s: string): s is AnnounceMode =>
  (VALID_ANNOUNCE_MODES as readonly string[]).includes(s);

const handleAnnounce: Handler = async (trimmed, ctx) => {
  if (!/^\/announce\b/i.test(trimmed)) return false;
  const args = trimmed.slice(9).trim().toLowerCase();

  if (!args || args === 'status') {
    echo(ctx, `[Announce: ${ctx.appSettings.announceMode} | Pets: ${ctx.appSettings.announcePetMode}]`);
    return true;
  }

  if (args.startsWith('pet ')) {
    const petArg = args.slice(4).trim();
    if (isValidAnnounceMode(petArg)) {
      ctx.appSettings.updateAnnouncePetMode(petArg);
      echo(ctx, `[Announce pets: ${petArg}]`);
    } else {
      error(ctx, '[Announce] Usage: /announce pet on|off|brief|verbose');
    }
    return true;
  }

  if (isValidAnnounceMode(args)) {
    ctx.appSettings.updateAnnounceMode(args);
    echo(ctx, `[Announce: ${args}]`);
    return true;
  }

  error(ctx, '[Announce] Usage: /announce on|off|brief|verbose | /announce pet on|off|brief|verbose | /announce status');
  return true;
};

const handleConvert: Handler = async (trimmed, ctx) => {
  if (!/^\/convert\b/i.test(trimmed)) return false;
  const parsed = parseConvertCommand(trimmed);
  if (typeof parsed === 'string') {
    error(ctx, `[Convert] ${parsed}`);
  } else {
    ctx.writeToTerm(`${formatMultiConversion(parsed)}\r\n`);
  }
  return true;
};

const handleVar: Handler = async (trimmed, ctx) => {
  if (!/^\/var\b/i.test(trimmed)) return false;
  const varInput = trimmed.slice(4).trim();
  if (!varInput) {
    const vars = ctx.mergedVariables().filter((v) => v.enabled);
    if (vars.length === 0) {
      echo(ctx, 'No variables set.');
    } else {
      echo(ctx, '--- Variables ---');
      for (const v of vars) {
        echo(ctx, `  $${v.name} = ${v.value}`);
      }
    }
  } else if (varInput.startsWith('-d ')) {
    const name = varInput.slice(3).trim();
    if (ctx.deleteVariableByName(name)) {
      echo(ctx, `Deleted variable $${name}`);
    } else {
      error(ctx, `[Var] Variable "$${name}" not found.`);
    }
  } else {
    let scope: 'character' | 'global' = 'character';
    let rest = varInput;
    if (rest.startsWith('-g ')) {
      scope = 'global';
      rest = rest.slice(3).trim();
    }
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) {
      const query = rest;
      let re: RegExp;
      try {
        re = new RegExp(query, 'i');
      } catch {
        re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      const matches = ctx.mergedVariables().filter(
        (v) => v.enabled && re.test(v.name)
      );
      if (matches.length === 0) {
        echo(ctx, `No variables matching "${query}".`);
      } else {
        echo(ctx, `--- Variables matching "${query}" ---`);
        for (const v of matches) {
          echo(ctx, `  $${v.name} = ${v.value}`);
        }
      }
    } else {
      const name = rest.slice(0, spaceIdx);
      const value = rest.slice(spaceIdx + 1);
      ctx.setVar(name, value, scope);
      echo(ctx, `$${name} = ${value} (${scope})`);
    }
  }
  return true;
};

const handleApt: Handler = async (trimmed, ctx) => {
  if (!/^\/apt\b/i.test(trimmed)) return false;
  const arg = trimmed.slice(4).trim();
  if (!arg) {
    error(ctx, '[Apt] Usage: /apt <abbreviation or name>');
    return true;
  }
  const spell = getSpellByAbbr(arg) ?? findSpellFuzzy(arg);
  const skill = !spell ? (getSkillByAbbr(arg) ?? findSkillFuzzy(arg)) : null;
  const resolved = spell ? spell.name : skill ?? arg;
  echo(ctx, `[Aptitude: ${resolved}]`);
  await ctx.sendCommand(`show aptitude:${resolved}`);
  return true;
};

const handleSkill: Handler = async (trimmed, ctx) => {
  if (!/^\/skill\b/i.test(trimmed)) return false;
  const arg = trimmed.slice(6).trim();
  if (!arg) {
    error(ctx, '[Skill] Usage: /skill <abbreviation or name>');
    return true;
  }
  const skill = getSkillByAbbr(arg) ?? findSkillFuzzy(arg);
  const spell = !skill ? (getSpellByAbbr(arg) ?? findSpellFuzzy(arg)) : null;
  const resolved = skill ?? (spell ? spell.name : arg);
  const known = !!(skill || spell);
  if (known) {
    const rec = ctx.skillData().skills[resolved];
    if (rec) {
      const tier = getTierForCount(rec.count);
      const toNext = getImprovesToNextTier(rec.count);
      const nextStr = toNext > 0 ? ` | next: ${toNext}` : '';
      echo(ctx, `[Skill: ${resolved} | count: ${rec.count} | level: ${tier.name}${nextStr}]`);
    } else {
      echo(ctx, `[Skill: ${resolved} | no data tracked]`);
    }
  } else {
    echo(ctx, '[Skill: unknown]');
  }
  await ctx.sendCommand(`show skills ${resolved}`);
  return true;
};

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

function statusIcon(st: string): string {
  return st === 'running' ? '\x1b[32m●\x1b[36m' : st === 'paused' ? '\x1b[33m❚❚\x1b[36m' : '\x1b[90m■\x1b[36m';
}

const handleCounter: Handler = async (trimmed, ctx) => {
  if (!/^\/counter\b/i.test(trimmed)) return false;
  const args = trimmed.slice(8).trim();
  const argsLower = args.toLowerCase();
  const ic = ctx.improveCounters();
  const cv = ctx.counterValue();
  const { counters, activeCounterId, getElapsedMs, getPerMinuteRate, getPerPeriodRate, getPerHourRate, getSkillsSorted, periodLengthMinutes } = ic;

  /** Find the active counter or show an error. */
  const requireActive = (): ImproveCounter | null => {
    const ac = counters.find((c) => c.id === activeCounterId);
    if (!ac) error(ctx, '[Counter] No active counter.');
    return ac ?? null;
  };

  if (argsLower === 'list') {
    if (counters.length === 0) {
      error(ctx, '[Counter] No counters created.');
    } else {
      let out = '\x1b[36m[Counters]\r\n';
      for (const c of counters) {
        const active = c.id === activeCounterId ? ' \x1b[33m*\x1b[36m' : '';
        out += `  ${statusIcon(c.status)} ${c.name}${active}  ${c.status}  ${c.totalImps} imps  ${fmtDur(getElapsedMs(c))}\r\n`;
      }
      ctx.writeToTerm(`${out}\x1b[0m`);
    }
    return true;
  }

  if (argsLower === 'status') {
    const ac = requireActive();
    if (!ac) return true;
    const perMin = getPerMinuteRate(ac).toFixed(2);
    const perHr = getPerHourRate(ac).toFixed(1);
    echo(ctx, `[${statusIcon(ac.status)} ${ac.name}]  ${ac.status}  ${ac.totalImps} imps  ${fmtDur(getElapsedMs(ac))}  ${perMin}/min  ${perHr}/hr`);
    return true;
  }

  if (argsLower === 'info') {
    const ac = requireActive();
    if (!ac) return true;
    const skills = getSkillsSorted(ac);
    const skillStr = skills.length > 0
      ? skills.map((s) => `${s.skill} (${s.count})`).join(', ')
      : 'none';
    const perMin = getPerMinuteRate(ac).toFixed(2);
    const perPer = getPerPeriodRate(ac).toFixed(1);
    const perHr = getPerHourRate(ac).toFixed(1);
    let out = `\x1b[36m[Counter "${ac.name}"]\r\n`;
    out += `  Status:   ${ac.status}\r\n`;
    out += `  Imps:     ${ac.totalImps}\r\n`;
    out += `  Elapsed:  ${fmtDur(getElapsedMs(ac))}\r\n`;
    out += `  Rate:     ${perMin}/min  |  ${perPer}/${periodLengthMinutes}m  |  ${perHr}/hr\r\n`;
    out += `  Skills:   ${skillStr}\r\n`;
    if (ac.startedAt) out += `  Started:  ${ac.startedAt}\r\n`;
    ctx.writeToTerm(`${out}\x1b[0m`);
    return true;
  }

  if (argsLower === 'start') {
    const ac = requireActive();
    if (!ac) return true;
    if (ac.status === 'running') { echo(ctx, `[Counter "${ac.name}" already running]`); return true; }
    if (ac.status === 'paused') cv.resumeCounter(ac.id);
    else cv.startCounter(ac.id);
    return true;
  }

  if (argsLower === 'toggle') {
    const ac = requireActive();
    if (!ac) return true;
    if (ac.status === 'running') cv.pauseCounter(ac.id);
    else if (ac.status === 'paused') cv.resumeCounter(ac.id);
    else cv.startCounter(ac.id);
    return true;
  }

  if (argsLower === 'pause') {
    const ac = requireActive();
    if (!ac) return true;
    if (ac.status !== 'running') { echo(ctx, `[Counter "${ac.name}" not running]`); return true; }
    cv.pauseCounter(ac.id);
    return true;
  }

  if (argsLower === 'stop') {
    const ac = requireActive();
    if (!ac) return true;
    if (ac.status === 'stopped') { echo(ctx, `[Counter "${ac.name}" already stopped]`); return true; }
    cv.stopCounter(ac.id);
    return true;
  }

  if (argsLower === 'clear') {
    const ac = requireActive();
    if (!ac) return true;
    cv.clearCounter(ac.id);
    return true;
  }

  if (argsLower.startsWith('switch ')) {
    const name = args.slice(7).trim();
    if (!name) { error(ctx, '[Counter] Usage: /counter switch <name>'); return true; }
    const nameLower = name.toLowerCase();
    const match = counters.find((c) => c.name.toLowerCase() === nameLower)
      ?? counters.find((c) => c.name.toLowerCase().includes(nameLower));
    if (!match) {
      error(ctx, `[Counter] No counter matching "${name}".`);
    } else {
      ic.setActiveCounterId(match.id);
      echo(ctx, `[Counter switched to "${match.name}"]`);
    }
    return true;
  }

  error(ctx,
    '[Counter] Usage:\r\n' +
    '  /counter list            List all counters\r\n' +
    '  /counter status          Active counter one-liner\r\n' +
    '  /counter info            Detailed stats for active counter\r\n' +
    '  /counter start           Start/resume active counter\r\n' +
    '  /counter toggle          Toggle start/pause\r\n' +
    '  /counter pause           Pause active counter\r\n' +
    '  /counter stop            Stop active counter\r\n' +
    '  /counter clear           Clear active counter\r\n' +
    '  /counter switch <name>   Switch active counter by name'
  );
  return true;
};

/** Ordered list of built-in command handlers. Returns true if command was handled. */
const BUILTIN_HANDLERS: Handler[] = [
  handleBlock,
  handleUnblock,
  handleMovemode,
  handleAutoinscribe,
  handleAutocast,
  handleAutoconc,
  handleAnnounce,
  handleConvert,
  handleVar,
  handleApt,
  handleSkill,
  handleCounter,
];

/**
 * Try to dispatch a built-in slash command.
 * Returns true if the command was handled, false if it should fall through to alias expansion.
 */
export async function dispatchBuiltinCommand(
  trimmed: string,
  ctx: BuiltinContext
): Promise<boolean> {
  if (!trimmed.startsWith('/')) return false;
  for (const handler of BUILTIN_HANDLERS) {
    if (await handler(trimmed, ctx)) return true;
  }
  return false;
}
