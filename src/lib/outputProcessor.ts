import type { SkillMatchResult } from '../types/skills';
import { stripAnsi } from './ansiUtils';

export type LineMatcher = (line: string) => SkillMatchResult | null;

interface TempMatcher {
  matcher: LineMatcher;
  expiresAt: number;
}

/**
 * Line-buffered output processor that strips ANSI and runs matchers
 * against complete lines. Purely observational — does not modify output.
 */
export class OutputProcessor {
  private buffer = '';
  private matchers: LineMatcher[] = [];
  private tempMatchers: TempMatcher[] = [];

  /** Register a permanent matcher */
  registerMatcher(matcher: LineMatcher): void {
    this.matchers.push(matcher);
  }

  /** Register a temporary matcher that auto-expires after timeoutMs */
  registerTempMatcher(matcher: LineMatcher, timeoutMs: number): void {
    this.tempMatchers.push({
      matcher,
      expiresAt: Date.now() + timeoutMs,
    });
  }

  /**
   * Feed a chunk of data. Returns match results for any complete lines
   * that matched a registered pattern.
   */
  processChunk(data: string): SkillMatchResult[] {
    const results: SkillMatchResult[] = [];
    const now = Date.now();

    // Prune expired temp matchers
    this.tempMatchers = this.tempMatchers.filter((tm) => tm.expiresAt > now);

    // Append to buffer and strip ANSI for matching
    this.buffer += stripAnsi(data);

    // Split on newlines, keeping last partial line in buffer
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Run permanent matchers
      for (const matcher of this.matchers) {
        const result = matcher(trimmed);
        if (result) {
          results.push(result);
          break; // Only one match per line
        }
      }

      // Run temp matchers (check for matches even if permanent matched,
      // since shown-skill is a temp matcher watching for a specific response)
      for (let i = this.tempMatchers.length - 1; i >= 0; i--) {
        const tm = this.tempMatchers[i];
        if (tm.expiresAt <= now) continue;
        const result = tm.matcher(trimmed);
        if (result) {
          results.push(result);
          // Remove this temp matcher after it fires
          this.tempMatchers.splice(i, 1);
          break;
        }
      }
    }

    return results;
  }
}
