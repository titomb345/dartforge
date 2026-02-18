import type { ChatMessage, ChatType } from '../types/chat';

// Say/Ask/Exclaim: "Name says/asks/exclaims [to target] in lang, 'msg'"
const SAY_RE = /^(\w+) (says|asks|exclaims)(?: to (?:you|\w+))? in (\w+), '(.+)'$/;
const SAY_DIRECTED_RE = /^(\w+) (?:says|asks|exclaims) to you in /;

// Shout/Yell: "Name shouts/yells in lang, 'msg'"
const SHOUT_RE = /^(\w+) (shouts|yells) in (\w+), '(.+)'$/;

// OOC: "Name says (OOC), 'msg'" — comma may or may not have trailing space
const OOC_RE = /^(\w+) says \(OOC\),\s*'(.+)'$/;

// Tell (mental touch): "A mental touch tells you: 'msg -Sender'." — single or double quotes
const TELL_RE = /^A mental touch tells you:\s*['"](.+?)['"]\.?$/;

// SZ (voice): "A voice seems to say: 'msg -Sender'"
const SZ_RE = /^A voice seems to say: '(.+)'$/;

// Own messages
const OWN_SAY_RE = /^You (say|ask|exclaim) in (\w+), '(.+)'$/;
const OWN_SHOUT_RE = /^You (shout|yell) in (\w+), '(.+)'$/;
const OWN_OOC_RE = /^You say \(OOC\),\s*'(.+)'$/;

/** Extract "-SenderName" suffix from tell/sz message bodies */
function extractSender(msg: string): { sender: string; message: string } {
  const match = msg.match(/^(.+?)\s+-(\w+)$/);
  if (match) return { message: match[1], sender: match[2] };
  return { message: msg, sender: 'Unknown' };
}

let nextId = 1;

/** Reset the ID counter (for tests or reconnect) */
export function resetChatIdCounter(): void {
  nextId = 1;
}

function make(
  type: ChatType,
  sender: string,
  message: string,
  raw: string,
  opts?: { language?: string; directed?: boolean; isOwn?: boolean },
): ChatMessage {
  return {
    id: nextId++,
    type,
    sender,
    message,
    raw,
    timestamp: new Date(),
    language: opts?.language,
    directed: opts?.directed,
    isOwn: opts?.isOwn,
  };
}

/**
 * Match a single ANSI-stripped, trimmed line against all chat patterns.
 * Returns a ChatMessage if matched, null otherwise.
 */
export function matchChatLine(
  line: string,
  activeCharacter: string | null,
): ChatMessage | null {
  // Strip leading "> " prompts (MUD sometimes prepends these)
  const cleaned = line.replace(/^(?:> )+/, '').trim();
  if (!cleaned) return null;

  let m: RegExpMatchArray | null;

  // --- Own messages first (so they don't get matched as NPC say) ---

  m = cleaned.match(OWN_SAY_RE);
  if (m) {
    return make('say', activeCharacter ?? 'You', m[3], cleaned, {
      language: m[2],
      isOwn: true,
    });
  }

  m = cleaned.match(OWN_SHOUT_RE);
  if (m) {
    return make('shout', activeCharacter ?? 'You', m[3], cleaned, {
      language: m[2],
      isOwn: true,
    });
  }

  m = cleaned.match(OWN_OOC_RE);
  if (m) {
    return make('ooc', activeCharacter ?? 'You', m[1], cleaned, { isOwn: true });
  }

  // --- Other players / NPCs ---

  m = cleaned.match(SAY_RE);
  if (m) {
    const directed = SAY_DIRECTED_RE.test(cleaned);
    return make('say', m[1], m[4], cleaned, { language: m[3], directed });
  }

  m = cleaned.match(SHOUT_RE);
  if (m) {
    return make('shout', m[1], m[4], cleaned, { language: m[3] });
  }

  m = cleaned.match(OOC_RE);
  if (m) {
    return make('ooc', m[1], m[2], cleaned);
  }

  m = cleaned.match(TELL_RE);
  if (m) {
    const { sender, message } = extractSender(m[1]);
    return make('tell', sender, message, cleaned);
  }

  m = cleaned.match(SZ_RE);
  if (m) {
    const { sender, message } = extractSender(m[1]);
    return make('sz', sender, message, cleaned);
  }

  return null;
}
