import type { ChatMessage, ChatType } from '../types/chat';

// Say/Ask/Exclaim: "Name says/asks/exclaims [to target] in lang, 'msg'"
const SAY_RE = /^(\w+) (says|asks|exclaims)(?: to (?:you|\w+))? in (\w+), '(.+)'$/;
const SAY_DIRECTED_RE = /^(\w+) (?:says|asks|exclaims) to you in /;

// Shout/Yell: "Name shouts/yells in lang, 'msg'"
const SHOUT_RE = /^(\w+) (shouts|yells) in (\w+), '(.+)'$/;

// OOC: "Name says (OOC),'msg'"
const OOC_RE = /^(\w+) says \(OOC\),'(.+)'$/;

// Tell (mental touch): 'A mental touch tells you: "msg -Sender".'
const TELL_RE = /^A mental touch tells you: "(.+)"\.?$/;

// SZ (voice): "A voice seems to say: 'msg -Sender'"
const SZ_RE = /^A voice seems to say: '(.+)'$/;

// Own messages
const OWN_SAY_RE = /^You (say|ask|exclaim) in (\w+), '(.+)'$/;
const OWN_SHOUT_RE = /^You (shout|yell) in (\w+), '(.+)'$/;
const OWN_OOC_RE = /^You say \(OOC\),'(.+)'$/;

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
  let m: RegExpMatchArray | null;

  // --- Own messages first (so they don't get matched as NPC say) ---

  m = line.match(OWN_SAY_RE);
  if (m) {
    return make('say', activeCharacter ?? 'You', m[3], line, {
      language: m[2],
      isOwn: true,
    });
  }

  m = line.match(OWN_SHOUT_RE);
  if (m) {
    return make('shout', activeCharacter ?? 'You', m[3], line, {
      language: m[2],
      isOwn: true,
    });
  }

  m = line.match(OWN_OOC_RE);
  if (m) {
    return make('ooc', activeCharacter ?? 'You', m[1], line, { isOwn: true });
  }

  // --- Other players / NPCs ---

  m = line.match(SAY_RE);
  if (m) {
    const directed = SAY_DIRECTED_RE.test(line);
    return make('say', m[1], m[4], line, { language: m[3], directed });
  }

  m = line.match(SHOUT_RE);
  if (m) {
    return make('shout', m[1], m[4], line, { language: m[3] });
  }

  m = line.match(OOC_RE);
  if (m) {
    return make('ooc', m[1], m[2], line);
  }

  m = line.match(TELL_RE);
  if (m) {
    const { sender, message } = extractSender(m[1]);
    return make('tell', sender, message, line);
  }

  m = line.match(SZ_RE);
  if (m) {
    const { sender, message } = extractSender(m[1]);
    return make('sz', sender, message, line);
  }

  return null;
}
