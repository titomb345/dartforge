import type { ExpandedCommand } from '../types/alias';

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
      // /spam consumes the rest of the line (semicolons included)
      if (/^\/spam\s+\d+\s/i.test(current.trim())) {
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

  // Plain send
  return { type: 'send', text: trimmed };
}

/** Callbacks for command execution — lets callers customize send/echo behavior. */
export interface CommandRunner {
  send: (text: string) => Promise<void>;
  echo: (text: string) => void;
  expand: (input: string) => ExpandedCommand[];
}

/**
 * Execute a list of expanded commands using the provided runner.
 * Handles send, delay, echo, and spam (with nested-spam protection).
 */
export async function executeCommands(
  commands: ExpandedCommand[],
  runner: CommandRunner,
  spamDepth = 0,
): Promise<void> {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'send':
        await runner.send(cmd.text);
        break;
      case 'delay':
        await new Promise<void>((r) => setTimeout(r, cmd.ms));
        break;
      case 'echo':
        runner.echo(cmd.text);
        break;
      case 'spam': {
        if (cmd.count <= 0) break;
        if (spamDepth > 0) {
          runner.echo('[Nested /spam not allowed]');
          break;
        }
        const expanded = runner.expand(cmd.command);
        for (let i = 0; i < cmd.count; i++) {
          await executeCommands(expanded, runner, spamDepth + 1);
        }
        break;
      }
    }
  }
}
