import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { useLatestRef } from './hooks/useLatestRef';
import type { Terminal as XTerm } from '@xterm/xterm';
import { getAppVersion, setWindowTitle } from './lib/platform';
import { Terminal } from './components/Terminal';
import { CommandInput } from './components/CommandInput';
import { Toolbar } from './components/Toolbar';
import { ColorSettings } from './components/ColorSettings';
import { SettingsPanel } from './components/SettingsPanel';
import { SetupDialog } from './components/SetupDialog';
import { SkillPanel } from './components/SkillPanel';
import { ChatPanel } from './components/ChatPanel';
import { CounterPanel } from './components/CounterPanel';
import { NotesPanel } from './components/NotesPanel';
import { GameClock } from './components/GameClock';
import { StatusReadout } from './components/StatusReadout';
import { HeartIcon, FocusIcon, FoodIcon, DropletIcon, AuraIcon, WeightIcon, BootIcon } from './components/icons';
import { useMudConnection } from './hooks/useMudConnection';
import { useTransport } from './contexts/TransportContext';
import { useThemeColors } from './hooks/useThemeColors';
import { useSkillTracker } from './hooks/useSkillTracker';
import { useChatMessages } from './hooks/useChatMessages';
import { useImproveCounters } from './hooks/useImproveCounters';
import { useAliases } from './hooks/useAliases';
import { useVariables } from './hooks/useVariables';
import { useConcentration } from './hooks/useConcentration';
import { useHealth } from './hooks/useHealth';
import { useNeeds } from './hooks/useNeeds';
import { useAura } from './hooks/useAura';
import { useEncumbrance } from './hooks/useEncumbrance';
import { useMovement } from './hooks/useMovement';
import { useDataStore } from './contexts/DataStoreContext';
import { buildXtermTheme, type ThemeColorKey } from './lib/defaultTheme';
import { OutputProcessor } from './lib/outputProcessor';
import { expandInput } from './lib/aliasEngine';
import { executeCommands, type CommandRunner } from './lib/commandUtils';
import { OutputFilter, DEFAULT_FILTER_FLAGS, type FilterFlags } from './lib/outputFilter';
import { matchSkillLine } from './lib/skillPatterns';
import type { Panel, PanelLayout, PinnablePanel, DockSide } from './types';
import { PinnedRegion } from './components/PinnedRegion';
import { SlideOut } from './components/SlideOut';
import { SkillTrackerProvider } from './contexts/SkillTrackerContext';
import { ChatProvider } from './contexts/ChatContext';
import { ImproveCounterProvider } from './contexts/ImproveCounterContext';
import { AliasProvider } from './contexts/AliasContext';
import { VariableProvider } from './contexts/VariableContext';
import { VariablePanel } from './components/VariablePanel';
import { AliasPanel } from './components/AliasPanel';
import { TriggerProvider } from './contexts/TriggerContext';
import { TriggerPanel } from './components/TriggerPanel';
import { useTriggers } from './hooks/useTriggers';
import { useSignatureMappings } from './hooks/useSignatureMappings';
import { matchTriggers, expandTriggerBody, resetTriggerCooldowns } from './lib/triggerEngine';
import { smartWrite } from './lib/terminalUtils';
import { stripAnsi } from './lib/ansiUtils';
import { SignatureProvider } from './contexts/SignatureContext';
import { parseConvertCommand, formatMultiConversion } from './lib/currency';
import { useMapTracker } from './hooks/useMapTracker';
import { MapProvider } from './contexts/MapContext';
import { PanelProvider } from './contexts/PanelLayoutContext';
import { MapPanel } from './components/MapPanel';
import { useAllocations } from './hooks/useAllocations';
import { AllocProvider } from './contexts/AllocContext';
import { AllocPanel } from './components/AllocPanel';
import { CurrencyPanel } from './components/CurrencyPanel';
import { ResizeHandle } from './components/ResizeHandle';
import { useResize } from './hooks/useResize';
import { AllocLineParser, parseAllocCommand, applyAllocUpdates, MagicLineParser, parseMagicAllocCommand, applyMagicAllocUpdates } from './lib/allocPatterns';
import { useAppSettings } from './hooks/useAppSettings';
import { useSessionLogger } from './hooks/useSessionLogger';
import { AppSettingsProvider } from './contexts/AppSettingsContext';

/** Commands to send automatically after login */
const LOGIN_COMMANDS = ['hp', 'score', 'show combat allocation:all', 'show magic allocation'];

/** Max recent output lines kept for tab completion */
const MAX_RECENT_LINES = 500;

/**
 * App gate — shows the setup dialog until a data location is configured,
 * then mounts the main client. This ensures no hooks (connection, terminal,
 * trackers) run until setup is complete.
 */
function App() {
  const dataStore = useDataStore();

  // Set window title regardless of setup state
  useEffect(() => {
    getAppVersion().then((v) => {
      setWindowTitle(`DartForge v${v}`);
    }).catch(console.error);
  }, []);

  if (dataStore.needsSetup) {
    return <SetupDialog />;
  }

  if (!dataStore.ready) {
    return null;
  }

  return <AppMain />;
}

/** Main client — only mounts after data location is configured and ready. */
function AppMain() {
  const terminalRef = useRef<XTerm | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const recentLinesRef = useRef<string[]>([]);
  const debugModeRef = useRef(false);
  const [debugMode, setDebugMode] = useState(false);
  const [activePanel, setActivePanel] = useState<Panel | null>(null);
  const togglePanel = (panel: Panel) => setActivePanel((v) => v === panel ? null : panel);
  const [panelLayout, setPanelLayout] = useState<PanelLayout>({ left: [], right: [] });
  const [pinnedWidths, setPinnedWidths] = useState<{ left: number; right: number }>({ left: 320, right: 320 });
  const panelLayoutLoadedRef = useRef(false);
  const [compactReadouts, setCompactReadouts] = useState<Record<string, boolean>>({});
  const [filterFlags, setFilterFlags] = useState<FilterFlags>({ ...DEFAULT_FILTER_FLAGS });
  const [loggedIn, setLoggedIn] = useState(false);
  const statusBarRef = useRef<HTMLDivElement | null>(null);
  const [autoCompact, setAutoCompact] = useState(false);

  const appSettings = useAppSettings();
  const {
    antiIdleEnabled, antiIdleCommand, antiIdleMinutes,
    updateAntiIdleEnabled,
    boardDatesEnabled, stripPromptsEnabled,
  } = appSettings;

  const dataStore = useDataStore();
  const settingsLoadedRef = useRef(false);

  // Load compact mode + filter flags + panel layout from settings (with validation)
  useEffect(() => {
    (async () => {
      const savedCompact = await dataStore.get<Record<string, boolean>>('settings.json', 'compactReadouts');
      if (savedCompact != null && typeof savedCompact === 'object' && !Array.isArray(savedCompact)) {
        setCompactReadouts(savedCompact);
      }
      const savedFilters = await dataStore.get<FilterFlags>('settings.json', 'filteredStatuses');
      if (savedFilters != null && typeof savedFilters === 'object' && !Array.isArray(savedFilters)) {
        setFilterFlags({ ...DEFAULT_FILTER_FLAGS, ...savedFilters });
      }
      const savedLayout = await dataStore.get<PanelLayout>('settings.json', 'panelLayout');
      if (
        savedLayout != null &&
        typeof savedLayout === 'object' &&
        Array.isArray(savedLayout.left) &&
        Array.isArray(savedLayout.right)
      ) {
        setPanelLayout(savedLayout);
      }
      const savedWidths = await dataStore.get<{ left: number; right: number }>('settings.json', 'pinnedWidths');
      if (savedWidths != null && typeof savedWidths.left === 'number' && typeof savedWidths.right === 'number') {
        setPinnedWidths(savedWidths);
      }

      panelLayoutLoadedRef.current = true;
      settingsLoadedRef.current = true;
    })().catch(console.error);
  }, []);

  // Panel docking helpers
  const pinPanel = useCallback((panel: PinnablePanel, side: DockSide) => {
    setPanelLayout((prev) => {
      const left = prev.left.filter((p): p is PinnablePanel => p !== panel);
      const right = prev.right.filter((p): p is PinnablePanel => p !== panel);
      const next: PanelLayout = { left, right };
      if (next[side].length < 3) {
        next[side] = [...next[side], panel];
      }
      return next;
    });
    setActivePanel(null);
  }, []);

  const unpinPanel = useCallback((panel: PinnablePanel) => {
    setPanelLayout((prev) => ({
      left: prev.left.filter((p): p is PinnablePanel => p !== panel),
      right: prev.right.filter((p): p is PinnablePanel => p !== panel),
    }));
  }, []);

  const swapPanelSide = useCallback((panel: PinnablePanel) => {
    setPanelLayout((prev) => {
      if (prev.left.includes(panel)) {
        return {
          left: prev.left.filter((p): p is PinnablePanel => p !== panel),
          right: prev.right.length < 3 ? [...prev.right, panel] : prev.right,
        };
      }
      if (prev.right.includes(panel)) {
        return {
          left: prev.left.length < 3 ? [...prev.left, panel] : prev.left,
          right: prev.right.filter((p): p is PinnablePanel => p !== panel),
        };
      }
      return prev;
    });
  }, []);

  const movePanel = useCallback((panel: PinnablePanel, direction: 'up' | 'down') => {
    setPanelLayout((prev) => {
      const moveSide = (arr: PinnablePanel[]): PinnablePanel[] => {
        const idx = arr.indexOf(panel);
        if (idx < 0) return arr;
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= arr.length) return arr;
        const next = [...arr];
        [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
        return next;
      };
      if (prev.left.includes(panel)) {
        return { left: moveSide(prev.left), right: prev.right };
      }
      if (prev.right.includes(panel)) {
        return { left: prev.left, right: moveSide(prev.right) };
      }
      return prev;
    });
  }, []);

  // Persist panel layout
  useEffect(() => {
    if (!panelLayoutLoadedRef.current) return;
    dataStore.set('settings.json', 'panelLayout', panelLayout).catch(console.error);
  }, [panelLayout]);

  // Persist pinned panel widths
  useEffect(() => {
    if (!panelLayoutLoadedRef.current) return;
    dataStore.set('settings.json', 'pinnedWidths', pinnedWidths).catch(console.error);
  }, [pinnedWidths]);

  // Resize hooks for pinned regions
  const leftResize = useResize({
    side: 'left',
    initialWidth: pinnedWidths.left,
    onWidthChange: useCallback((w: number) => setPinnedWidths((p) => ({ ...p, left: w })), []),
  });
  const rightResize = useResize({
    side: 'right',
    initialWidth: pinnedWidths.right,
    onWidthChange: useCallback((w: number) => setPinnedWidths((p) => ({ ...p, right: w })), []),
  });

  const { theme, updateColor, resetColor, display, updateDisplay, resetDisplay, resetAll } = useThemeColors();
  const xtermTheme = buildXtermTheme(theme);

  // Output processor for skill detection
  const processorRef = useRef<OutputProcessor | null>(null);
  if (!processorRef.current) {
    processorRef.current = new OutputProcessor();
    processorRef.current.registerMatcher(matchSkillLine);
  }

  // Chat messages hook
  const chatNotificationsRef = useRef(appSettings.chatNotifications);
  chatNotificationsRef.current = appSettings.chatNotifications;
  const { messages: chatMessages, filters: chatFilters, mutedSenders, soundAlerts: chatSoundAlerts, newestFirst: chatNewestFirst, handleChatMessage, toggleFilter: toggleChatFilter, setAllFilters: setAllChatFilters, toggleSoundAlert: toggleChatSoundAlert, toggleNewestFirst: toggleChatNewestFirst, muteSender, unmuteSender, updateSender } =
    useChatMessages(appSettings.chatHistorySize, chatNotificationsRef);
  const handleChatMessageRef = useLatestRef(handleChatMessage);

  // Status trackers
  const { concentration, updateConcentration } = useConcentration();
  const updateConcentrationRef = useLatestRef(updateConcentration);

  const { health, updateHealth } = useHealth();
  const updateHealthRef = useLatestRef(updateHealth);

  const { hunger, thirst, updateHunger, updateThirst } = useNeeds();
  const updateHungerRef = useLatestRef(updateHunger);
  const updateThirstRef = useLatestRef(updateThirst);

  const { aura, updateAura } = useAura();
  const updateAuraRef = useLatestRef(updateAura);

  const { encumbrance, updateEncumbrance } = useEncumbrance();
  const updateEncumbranceRef = useLatestRef(updateEncumbrance);

  const { movement, updateMovement } = useMovement();
  const updateMovementRef = useLatestRef(updateMovement);

  const outputFilterRef = useRef<OutputFilter | null>(null);
  if (!outputFilterRef.current) {
    outputFilterRef.current = new OutputFilter({
      onConcentration: (match) => { updateConcentrationRef.current(match); },
      onHealth: (match) => { updateHealthRef.current(match); },
      onHunger: (level) => { updateHungerRef.current(level); },
      onThirst: (level) => { updateThirstRef.current(level); },
      onAura: (match) => { updateAuraRef.current(match); },
      onEncumbrance: (match) => { updateEncumbranceRef.current(match); },
      onMovement: (match) => { updateMovementRef.current(match); },
      onChat: (msg) => { handleChatMessageRef.current(msg); },
      onLine: (stripped, raw) => {
        // Feed stripped lines to the room parser for map building
        mapFeedLineRef.current(stripped);

        // Feed to allocation parser
        const allocResult = allocParserRef.current?.feedLine(stripped);
        if (allocResult) {
          handleAllocParseRef.current(allocResult);
        }

        // Feed to magic allocation parser
        const magicResult = magicParserRef.current?.feedLine(stripped);
        if (magicResult) {
          handleMagicParseRef.current(magicResult);
        }

        if (triggerFiringRef.current) return;
        const matches = matchTriggers(stripped, raw, mergedTriggersRef.current);
        if (matches.length === 0) return;

        let gag = false;
        let highlight: string | null = null;

        for (const match of matches) {
          if (match.trigger.gag) gag = true;
          if (match.trigger.highlight) highlight = match.trigger.highlight;

          // Expand and execute trigger body asynchronously
          if (match.trigger.body.trim()) {
            const commands = expandTriggerBody(
              match.trigger.body,
              match,
              activeCharacterRef.current,
              mergedVariablesRef.current,
            );
            triggerFiringRef.current = true;
            (async () => {
              try {
                await executeCommands(commands, triggerRunnerRef.current);
              } finally {
                triggerFiringRef.current = false;
              }
            })();
          }
        }

        return { gag, highlight };
      },
    });
  }

  // Keep filter flags in sync with OutputFilter + persist
  useEffect(() => {
    if (outputFilterRef.current) {
      outputFilterRef.current.filterFlags = { ...filterFlags };
    }
    // Don't persist until settings are loaded — prevents defaults from overwriting synced values
    if (!settingsLoadedRef.current) return;
    dataStore.set('settings.json', 'filteredStatuses', filterFlags).catch(console.error);
  }, [filterFlags]);

  // Keep board date conversion in sync with OutputFilter
  useEffect(() => {
    if (outputFilterRef.current) {
      outputFilterRef.current.boardDatesEnabled = boardDatesEnabled;
    }
  }, [boardDatesEnabled]);

  // Keep prompt stripping in sync with OutputFilter
  useEffect(() => {
    if (outputFilterRef.current) {
      outputFilterRef.current.stripPrompts = stripPromptsEnabled;
    }
  }, [stripPromptsEnabled]);

  // Persist per-readout compact state
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    dataStore.set('settings.json', 'compactReadouts', compactReadouts).catch(console.error);
  }, [compactReadouts]);

  // Suppress transitions during active window resize to prevent breakpoint flash
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      document.documentElement.classList.add('resizing');
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        document.documentElement.classList.remove('resizing');
      }, 150);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
      document.documentElement.classList.remove('resizing');
    };
  }, []);

  // Responsive status bar: auto-compact when overflowing.
  const autoCompactThresholdRef = useRef(0);
  useLayoutEffect(() => {
    const el = statusBarRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      if (!autoCompact && el.scrollWidth > width) {
        autoCompactThresholdRef.current = el.scrollWidth;
        setAutoCompact(true);
      } else if (autoCompact && width >= autoCompactThresholdRef.current) {
        setAutoCompact(false);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoCompact]);

  const toggleCompactReadout = useCallback((key: string) => {
    setCompactReadouts((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Skill tracker — needs sendCommand ref (set after useMudConnection)
  const sendCommandRef = useRef<((cmd: string) => Promise<void>) | null>(null);
  const { activeCharacter, skillData, setActiveCharacter, handleSkillMatch, showInlineImproves, toggleInlineImproves, addSkill, updateSkillCount, deleteSkill } =
    useSkillTracker(sendCommandRef, processorRef, terminalRef, dataStore);

  // Improve counter hook
  const improveCounters = useImproveCounters();
  const { handleCounterMatch } = improveCounters;
  const handleCounterMatchRef = useLatestRef(handleCounterMatch);

  // Alias system
  const aliasState = useAliases(dataStore, activeCharacter);
  const { mergedAliases, enableSpeedwalk } = aliasState;
  const mergedAliasesRef = useLatestRef(mergedAliases);
  const enableSpeedwalkRef = useLatestRef(enableSpeedwalk);
  const activeCharacterRef = useLatestRef(activeCharacter);

  // Variable system
  const variableState = useVariables(dataStore, activeCharacter);
  const { mergedVariables, setVariable: setVar, deleteVariableByName } = variableState;
  const mergedVariablesRef = useLatestRef(mergedVariables);
  const setVarRef = useLatestRef(setVar);
  const deleteVariableByNameRef = useLatestRef(deleteVariableByName);

  // Trigger system
  const triggerState = useTriggers(dataStore, activeCharacter);
  const { mergedTriggers } = triggerState;
  const mergedTriggersRef = useLatestRef(mergedTriggers);
  const triggerFiringRef = useRef(false);
  const triggerRunnerRef = useRef<CommandRunner>({
    send: async () => {},
    echo: () => {},
    expand: () => [],
  });

  // Signature mapping system
  const signatureState = useSignatureMappings(dataStore, activeCharacter);
  const { resolveSignature } = signatureState;
  const resolveSignatureRef = useLatestRef(resolveSignature);

  // Map tracker
  const mapTracker = useMapTracker(dataStore, activeCharacter);
  const mapFeedLineRef = useLatestRef(mapTracker.feedLine);
  const mapTrackCommandRef = useLatestRef(mapTracker.trackCommand);

  // Allocation tracker
  const allocState = useAllocations(sendCommandRef, dataStore, activeCharacter);
  const handleAllocParseRef = useLatestRef(allocState.handleAllocParse);
  const handleMagicParseRef = useLatestRef(allocState.handleMagicParse);
  const liveAllocationsRef = useLatestRef(allocState.data.liveAllocations);
  const liveMagicAllocRef = useLatestRef(allocState.magicData.liveAllocation);
  const allocParserRef = useRef<AllocLineParser | null>(null);
  if (!allocParserRef.current) {
    allocParserRef.current = new AllocLineParser();
  }
  const magicParserRef = useRef<MagicLineParser | null>(null);
  if (!magicParserRef.current) {
    magicParserRef.current = new MagicLineParser();
  }

  // Wire up deferred flush so the parser can fire handleAllocParse via timeout.
  useEffect(() => {
    allocParserRef.current?.setFlushCallback((result) => {
      handleAllocParseRef.current(result);
    });
  }, []);

  // Keep OutputFilter's activeCharacter in sync for chat own-message detection
  useEffect(() => {
    if (outputFilterRef.current) {
      outputFilterRef.current.activeCharacter = activeCharacter;
    }
  }, [activeCharacter]);

  // Keep OutputFilter's signature resolver in sync
  useEffect(() => {
    if (outputFilterRef.current) {
      outputFilterRef.current.signatureResolver = (msg) => resolveSignatureRef.current(msg);
    }
  }, []);

  // Session logging ref (populated after useMudConnection provides passwordMode)
  const logOutputRef = useRef<((data: string) => void) | null>(null);
  const logCommandRef = useRef<((cmd: string) => void) | null>(null);

  // Process output chunks through the skill detection pipeline + buffer for tab completion
  const onOutputChunk = useCallback((data: string) => {
    logOutputRef.current?.(data);

    const matches = processorRef.current?.processChunk(data);
    if (!matches) return;
    for (const match of matches) {
      handleSkillMatch(match);
      handleCounterMatchRef.current(match);
    }

    // Buffer recent lines for tab completion
    const stripped = stripAnsi(data);
    const lines = stripped.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 0) {
      recentLinesRef.current = [...lines, ...recentLinesRef.current].slice(0, MAX_RECENT_LINES);
    }
  }, [handleSkillMatch]);

  const onCharacterName = useCallback((name: string) => {
    setActiveCharacter(name);
  }, [setActiveCharacter]);

  const onLogin = useCallback(() => {
    outputFilterRef.current?.startSync();
    for (const cmd of LOGIN_COMMANDS) {
      sendCommandRef.current?.(cmd);
    }
    setLoggedIn(true);
  }, []);

  const transport = useTransport();

  const { connected, passwordMode, skipHistory, sendCommand, reconnect, disconnect } =
    useMudConnection(terminalRef, debugModeRef, transport, onOutputChunk, onCharacterName, outputFilterRef, onLogin);

  // Session logger
  const { logOutput, logCommand } = useSessionLogger(appSettings.sessionLoggingEnabled, passwordMode, appSettings.timestampFormat);
  logOutputRef.current = logOutput;
  logCommandRef.current = logCommand;

  // Keep sendCommand ref up to date for login commands
  sendCommandRef.current = sendCommand;

  // Keep trigger runner in sync for use in the output filter closure
  triggerRunnerRef.current = {
    send: async (text) => { await sendCommandRef.current?.(text); },
    echo: (text) => {
      if (terminalRef.current) {
        smartWrite(terminalRef.current, `\x1b[36m${text}\x1b[0m\r\n`);
      }
    },
    expand: (input) => expandInput(input, mergedAliasesRef.current, {
      enableSpeedwalk: enableSpeedwalkRef.current,
      activeCharacter: activeCharacterRef.current,
      variables: mergedVariablesRef.current,
    }).commands,
  };

  // Command echo ref (used in handleSend callback)
  const commandEchoRef = useLatestRef(appSettings.commandEchoEnabled);
  const passwordModeRef = useLatestRef(passwordMode);

  // Alias-expanded send: preprocesses input through the alias engine
  const handleSend = useCallback(async (rawInput: string) => {
    // Command echo — write dimmed line to terminal before processing
    if (commandEchoRef.current && terminalRef.current && rawInput.trim()) {
      if (passwordModeRef.current) {
        smartWrite(terminalRef.current, '\x1b[90m> ******\x1b[0m\r\n');
      } else {
        smartWrite(terminalRef.current, `\x1b[90m> ${rawInput}\x1b[0m\r\n`);
      }
    }

    // Session logging — log sent command
    if (rawInput.trim()) logCommandRef.current?.(rawInput);

    // Built-in /convert command — intercept before alias expansion
    if (/^\/convert\b/i.test(rawInput.trim())) {
      if (terminalRef.current) {
        const parsed = parseConvertCommand(rawInput.trim());
        if (typeof parsed === 'string') {
          smartWrite(terminalRef.current, `\x1b[31m${parsed}\x1b[0m\r\n`);
        } else {
          const output = formatMultiConversion(parsed);
          smartWrite(terminalRef.current, `${output}\r\n`);
        }
      }
      return;
    }

    // Built-in /var command — manage user variables
    if (/^\/var\b/i.test(rawInput.trim())) {
      const varInput = rawInput.trim().slice(4).trim();
      if (terminalRef.current) {
        if (!varInput) {
          // /var — list all variables
          const vars = mergedVariablesRef.current.filter((v) => v.enabled);
          if (vars.length === 0) {
            smartWrite(terminalRef.current, '\x1b[36mNo variables set.\x1b[0m\r\n');
          } else {
            smartWrite(terminalRef.current, '\x1b[36m--- Variables ---\x1b[0m\r\n');
            for (const v of vars) {
              smartWrite(terminalRef.current, `\x1b[36m  $${v.name} = ${v.value}\x1b[0m\r\n`);
            }
          }
        } else if (varInput.startsWith('-d ')) {
          // /var -d <name> — delete variable
          const name = varInput.slice(3).trim();
          if (deleteVariableByNameRef.current(name)) {
            smartWrite(terminalRef.current, `\x1b[36mDeleted variable $${name}\x1b[0m\r\n`);
          } else {
            smartWrite(terminalRef.current, `\x1b[31mVariable "$${name}" not found.\x1b[0m\r\n`);
          }
        } else {
          // /var <name> <value> or /var -g <name> <value>
          let scope: 'character' | 'global' = 'character';
          let rest = varInput;
          if (rest.startsWith('-g ')) {
            scope = 'global';
            rest = rest.slice(3).trim();
          }
          const spaceIdx = rest.indexOf(' ');
          if (spaceIdx === -1) {
            smartWrite(terminalRef.current, `\x1b[31mUsage: /var <name> <value>  |  /var -g <name> <value>  |  /var -d <name>  |  /var\x1b[0m\r\n`);
          } else {
            const name = rest.slice(0, spaceIdx);
            const value = rest.slice(spaceIdx + 1);
            setVarRef.current(name, value, scope);
            smartWrite(terminalRef.current, `\x1b[36m$${name} = ${value} (${scope})\x1b[0m\r\n`);
          }
        }
      }
      return;
    }

    const result = expandInput(rawInput, mergedAliasesRef.current, {
      enableSpeedwalk: enableSpeedwalkRef.current,
      activeCharacter: activeCharacterRef.current,
      variables: mergedVariablesRef.current,
    });
    await executeCommands(result.commands, {
      send: async (text) => {
        mapTrackCommandRef.current(text);
        await sendCommand(text);
        // Update live allocs directly from outgoing set commands
        const parsed = parseAllocCommand(text);
        if (parsed) {
          const base = liveAllocationsRef.current[parsed.limb]
            ?? { bonus: 0, daring: 0, speed: 0, aiming: 0, parry: 0, control: 0 };
          const updated = applyAllocUpdates(base, parsed.updates);
          handleAllocParseRef.current({
            limbs: [{ limb: parsed.limb, alloc: updated, null: 0 }],
          });
        }
        // Update live magic allocs from outgoing set magic allocation commands
        const parsedMagic = parseMagicAllocCommand(text);
        if (parsedMagic) {
          const base = liveMagicAllocRef.current;
          const updated = applyMagicAllocUpdates(base, parsedMagic.updates, parsedMagic.reset);
          handleMagicParseRef.current({ alloc: updated, arcane: 0 });
        }
      },
      echo: (text) => {
        if (terminalRef.current) {
          smartWrite(terminalRef.current, `\x1b[36m${text}\x1b[0m\r\n`);
        }
      },
      expand: (input) => expandInput(input, mergedAliasesRef.current, {
        enableSpeedwalk: enableSpeedwalkRef.current,
        activeCharacter: activeCharacterRef.current,
        variables: mergedVariablesRef.current,
      }).commands,
    });
  }, [sendCommand]);

  // Clear logged-in state and reset trigger cooldowns on disconnect
  useEffect(() => {
    if (!connected) {
      setLoggedIn(false);
      resetTriggerCooldowns();
    }
  }, [connected]);

  const toggleDebug = () => {
    const next = !debugMode;
    debugModeRef.current = next;
    setDebugMode(next);
  };

  const toggleFilter = useCallback((key: keyof FilterFlags) => {
    setFilterFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Anti-idle timer — sends command at interval when connected + logged in + enabled
  const antiIdleEnabledRef = useLatestRef(antiIdleEnabled);
  const antiIdleCommandRef = useLatestRef(antiIdleCommand);
  const [antiIdleNextAt, setAntiIdleNextAt] = useState<number | null>(null);

  useEffect(() => {
    if (!connected || !loggedIn || !antiIdleEnabled) {
      setAntiIdleNextAt(null);
      return;
    }
    const ms = antiIdleMinutes * 60_000;
    setAntiIdleNextAt(Date.now() + ms);
    const id = setInterval(() => {
      const cmd = antiIdleCommandRef.current;
      if (sendCommandRef.current && antiIdleEnabledRef.current) {
        sendCommandRef.current(cmd);
        if (terminalRef.current) {
          smartWrite(terminalRef.current, `\x1b[90m[anti-idle: ${cmd}]\x1b[0m\r\n`);
        }
      }
      setAntiIdleNextAt(Date.now() + ms);
    }, ms);
    return () => { clearInterval(id); setAntiIdleNextAt(null); };
  }, [connected, loggedIn, antiIdleEnabled, antiIdleMinutes]);

  const isDanger = (tc: string) => tc === 'red' || tc === 'brightRed' || tc === 'magenta';

  const renderReadout = (
    key: string,
    data: { label: string; themeColor: ThemeColorKey; severity: number } | null,
    icon: React.ReactNode,
    tooltip: string,
    filterKey?: keyof FilterFlags,
  ) => data && (
    <StatusReadout
      key={key}
      icon={icon}
      label={data.label}
      color={theme[data.themeColor]}
      tooltip={tooltip}
      glow={data.severity <= 1}
      danger={isDanger(data.themeColor)}
      compact={autoCompact || !!compactReadouts[key]}
      autoCompact={autoCompact}
      filtered={filterKey ? filterFlags[filterKey] : undefined}
      onClick={filterKey ? () => toggleFilter(filterKey) : undefined}
      onToggleCompact={() => toggleCompactReadout(key)}
    />
  );

  const skillTrackerValue = useMemo(() => (
    { activeCharacter, skillData, showInlineImproves, toggleInlineImproves, addSkill, updateSkillCount, deleteSkill }
  ), [activeCharacter, skillData, showInlineImproves, toggleInlineImproves, addSkill, updateSkillCount, deleteSkill]);

  const chatValue = useMemo(() => (
    { messages: chatMessages, filters: chatFilters, mutedSenders, soundAlerts: chatSoundAlerts, newestFirst: chatNewestFirst, toggleFilter: toggleChatFilter, setAllFilters: setAllChatFilters, toggleSoundAlert: toggleChatSoundAlert, toggleNewestFirst: toggleChatNewestFirst, muteSender, unmuteSender, updateSender }
  ), [chatMessages, chatFilters, mutedSenders, chatSoundAlerts, chatNewestFirst, toggleChatFilter, setAllChatFilters, toggleChatSoundAlert, toggleChatNewestFirst, muteSender, unmuteSender, updateSender]);

  const counterValue = useMemo(() => improveCounters,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are stable (useCallback), only state values change
    [improveCounters.counters, improveCounters.activeCounterId, improveCounters.periodLengthMinutes]);

  // Toggle active counter: stopped→running, running→paused, paused→running
  const toggleActiveCounter = useCallback(() => {
    const { activeCounterId, counters, startCounter, pauseCounter, resumeCounter } = improveCounters;
    if (!activeCounterId) return;
    const counter = counters.find((c) => c.id === activeCounterId);
    if (!counter) return;
    if (counter.status === 'running') pauseCounter(activeCounterId);
    else if (counter.status === 'paused') resumeCounter(activeCounterId);
    else startCounter(activeCounterId);
  }, [improveCounters]);

  return (
    <AppSettingsProvider value={appSettings}>
    <VariableProvider value={variableState}>
    <AliasProvider value={aliasState}>
    <TriggerProvider value={triggerState}>
    <SignatureProvider value={signatureState}>
    <SkillTrackerProvider value={skillTrackerValue}>
    <ChatProvider value={chatValue}>
    <ImproveCounterProvider value={counterValue}>
    <MapProvider value={mapTracker}>
    <AllocProvider value={allocState}>
    <PanelProvider layout={panelLayout} activePanel={activePanel} togglePanel={togglePanel} pinPanel={pinPanel}>
    <div className="flex flex-col h-screen bg-bg-canvas text-text-primary relative p-1 gap-1">
      <Toolbar
        connected={connected}
        onReconnect={() => { reconnect(); requestAnimationFrame(() => inputRef.current?.focus()); }}
        onDisconnect={() => { disconnect(); requestAnimationFrame(() => inputRef.current?.focus()); }}
      />
      <div className="flex-1 overflow-hidden flex flex-row gap-1 relative">
        {/* Left pinned region */}
        <PinnedRegion
          side="left"
          panels={panelLayout.left}
          width={pinnedWidths.left}
          otherSidePanelCount={panelLayout.right.length}
          onUnpin={unpinPanel}
          onSwapSide={swapPanelSide}
          onMovePanel={movePanel}
        />
        {panelLayout.left.length > 0 && (
          <ResizeHandle side="left" onMouseDown={leftResize.handleMouseDown} isDragging={leftResize.isDragging} />
        )}

        {/* Center: Terminal */}
        <div className="flex-1 overflow-hidden flex flex-col rounded-lg">
          <Terminal terminalRef={terminalRef} inputRef={inputRef} theme={xtermTheme} display={display} onUpdateDisplay={updateDisplay} />
        </div>

        {panelLayout.right.length > 0 && (
          <ResizeHandle side="right" onMouseDown={rightResize.handleMouseDown} isDragging={rightResize.isDragging} />
        )}
        {/* Right pinned region */}
        <PinnedRegion
          side="right"
          panels={panelLayout.right}
          width={pinnedWidths.right}
          otherSidePanelCount={panelLayout.left.length}
          onUnpin={unpinPanel}
          onSwapSide={swapPanelSide}
          onMovePanel={movePanel}
        />

        {/* Slide-out overlays */}
        <SlideOut panel="appearance">
          <ColorSettings
            theme={theme}
            onUpdateColor={updateColor}
            onResetColor={resetColor}
            onReset={resetAll}
            display={display}
            onUpdateDisplay={updateDisplay}
            onResetDisplay={resetDisplay}
            debugMode={debugMode}
            onToggleDebug={toggleDebug}
          />
        </SlideOut>
        <SlideOut panel="settings">
          <SettingsPanel />
        </SlideOut>
        <SlideOut panel="skills" pinnable="skills">
          <SkillPanel mode="slideout" />
        </SlideOut>
        <SlideOut panel="chat" pinnable="chat">
          <ChatPanel mode="slideout" />
        </SlideOut>
        <SlideOut panel="counter" pinnable="counter">
          <CounterPanel mode="slideout" />
        </SlideOut>
        <SlideOut panel="notes" pinnable="notes">
          <NotesPanel mode="slideout" />
        </SlideOut>
        <SlideOut panel="aliases">
          <AliasPanel onClose={() => setActivePanel(null)} />
        </SlideOut>
        <SlideOut panel="triggers">
          <TriggerPanel onClose={() => setActivePanel(null)} />
        </SlideOut>
        <SlideOut panel="variables">
          <VariablePanel onClose={() => setActivePanel(null)} />
        </SlideOut>
        <SlideOut panel="map" pinnable="map">
          <MapPanel
            mode="slideout"
            onWalkTo={async (directions) => {
              for (const dir of directions) {
                await sendCommand(dir);
              }
            }}
          />
        </SlideOut>
        <SlideOut panel="alloc" pinnable="alloc">
          <AllocPanel mode="slideout" />
        </SlideOut>
        <SlideOut panel="currency" pinnable="currency">
          <CurrencyPanel mode="slideout" />
        </SlideOut>
      </div>
      {/* Bottom controls card — status bar + command input */}
      <div className="rounded-lg bg-bg-primary overflow-hidden">
      {/* Game status bar — vitals left, clock right */}
      <div
        ref={statusBarRef}
        className="flex items-center gap-1 px-1.5 py-0.5"
        style={{ background: 'linear-gradient(to bottom, #1e1e1e, #1a1a1a)' }}
      >
        {loggedIn && (
          <>
            {renderReadout('health', health, <HeartIcon size={11} />, health?.message ?? '')}
            {renderReadout('concentration', concentration, <FocusIcon size={11} />, concentration?.message ?? '', 'concentration')}
            {renderReadout('aura', aura, <AuraIcon size={11} />, aura?.key === 'none' ? 'You have no aura.' : `Your aura appears to be ${aura?.descriptor}.`, 'aura')}
            {renderReadout('hunger', hunger, <FoodIcon size={11} />, `You are ${hunger?.descriptor}.`, 'hunger')}
            {renderReadout('thirst', thirst, <DropletIcon size={11} />, `You are ${thirst?.descriptor}.`, 'thirst')}
            {renderReadout('encumbrance', encumbrance, <WeightIcon size={11} />, encumbrance?.descriptor ?? '', 'encumbrance')}
            {renderReadout('movement', movement, <BootIcon size={11} />, movement?.descriptor ?? '', 'movement')}
          </>
        )}
        <div className="ml-auto">
          <GameClock
            compact={autoCompact || !!compactReadouts.clock}
            onToggleCompact={() => toggleCompactReadout('clock')}
          />
        </div>
      </div>
      <CommandInput
        ref={inputRef}
        onSend={handleSend}
        onReconnect={reconnect}
        onToggleCounter={toggleActiveCounter}
        disabled={!connected}
        connected={connected}
        passwordMode={passwordMode}
        skipHistory={skipHistory}
        recentLinesRef={recentLinesRef}
        antiIdleEnabled={antiIdleEnabled}
        antiIdleCommand={antiIdleCommand}
        antiIdleMinutes={antiIdleMinutes}
        antiIdleNextAt={antiIdleNextAt}
        onToggleAntiIdle={() => updateAntiIdleEnabled(!antiIdleEnabled)}
      />
      </div>
    </div>
    </PanelProvider>
    </AllocProvider>
    </MapProvider>
    </ImproveCounterProvider>
    </ChatProvider>
    </SkillTrackerProvider>
    </SignatureProvider>
    </TriggerProvider>
    </AliasProvider>
    </VariableProvider>
    </AppSettingsProvider>
  );
}

export default App;
