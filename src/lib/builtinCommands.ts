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

const handleBlock: Handler = async (trimmed, ctx) => {
  if (!/^\/block\b/i.test(trimmed)) return false;
  const blocker = ctx.actionBlocker;
  if (blocker.blocked) {
    ctx.writeToTerm(`\x1b[33m[Already blocked: ${blocker.blockLabel}]\x1b[0m\r\n`);
  } else {
    blocker.block({ key: 'manual', label: 'Manual', pattern: /^$/ });
    ctx.writeToTerm('\x1b[33m[BLOCKED — manual]\x1b[0m\r\n');
  }
  return true;
};

const handleUnblock: Handler = async (trimmed, ctx) => {
  if (!/^\/unblock\b/i.test(trimmed)) return false;
  const blocker = ctx.actionBlocker;
  const queued = blocker.forceUnblock();
  ctx.writeToTerm(
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
    inscriber.stop((msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
    return true;
  }

  if (argsLower.startsWith('power ')) {
    const p = parseInt(argsLower.slice(6).trim().replace(/^@/, ''), 10);
    if (isNaN(p) || p < 1) {
      ctx.writeToTerm('\x1b[31m[Autoinscribe] Usage: /autoinscribe power @<number>\x1b[0m\r\n');
    } else {
      inscriber.setPower(p, (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
    }
    return true;
  }

  if (argsLower === 'status') {
    const s = inscriber.getState();
    const line = (text: string) => ctx.writeToTerm(`\x1b[36m${text}\x1b[0m\r\n`);
    if (!s.active) {
      line('[Autoinscribe: OFF]');
    } else {
      line(`[Autoinscribe: ${s.spell} @${s.power}]`);
      line(`  Phase: ${s.phase} | Cycles: ${s.cycleCount}`);
    }
    return true;
  }

  const parts = args.split(/\s+/);
  if (parts.length < 2) {
    ctx.writeToTerm(
      '\x1b[31m[Autoinscribe] Usage:\r\n' +
      '  /autoinscribe <spell> @<power>  Start inscribe loop\r\n' +
      '  /autoinscribe off               Stop inscribing\r\n' +
      '  /autoinscribe status             Show current state\r\n' +
      '  /autoinscribe power @<n>         Adjust power mid-loop\x1b[0m\r\n'
    );
    return true;
  }

  const spellArg = parts[0];
  const powerRaw = parts[1].replace(/^@/, '');
  const powerArg = parseInt(powerRaw, 10);
  if (isNaN(powerArg) || powerArg < 1) {
    ctx.writeToTerm('\x1b[31m[Autoinscribe] Power must be a positive number (e.g. @200).\x1b[0m\r\n');
    return true;
  }

  const spellLookup = getSpellByAbbr(spellArg) ?? findSpellFuzzy(spellArg);
  const displaySpell = spellLookup ? spellLookup.name : spellArg;

  inscriber.start(
    spellArg,
    powerArg,
    async (cmd) => await ctx.sendCommand(cmd),
    (msg) => ctx.writeToTerm(`\x1b[36m${msg.replace(spellArg, displaySpell)}\x1b[0m\r\n`),
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
    caster.stop((msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
    return true;
  }

  if (argsLower.startsWith('adjust ')) {
    const adjustRest = argsLower.slice(7).trim();

    if (adjustRest.startsWith('power ')) {
      const adjustParts = adjustRest.slice(6).trim().replace(/^@/, '').split(/\s+/);
      if (adjustParts.length === 1) {
        const p = parseInt(adjustParts[0], 10);
        if (isNaN(p) || p < 1) {
          ctx.writeToTerm('\x1b[31m[Autocast] Usage: /autocast adjust power @<n> | /autocast adjust power <up> <down>\x1b[0m\r\n');
        } else {
          caster.setPower(p, (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
        }
      } else {
        const up = parseInt(adjustParts[0], 10);
        const down = parseInt(adjustParts[1], 10);
        if (isNaN(up) || isNaN(down) || up < 1 || down < 1) {
          ctx.writeToTerm('\x1b[31m[Autocast] Usage: /autocast adjust power @<n> | /autocast adjust power <up> <down>\x1b[0m\r\n');
        } else {
          caster.setAdjust(up, down, (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
        }
      }
      return true;
    }

    if (adjustRest.startsWith('weight ')) {
      const adjustParts = adjustRest.slice(7).trim().split(/\s+/);
      if (adjustParts.length === 1) {
        const w = parseInt(adjustParts[0], 10);
        if (isNaN(w) || w < 0) {
          ctx.writeToTerm('\x1b[31m[Autocast] Usage: /autocast adjust weight <n> | /autocast adjust weight <up> <down>\x1b[0m\r\n');
        } else {
          caster.setCarriedWeight(w, (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
        }
      } else {
        const up = parseInt(adjustParts[0], 10);
        const down = parseInt(adjustParts[1], 10);
        if (isNaN(up) || isNaN(down) || up < 1 || down < 1) {
          ctx.writeToTerm('\x1b[31m[Autocast] Usage: /autocast adjust weight <n> | /autocast adjust weight <up> <down>\x1b[0m\r\n');
        } else {
          caster.setWeightAdjust(up, down, (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
          ctx.appSettings.updateCasterWeightAdjustUp(up);
          ctx.appSettings.updateCasterWeightAdjustDown(down);
        }
      }
      return true;
    }

    ctx.writeToTerm(
      '\x1b[31m[Autocast] Usage:\r\n  /autocast adjust power @<n>\r\n  /autocast adjust power <up> <down>\r\n  /autocast adjust weight <n>\r\n  /autocast adjust weight <up> <down>\x1b[0m\r\n'
    );
    return true;
  }

  if (argsLower.startsWith('set ')) {
    const setRest = args.slice(4).trim();
    const setRestLower = setRest.toLowerCase();

    if (setRestLower.startsWith('item ')) {
      const itemName = setRest.slice(5).trim();
      if (!itemName) {
        ctx.writeToTerm('\x1b[31m[Autocast] Usage: /autocast set item <item>\x1b[0m\r\n');
      } else {
        caster.setWeightItem(itemName, (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
        ctx.appSettings.updateCasterWeightItem(itemName);
      }
      return true;
    }

    if (setRestLower.startsWith('container ')) {
      const containerName = setRest.slice(10).trim();
      if (!containerName) {
        ctx.writeToTerm('\x1b[31m[Autocast] Usage: /autocast set container <name> | /autocast clear container\r\n  Use "none" or "clear" to remove the container.\x1b[0m\r\n');
      } else {
        const val = /^(none|null|clear)$/i.test(containerName) ? null : containerName;
        caster.setWeightContainer(
          val,
          (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`)
        );
        ctx.appSettings.updateCasterWeightContainer(val ?? '');
      }
      return true;
    }

    ctx.writeToTerm(
      '\x1b[31m[Autocast] Usage:\r\n  /autocast set item <item>\r\n  /autocast set container <name>\x1b[0m\r\n'
    );
    return true;
  }

  if (argsLower === 'clear container') {
    caster.setWeightContainer(null, (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
    ctx.appSettings.updateCasterWeightContainer('');
    return true;
  }

  if (argsLower === 'status') {
    const s = caster.getState();
    const line = (text: string) => ctx.writeToTerm(`\x1b[36m${text}\x1b[0m\r\n`);

    if (!s.active) {
      line('[Autocast: OFF]');
      line(`  Power adjust: +${s.adjustUp} on fail / -${s.adjustDown} on success`);
      if (s.weightItem) {
        const loc = s.weightContainer ? ` from ${s.weightContainer}` : '';
        line(`  Weight item:  ${s.weightItem}${loc}`);
        line(`  Weight adjust: take ${s.weightAdjustUp} on success, put ${s.weightAdjustDown} on fail`);
      } else {
        line('  Weight: not configured');
      }
    } else {
      const argsStr = s.args ? ` ${s.args}` : '';
      line(`[Autocast: ${s.spell} @${s.power}${argsStr}]`);
      line(`  Phase: ${s.phase} | Cycles: ${s.cycleCount} | Success: ${s.successCount} | Fail: ${s.failCount}`);
      line(`  Power adjust: +${s.adjustUp} on fail / -${s.adjustDown} on success`);
      if (s.weightMode) {
        line(`  WEIGHT MODE: carrying ${s.carriedWeight} ${s.weightItem}`);
      }
      if (s.weightItem) {
        const loc = s.weightContainer ? ` from ${s.weightContainer}` : '';
        line(`  Weight item:  ${s.weightItem}${loc}`);
        line(`  Weight adjust: take ${s.weightAdjustUp} on success, put ${s.weightAdjustDown} on fail`);
      }
    }
    return true;
  }

  const parts = args.split(/\s+/);
  if (parts.length < 2) {
    ctx.writeToTerm(
      '\x1b[31m[Autocast] Usage:\r\n' +
      '  /autocast <spell> @<power> [args]   Start casting\r\n' +
      '  /autocast off                       Stop casting\r\n' +
      '  /autocast status                    Show current state\r\n' +
      '  /autocast adjust power @<n>         Set power directly\r\n' +
      '  /autocast adjust power <up> <down>  Set power adjust steps\r\n' +
      '  /autocast adjust weight <n>         Set carried weight\r\n' +
      '  /autocast adjust weight <up> <down> Set weight adjust steps\r\n' +
      '  /autocast set item <item>        Set weight item\r\n' +
      '  /autocast set container <name>      Set weight container\r\n' +
      '  /autocast clear container            Clear container (ground)\x1b[0m\r\n'
    );
    return true;
  }

  const spellArg = parts[0];
  const powerRaw = parts[1].replace(/^@/, '');
  const powerArg = parseInt(powerRaw, 10);
  if (isNaN(powerArg) || powerArg < 1) {
    ctx.writeToTerm('\x1b[31m[Autocast] Power must be a positive number (e.g. @200).\x1b[0m\r\n');
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
    (msg) => ctx.writeToTerm(`\x1b[36m${msg.replace(spellArg, displaySpell)}\x1b[0m\r\n`),
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
    conc.stop((msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`));
    return true;
  }

  if (argsLower === 'status') {
    const s = conc.getState();
    const line = (text: string) => ctx.writeToTerm(`\x1b[36m${text}\x1b[0m\r\n`);
    if (!s.active) {
      line(`[Autoconc: OFF${s.action ? ` | Action: ${s.action}` : ''}]`);
    } else {
      line(`[Autoconc: ${s.action}]`);
      line(`  Phase: ${s.phase} | Cycles: ${s.cycleCount}`);
    }
    return true;
  }

  if (argsLower === 'on' || argsLower === 'start') {
    const saved = conc.action || ctx.appSettings.autoConcAction;
    if (!saved) {
      ctx.writeToTerm(
        '\x1b[31m[Autoconc] No action set. Use /autoconc <action> to set one first.\x1b[0m\r\n'
      );
    } else {
      conc.start(
        saved,
        async (cmd) => await ctx.sendCommand(cmd),
        async (action) => await ctx.expandAndExecute(action),
        (msg) => ctx.writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`)
      );
    }
    return true;
  }

  if (!args) {
    ctx.writeToTerm(
      '\x1b[31m[Autoconc] Usage:\r\n' +
      '  /autoconc <action>    Set action (does not start)\r\n' +
      '  /autoconc on          Start with saved action\r\n' +
      '  /autoconc off         Stop the loop\r\n' +
      '  /autoconc status      Show current state\x1b[0m\r\n'
    );
    return true;
  }

  conc.setAction(args);
  ctx.appSettings.updateAutoConcAction(args);
  const verb = conc.active ? 'updated' : 'set';
  ctx.writeToTerm(`\x1b[36m[Autoconc: action ${verb} to "${args}"]\x1b[0m\r\n`);
  return true;
};

const VALID_ANNOUNCE_MODES = ['on', 'off', 'brief', 'verbose'] as const;
const isValidAnnounceMode = (s: string): s is AnnounceMode =>
  (VALID_ANNOUNCE_MODES as readonly string[]).includes(s);

const handleAnnounce: Handler = async (trimmed, ctx) => {
  if (!/^\/announce\b/i.test(trimmed)) return false;
  const args = trimmed.slice(9).trim().toLowerCase();

  if (!args || args === 'status') {
    ctx.writeToTerm(
      `\x1b[36m[Announce: ${ctx.appSettings.announceMode} | Pets: ${ctx.appSettings.announcePetMode}]\x1b[0m\r\n`
    );
    return true;
  }

  if (args.startsWith('pet ')) {
    const petArg = args.slice(4).trim();
    if (isValidAnnounceMode(petArg)) {
      ctx.appSettings.updateAnnouncePetMode(petArg);
      ctx.writeToTerm(`\x1b[36m[Announce pets: ${petArg}]\x1b[0m\r\n`);
    } else {
      ctx.writeToTerm('\x1b[31m[Announce] Usage: /announce pet on|off|brief|verbose\x1b[0m\r\n');
    }
    return true;
  }

  if (isValidAnnounceMode(args)) {
    ctx.appSettings.updateAnnounceMode(args);
    ctx.writeToTerm(`\x1b[36m[Announce: ${args}]\x1b[0m\r\n`);
    return true;
  }

  ctx.writeToTerm(
    '\x1b[31m[Announce] Usage: /announce on|off|brief|verbose | /announce pet on|off|brief|verbose | /announce status\x1b[0m\r\n'
  );
  return true;
};

const handleConvert: Handler = async (trimmed, ctx) => {
  if (!/^\/convert\b/i.test(trimmed)) return false;
  const parsed = parseConvertCommand(trimmed);
  if (typeof parsed === 'string') {
    ctx.writeToTerm(`\x1b[31m[Convert] ${parsed}\x1b[0m\r\n`);
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
      ctx.writeToTerm('\x1b[36mNo variables set.\x1b[0m\r\n');
    } else {
      ctx.writeToTerm('\x1b[36m--- Variables ---\x1b[0m\r\n');
      for (const v of vars) {
        ctx.writeToTerm(`\x1b[36m  $${v.name} = ${v.value}\x1b[0m\r\n`);
      }
    }
  } else if (varInput.startsWith('-d ')) {
    const name = varInput.slice(3).trim();
    if (ctx.deleteVariableByName(name)) {
      ctx.writeToTerm(`\x1b[36mDeleted variable $${name}\x1b[0m\r\n`);
    } else {
      ctx.writeToTerm(`\x1b[31m[Var] Variable "$${name}" not found.\x1b[0m\r\n`);
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
        ctx.writeToTerm(`\x1b[36mNo variables matching "${query}".\x1b[0m\r\n`);
      } else {
        ctx.writeToTerm(`\x1b[36m--- Variables matching "${query}" ---\x1b[0m\r\n`);
        for (const v of matches) {
          ctx.writeToTerm(`\x1b[36m  $${v.name} = ${v.value}\x1b[0m\r\n`);
        }
      }
    } else {
      const name = rest.slice(0, spaceIdx);
      const value = rest.slice(spaceIdx + 1);
      ctx.setVar(name, value, scope);
      ctx.writeToTerm(`\x1b[36m$${name} = ${value} (${scope})\x1b[0m\r\n`);
    }
  }
  return true;
};

const handleApt: Handler = async (trimmed, ctx) => {
  if (!/^\/apt\b/i.test(trimmed)) return false;
  const arg = trimmed.slice(4).trim();
  if (!arg) {
    ctx.writeToTerm('\x1b[31m[Apt] Usage: /apt <abbreviation or name>\x1b[0m\r\n');
    return true;
  }
  const spell = getSpellByAbbr(arg) ?? findSpellFuzzy(arg);
  const skill = !spell ? (getSkillByAbbr(arg) ?? findSkillFuzzy(arg)) : null;
  const resolved = spell ? spell.name : skill ?? arg;
  ctx.writeToTerm(`\x1b[36m[Aptitude: ${resolved}]\x1b[0m\r\n`);
  await ctx.sendCommand(`show aptitude:${resolved}`);
  return true;
};

const handleSkill: Handler = async (trimmed, ctx) => {
  if (!/^\/skill\b/i.test(trimmed)) return false;
  const arg = trimmed.slice(6).trim();
  if (!arg) {
    ctx.writeToTerm('\x1b[31m[Skill] Usage: /skill <abbreviation or name>\x1b[0m\r\n');
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
      ctx.writeToTerm(
        `\x1b[36m[Skill: ${resolved} | count: ${rec.count} | level: ${tier.name}${nextStr}]\x1b[0m\r\n`
      );
    } else {
      ctx.writeToTerm(`\x1b[36m[Skill: ${resolved} | no data tracked]\x1b[0m\r\n`);
    }
  } else {
    ctx.writeToTerm(`\x1b[36m[Skill: unknown]\x1b[0m\r\n`);
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

  if (argsLower === 'list') {
    if (counters.length === 0) {
      ctx.writeToTerm('\x1b[31m[Counter] No counters created.\x1b[0m\r\n');
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
    const ac = counters.find((c) => c.id === activeCounterId);
    if (!ac) { ctx.writeToTerm('\x1b[31m[Counter] No active counter.\x1b[0m\r\n'); return true; }
    const perMin = getPerMinuteRate(ac).toFixed(2);
    const perHr = getPerHourRate(ac).toFixed(1);
    ctx.writeToTerm(`\x1b[36m[${statusIcon(ac.status)} ${ac.name}]  ${ac.status}  ${ac.totalImps} imps  ${fmtDur(getElapsedMs(ac))}  ${perMin}/min  ${perHr}/hr\x1b[0m\r\n`);
    return true;
  }

  if (argsLower === 'info') {
    const ac = counters.find((c) => c.id === activeCounterId);
    if (!ac) { ctx.writeToTerm('\x1b[31m[Counter] No active counter.\x1b[0m\r\n'); return true; }
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
    const ac = counters.find((c) => c.id === activeCounterId);
    if (!ac) { ctx.writeToTerm('\x1b[31m[Counter] No active counter.\x1b[0m\r\n'); return true; }
    if (ac.status === 'running') { ctx.writeToTerm(`\x1b[36m[Counter "${ac.name}" already running]\x1b[0m\r\n`); return true; }
    if (ac.status === 'paused') cv.resumeCounter(ac.id);
    else cv.startCounter(ac.id);
    return true;
  }

  if (argsLower === 'toggle') {
    const ac = counters.find((c) => c.id === activeCounterId);
    if (!ac) { ctx.writeToTerm('\x1b[31m[Counter] No active counter.\x1b[0m\r\n'); return true; }
    if (ac.status === 'running') cv.pauseCounter(ac.id);
    else if (ac.status === 'paused') cv.resumeCounter(ac.id);
    else cv.startCounter(ac.id);
    return true;
  }

  if (argsLower === 'pause') {
    const ac = counters.find((c) => c.id === activeCounterId);
    if (!ac) { ctx.writeToTerm('\x1b[31m[Counter] No active counter.\x1b[0m\r\n'); return true; }
    if (ac.status !== 'running') { ctx.writeToTerm(`\x1b[36m[Counter "${ac.name}" not running]\x1b[0m\r\n`); return true; }
    cv.pauseCounter(ac.id);
    return true;
  }

  if (argsLower === 'stop') {
    const ac = counters.find((c) => c.id === activeCounterId);
    if (!ac) { ctx.writeToTerm('\x1b[31m[Counter] No active counter.\x1b[0m\r\n'); return true; }
    if (ac.status === 'stopped') { ctx.writeToTerm(`\x1b[36m[Counter "${ac.name}" already stopped]\x1b[0m\r\n`); return true; }
    cv.stopCounter(ac.id);
    return true;
  }

  if (argsLower === 'clear') {
    const ac = counters.find((c) => c.id === activeCounterId);
    if (!ac) { ctx.writeToTerm('\x1b[31m[Counter] No active counter.\x1b[0m\r\n'); return true; }
    cv.clearCounter(ac.id);
    return true;
  }

  if (argsLower.startsWith('switch ')) {
    const name = args.slice(7).trim();
    if (!name) { ctx.writeToTerm('\x1b[31m[Counter] Usage: /counter switch <name>\x1b[0m\r\n'); return true; }
    const nameLower = name.toLowerCase();
    const match = counters.find((c) => c.name.toLowerCase() === nameLower)
      ?? counters.find((c) => c.name.toLowerCase().includes(nameLower));
    if (!match) {
      ctx.writeToTerm(`\x1b[31m[Counter] No counter matching "${name}".\x1b[0m\r\n`);
    } else {
      ic.setActiveCounterId(match.id);
      ctx.writeToTerm(`\x1b[36m[Counter switched to "${match.name}"]\x1b[0m\r\n`);
    }
    return true;
  }

  ctx.writeToTerm(
    '\x1b[31m[Counter] Usage:\r\n' +
    '  /counter list            List all counters\r\n' +
    '  /counter status          Active counter one-liner\r\n' +
    '  /counter info            Detailed stats for active counter\r\n' +
    '  /counter start           Start/resume active counter\r\n' +
    '  /counter toggle          Toggle start/pause\r\n' +
    '  /counter pause           Pause active counter\r\n' +
    '  /counter stop            Stop active counter\r\n' +
    '  /counter clear           Clear active counter\r\n' +
    '  /counter switch <name>   Switch active counter by name\x1b[0m\r\n'
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
