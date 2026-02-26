import type { ExpandedCommand } from '../types/alias';
import type { Variable } from '../types/variable';
import { expandVariables } from './variableEngine';

/**
 * Split a raw input string on unescaped semicolons and newlines.
 * `\;` is treated as a literal semicolon (not a separator).
 */
export function splitCommands(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '\\' && input[i + 1] === ';') {
      current += ';';
      i++; // skip escaped semicolon
    } else if (input[i] === ';') {
      const ct = current.trim();
      // /spam and /var consume the rest of the line (semicolons included)
      if (/^\/spam\s+\d+\s/i.test(ct) || /^\/var\s+(-g\s+)?\S+\s/i.test(ct)) {
        current += ';';
      } else {
        parts.push(current);
        current = '';
      }
    } else if (input[i] === '\r') {
      // skip carriage returns (handle \r\n as just \n)
      continue;
    } else if (input[i] === '\n') {
      parts.push(current);
      current = '';
    } else {
      current += input[i];
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Parse special directives (/delay, /echo) from a command string.
 * Returns an ExpandedCommand.
 */
export function parseDirective(cmd: string): ExpandedCommand {
  const trimmed = cmd.trim();

  // /delay <ms>
  const delayMatch = trimmed.match(/^\/delay\s+(\d+)$/i);
  if (delayMatch) {
    return { type: 'delay', ms: parseInt(delayMatch[1], 10) };
  }

  // /echo <text>
  const echoMatch = trimmed.match(/^\/echo\s+(.+)$/i);
  if (echoMatch) {
    return { type: 'echo', text: echoMatch[1] };
  }

  // /spam <count> <command>
  const spamMatch = trimmed.match(/^\/spam\s+(\d+)\s+(.+)$/i);
  if (spamMatch) {
    const count = Math.min(parseInt(spamMatch[1], 10), 1000);
    return { type: 'spam', count, command: spamMatch[2] };
  }

  // /var [-g] <name> <value>
  const varMatch = trimmed.match(/^\/var\s+(-g\s+)?(\S+)\s+(.+)$/i);
  if (varMatch) {
    const scope = varMatch[1] ? ('global' as const) : ('character' as const);
    return { type: 'var', name: varMatch[2], value: varMatch[3], scope };
  }

  // /convert <args>
  const convertMatch = trimmed.match(/^\/convert\s+(.+)$/i);
  if (convertMatch) {
    return { type: 'convert', args: convertMatch[1] };
  }

  // Plain send
  return { type: 'send', text: trimmed };
}

/**
 * Format a list of expanded commands into human-readable preview text.
 * Flattens /spam by expanding the inner command and repeating it.
 * @param expand — optional callback to expand the spam inner command through the alias engine
 */
export function formatCommandPreview(
  commands: ExpandedCommand[],
  expand?: (input: string) => ExpandedCommand[],
  spamDepth = 0
): string[] {
  const lines: string[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'send':
        lines.push(cmd.text);
        break;
      case 'delay':
        lines.push(`[delay ${cmd.ms}ms]`);
        break;
      case 'echo':
        lines.push(`[echo] ${cmd.text}`);
        break;
      case 'spam': {
        if (cmd.count <= 0) break;
        if (spamDepth > 0) {
          lines.push('[Nested /spam not allowed]');
          break;
        }
        const inner = expand ? expand(cmd.command) : [parseDirective(cmd.command)];
        const once = formatCommandPreview(inner, expand, spamDepth + 1);
        for (let i = 0; i < cmd.count; i++) {
          lines.push(...once);
        }
        break;
      }
      case 'var':
        lines.push(`[var] $${cmd.name} = ${cmd.value}`);
        break;
      case 'convert':
        lines.push(`[convert] ${cmd.args}`);
        break;
    }
  }
  return lines;
}

/** Callbacks for command execution — lets callers customize send/echo behavior. */
export interface CommandRunner {
  send: (text: string) => Promise<void>;
  echo: (text: string) => void;
  expand: (input: string) => ExpandedCommand[];
  setVar: (name: string, value: string, scope: 'character' | 'global') => void;
  convert: (args: string) => void;
  getVariables: () => Variable[];
}

/**
 * Execute a list of expanded commands using the provided runner.
 * Handles send, delay, echo, spam, var, and convert.
 * Variables are expanded just-in-time so /var updates are visible to later commands.
 * A local overlay ensures vars set via /var are immediately available to subsequent
 * commands in the same sequence (React state updates are async and wouldn't be visible).
 */
export async function executeCommands(
  commands: ExpandedCommand[],
  runner: CommandRunner,
  spamDepth = 0,
  localVars?: Variable[]
): Promise<void> {
  // Local overrides accumulate /var sets during this execution.
  // Placed BEFORE runner vars so they win on name collisions.
  const overrides = localVars ?? [];
  const ev = (text: string) => expandVariables(text, [...overrides, ...runner.getVariables()]);

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'send': {
        const expanded = ev(cmd.text);
        // If variable expansion changed the text (e.g., $reattackAction → /spam 1 k demon;sf),
        // re-process through the pipeline so directives are executed, not sent raw to the MUD.
        if (expanded !== cmd.text) {
          const reExpanded = runner.expand(expanded);
          await executeCommands(reExpanded, runner, spamDepth, overrides);
        } else {
          await runner.send(expanded);
        }
        break;
      }
      case 'delay':
        await new Promise<void>((r) => setTimeout(r, cmd.ms));
        break;
      case 'echo':
        runner.echo(ev(cmd.text));
        break;
      case 'spam': {
        if (cmd.count <= 0) break;
        if (spamDepth > 0) {
          runner.echo('[Nested /spam not allowed]');
          break;
        }
        runner.echo(`[Spam: ${cmd.command} (x${cmd.count})]`);
        const expanded = runner.expand(ev(cmd.command));
        for (let i = 0; i < cmd.count; i++) {
          await executeCommands(expanded, runner, spamDepth + 1, overrides);
        }
        break;
      }
      case 'var': {
        const value = ev(cmd.value);
        runner.setVar(cmd.name, value, cmd.scope);
        // Add to local overrides so subsequent commands see it immediately
        overrides.push({
          id: '',
          name: cmd.name,
          value,
          enabled: true,
          createdAt: '',
          updatedAt: '',
        });
        runner.echo(`$${cmd.name} = ${value} (${cmd.scope})`);
        break;
      }
      case 'convert':
        runner.convert(ev(cmd.args));
        break;
    }
  }
}
