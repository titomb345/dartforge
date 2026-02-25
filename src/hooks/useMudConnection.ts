import { useEffect, useRef, useState, useCallback } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { MudTransport } from '../lib/transport';
import { MudOutputPayload, ConnectionStatusPayload } from '../types';
import { getConnectingSplash, getConnectedSplash, getDisconnectSplash } from '../lib/splash';
import { smartWrite } from '../lib/terminalUtils';
import { stripAnsi } from '../lib/ansiUtils';
import type { OutputFilter } from '../lib/outputFilter';

/** ANSI SGR foreground color names (indexed 0-7 → 30-37 / 90-97). */
const SGR_FG_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

/** Pre-compiled regex for matching ANSI SGR sequences. */
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

/** End marker for the DartMUD ASCII banner */
const BANNER_END_MARKER = 'Ferdarchi';
/** Max bytes to buffer before giving up on banner detection */
const BANNER_MAX_BUFFER = 5000;

/**
 * Detect if data ends with a MUD prompt ("> ") without a trailing newline.
 * Used as fallback when IAC GA is not available.
 */
function endsWithPrompt(data: string): boolean {
  const stripped = stripAnsi(data);
  return stripped.endsWith('\n> ') || stripped.endsWith('\r\n> ') || stripped === '> ';
}

/**
 * Strip the game prompt ("> ") from output text. With IAC GA signalling
 * end-of-response, the prompt is unnecessary in a split-pane client.
 * Returns empty string for bare prompts.
 */
function stripPrompt(data: string): string {
  const clean = stripAnsi(data);
  // Bare prompt only — preserve any ANSI codes (especially color resets)
  if (clean.trim() === '>' || clean.trim() === '') {
    const ansiCodes = data.match(ANSI_SGR_RE);
    return ansiCodes ? ansiCodes.join('') : '';
  }
  // Strip trailing prompt after newline
  return data.replace(/\r?\n> ?$/, '\n');
}

/** Map a single ANSI SGR code to a human-readable name */
function sgrName(code: number): string | null {
  if (code >= 30 && code <= 37) return SGR_FG_NAMES[code - 30];
  if (code >= 90 && code <= 97) return 'bright ' + SGR_FG_NAMES[code - 90];
  if (code >= 40 && code <= 47) return 'bg:' + SGR_FG_NAMES[code - 40];
  if (code >= 100 && code <= 107) return 'bg:bright ' + SGR_FG_NAMES[code - 100];
  if (code === 2) return 'dim';
  if (code === 3) return 'italic';
  if (code === 4) return 'underline';
  if (code === 7) return 'reverse';
  return null;
}

/**
 * Annotate ANSI SGR (color) sequences with human-readable tags for debug mode.
 * Shows labels like [bright green] or [magenta] that match the color picker panel.
 * Bold (1) + a normal color is promoted to the bright variant to match terminal behavior.
 */
function annotateAnsi(data: string): string {
  return data.replace(/\x1b\[([0-9;]*)m/g, (match, params) => {
    if (!params || params === '0') return match;

    const codes = params.split(';').map(Number);
    let bold = false;
    const names: string[] = [];

    for (const code of codes) {
      if (code === 0) continue;
      if (code === 1) {
        bold = true;
        continue;
      }
      const name = sgrName(code);
      if (name) names.push(name);
    }

    // Bold + normal foreground color → promote to bright variant
    const finalNames = names.map((n) => {
      if (
        bold &&
        !n.startsWith('bright') &&
        !n.startsWith('bg:') &&
        !['dim', 'italic', 'underline', 'reverse'].includes(n)
      ) {
        return 'bright ' + n;
      }
      return n;
    });

    if (finalNames.length === 0) return match;
    return `\x1b[2;37m[${finalNames.join(', ')}]\x1b[22m${match}`;
  });
}

export interface AutoLoginConfig {
  enabled: boolean;
  name: string;
  password: string;
}

export function useMudConnection(
  terminalRef: React.MutableRefObject<Terminal | null>,
  debugModeRef: React.RefObject<boolean>,
  transport: MudTransport,
  onOutputChunk?: (data: string) => void,
  onCharacterName?: (name: string) => void,
  outputFilterRef?: React.RefObject<OutputFilter | null>,
  onLogin?: () => void,
  autoLoginRef?: React.RefObject<AutoLoginConfig | null>
) {
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting...');
  const [passwordMode, setPasswordMode] = useState(false);
  const [skipHistory, setSkipHistory] = useState(false);
  const unlistenRefs = useRef<(() => void)[]>([]);
  const wasConnectedRef = useRef(false);
  const passwordModeRef = useRef(false);
  const skipHistoryRef = useRef(false);
  const captureNameRef = useRef(false);
  const loginFiredRef = useRef(false);
  const pendingNameRef = useRef<string | null>(null);
  const autoLoginAttemptedRef = useRef(false);

  // Store latest callback refs to avoid re-subscribing on every change
  const onOutputChunkRef = useRef(onOutputChunk);
  onOutputChunkRef.current = onOutputChunk;
  const onCharacterNameRef = useRef(onCharacterName);
  onCharacterNameRef.current = onCharacterName;
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;

  // Banner filtering state
  const filteringBannerRef = useRef(false);
  const bannerBufferRef = useRef('');

  // Keep transport ref stable for callbacks
  const transportRef = useRef(transport);
  transportRef.current = transport;

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const cleanup = await transportRef.current.connect({
        onOutput: (payload: MudOutputPayload) => {
          if (cancelled || !terminalRef.current) return;
          const term = terminalRef.current;

          const detectPrompts = (data: string) => {
            if (/password:/i.test(data)) {
              passwordModeRef.current = true;
              skipHistoryRef.current = true;
              setPasswordMode(true);
              setSkipHistory(true);
              // Auto-login: auto-send password (no attemptedRef check — this always follows a name send)
              const al = autoLoginRef?.current;
              if (al?.enabled && al.password && autoLoginAttemptedRef.current) {
                setTimeout(() => {
                  transportRef.current.sendCommand(al.password);
                  passwordModeRef.current = false;
                  setPasswordMode(false);
                  skipHistoryRef.current = false;
                  setSkipHistory(false);
                }, 100);
              }
            } else if (/name:/i.test(data)) {
              captureNameRef.current = true;
              skipHistoryRef.current = true;
              setSkipHistory(true);
              // Auto-login: auto-send name
              const al = autoLoginRef?.current;
              if (al?.enabled && al.name && !autoLoginAttemptedRef.current) {
                autoLoginAttemptedRef.current = true;
                captureNameRef.current = false;
                pendingNameRef.current = al.name;
                setTimeout(() => {
                  transportRef.current.sendCommand(al.name);
                  skipHistoryRef.current = false;
                  setSkipHistory(false);
                }, 100);
              }
            }
            // Detect successful login or reconnect
            if (
              !loginFiredRef.current &&
              (/Running under version/i.test(data) || /reconnecting to old object/i.test(data))
            ) {
              loginFiredRef.current = true;
              // Activate the character name only after login succeeds
              if (pendingNameRef.current) {
                onCharacterNameRef.current?.(pendingNameRef.current);
                pendingNameRef.current = null;
              }
              onLoginRef.current?.();
            }
          };

          /** Shared pipeline: detect prompts → filter → annotate → strip → write. */
          const processData = (data: string) => {
            detectPrompts(data);
            onOutputChunkRef.current?.(data);
            const filtered = outputFilterRef?.current
              ? outputFilterRef.current.filter(data)
              : data;
            if (filtered) {
              let out = debugModeRef.current ? annotateAnsi(filtered) : filtered;
              const shouldStrip = outputFilterRef?.current?.stripPrompts ?? true;
              if (payload.ga && shouldStrip) {
                out = stripPrompt(out);
              } else if (endsWithPrompt(filtered)) {
                out += '\n';
              }
              if (out) smartWrite(term, out);
            }
          };

          // Banner filtering: suppress the server's ASCII splash on connect
          if (filteringBannerRef.current) {
            bannerBufferRef.current += payload.data;

            const markerIdx = bannerBufferRef.current.indexOf(BANNER_END_MARKER);
            if (markerIdx >= 0) {
              // Found end of banner — pass through anything after the marker line
              filteringBannerRef.current = false;
              const lineEnd = bannerBufferRef.current.indexOf('\n', markerIdx);
              const afterBanner =
                lineEnd >= 0 ? bannerBufferRef.current.substring(lineEnd + 1) : '';
              bannerBufferRef.current = '';
              if (afterBanner.length > 0) processData(afterBanner);
            } else if (bannerBufferRef.current.length > BANNER_MAX_BUFFER) {
              // Safety: too much data without finding banner, flush it all
              filteringBannerRef.current = false;
              const rawBuffer = bannerBufferRef.current;
              bannerBufferRef.current = '';
              processData(rawBuffer);
            }
            return;
          }

          processData(payload.data);
        },

        onStatus: (payload: ConnectionStatusPayload) => {
          if (cancelled) return;
          const term = terminalRef.current;

          if (payload.connected && !wasConnectedRef.current && term) {
            // Just connected — clear terminal, show our splash, start filtering banner
            term.clear();
            term.write(getConnectedSplash(term.cols));
            filteringBannerRef.current = true;
            bannerBufferRef.current = '';
            loginFiredRef.current = false;
            outputFilterRef?.current?.reset();
          } else if (!payload.connected && wasConnectedRef.current && term) {
            // Connection dropped — stop any active filtering, show disconnect splash
            filteringBannerRef.current = false;
            bannerBufferRef.current = '';
            pendingNameRef.current = null;
            autoLoginAttemptedRef.current = false;
            passwordModeRef.current = false;
            setPasswordMode(false);
            skipHistoryRef.current = false;
            setSkipHistory(false);
            outputFilterRef?.current?.reset();
            smartWrite(term, getDisconnectSplash(term.cols));
          }

          wasConnectedRef.current = payload.connected;
          setConnected(payload.connected);
          setStatusMessage(payload.message);
        },
      });

      unlistenRefs.current = [cleanup];
    }

    setup();

    return () => {
      cancelled = true;
      unlistenRefs.current.forEach((fn) => fn());
    };
  }, [terminalRef]);

  const sendCommand = useCallback(async (command: string) => {
    try {
      // Capture character name if we just saw a "name:" prompt (deferred until login succeeds)
      if (captureNameRef.current) {
        captureNameRef.current = false;
        pendingNameRef.current = command.trim();
      }
      if (passwordModeRef.current) {
        passwordModeRef.current = false;
        setPasswordMode(false);
      }
      if (skipHistoryRef.current) {
        skipHistoryRef.current = false;
        setSkipHistory(false);
      }
      await transportRef.current.sendCommand(command);
    } catch (e) {
      console.error('Failed to send command:', e);
    }
  }, []);

  const reconnect = useCallback(async () => {
    try {
      const term = terminalRef.current;
      if (term) {
        term.clear();
        term.write(getConnectingSplash(term.cols));
      }
      await transportRef.current.reconnect();
    } catch (e) {
      console.error('Failed to reconnect:', e);
    }
  }, [terminalRef]);

  const disconnect = useCallback(async () => {
    try {
      await transportRef.current.disconnect();
    } catch (e) {
      console.error('Failed to disconnect:', e);
    }
  }, []);

  return {
    connected,
    passwordMode,
    skipHistory,
    statusMessage,
    sendCommand,
    reconnect,
    disconnect,
  };
}
