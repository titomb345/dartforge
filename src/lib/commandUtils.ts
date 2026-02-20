import type { ExpandedCommand } from '../types/alias';

/**
 * Split a raw input string on unescaped semicolons.
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
 * Parse special directives (#delay, #echo) from a command string.
 * Returns an ExpandedCommand.
 */
export function parseDirective(cmd: string): ExpandedCommand {
  const trimmed = cmd.trim();

  // #delay <ms>
  const delayMatch = trimmed.match(/^#delay\s+(\d+)$/i);
  if (delayMatch) {
    return { type: 'delay', ms: parseInt(delayMatch[1], 10) };
  }

  // #echo <text>
  const echoMatch = trimmed.match(/^#echo\s+(.+)$/i);
  if (echoMatch) {
    return { type: 'echo', text: echoMatch[1] };
  }

  // Plain send
  return { type: 'send', text: trimmed };
}
