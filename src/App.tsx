import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
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
import { useConcentration } from './hooks/useConcentration';
import { useHealth } from './hooks/useHealth';
import { useNeeds } from './hooks/useNeeds';
import { useAura } from './hooks/useAura';
import { useEncumbrance } from './hooks/useEncumbrance';
import { useMovement } from './hooks/useMovement';
import { useDataStore } from './contexts/DataStoreContext';
import { buildXtermTheme } from './lib/defaultTheme';
import { OutputProcessor } from './lib/outputProcessor';
import { expandInput } from './lib/aliasEngine';
import { OutputFilter, DEFAULT_FILTER_FLAGS, type FilterFlags } from './lib/outputFilter';
import { matchSkillLine } from './lib/skillPatterns';
import { cn } from './lib/cn';

import type { Panel, PanelLayout, PinnablePanel, DockSide } from './types';
import { PinnedRegion } from './components/PinnedRegion';
import { SkillTrackerProvider } from './contexts/SkillTrackerContext';
import { ChatProvider } from './contexts/ChatContext';
import { ImproveCounterProvider } from './contexts/ImproveCounterContext';
import { AliasProvider } from './contexts/AliasContext';
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
import { MapPanel } from './components/MapPanel';

/** Commands to send automatically after login */
const LOGIN_COMMANDS = ['hp', 'score'];

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
  const panelLayoutLoadedRef = useRef(false);
  const [compactReadouts, setCompactReadouts] = useState<Record<string, boolean>>({});
  const [filterFlags, setFilterFlags] = useState<FilterFlags>({ ...DEFAULT_FILTER_FLAGS });
  const [loggedIn, setLoggedIn] = useState(false);
  const statusBarRef = useRef<HTMLDivElement | null>(null);
  const [autoCompact, setAutoCompact] = useState(false);

  // Anti-idle state
  const [antiIdleEnabled, setAntiIdleEnabled] = useState(false);
  const [antiIdleCommand, setAntiIdleCommand] = useState('hp');
  const [antiIdleMinutes, setAntiIdleMinutes] = useState(10);

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
      // Anti-idle settings
      const savedAntiIdleEnabled = await dataStore.get<boolean>('settings.json', 'antiIdleEnabled');
      if (savedAntiIdleEnabled != null) setAntiIdleEnabled(savedAntiIdleEnabled);
      const savedAntiIdleCommand = await dataStore.get<string>('settings.json', 'antiIdleCommand');
      if (savedAntiIdleCommand != null) setAntiIdleCommand(savedAntiIdleCommand);
      const savedAntiIdleMinutes = await dataStore.get<number>('settings.json', 'antiIdleMinutes');
      if (savedAntiIdleMinutes != null) setAntiIdleMinutes(savedAntiIdleMinutes);

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

  const isSkillsPinned = panelLayout.left.includes('skills') || panelLayout.right.includes('skills');
  const isChatPinned = panelLayout.left.includes('chat') || panelLayout.right.includes('chat');
  const isCounterPinned = panelLayout.left.includes('counter') || panelLayout.right.includes('counter');
  const isNotesPinned = panelLayout.left.includes('notes') || panelLayout.right.includes('notes');
  const isMapPinned = panelLayout.left.includes('map') || panelLayout.right.includes('map');

  // Persist panel layout
  useEffect(() => {
    if (!panelLayoutLoadedRef.current) return;
    dataStore.set('settings.json', 'panelLayout', panelLayout).catch(console.error);
  }, [panelLayout]);

  const { theme, updateColor, resetColor, display, updateDisplay, resetDisplay, resetAll } = useThemeColors();
  const xtermTheme = buildXtermTheme(theme);

  // Output processor for skill detection
  const processorRef = useRef<OutputProcessor | null>(null);
  if (!processorRef.current) {
    processorRef.current = new OutputProcessor();
    processorRef.current.registerMatcher(matchSkillLine);
  }

  // Chat messages hook
  const { messages: chatMessages, filters: chatFilters, mutedSenders, soundAlerts: chatSoundAlerts, newestFirst: chatNewestFirst, handleChatMessage, toggleFilter: toggleChatFilter, setAllFilters: setAllChatFilters, toggleSoundAlert: toggleChatSoundAlert, toggleNewestFirst: toggleChatNewestFirst, muteSender, unmuteSender, updateSender } =
    useChatMessages();
  const handleChatMessageRef = useRef(handleChatMessage);
  handleChatMessageRef.current = handleChatMessage;

  // Status trackers
  const { concentration, updateConcentration } = useConcentration();
  const updateConcentrationRef = useRef(updateConcentration);
  updateConcentrationRef.current = updateConcentration;

  const { health, updateHealth } = useHealth();
  const updateHealthRef = useRef(updateHealth);
  updateHealthRef.current = updateHealth;

  const { hunger, thirst, updateHunger, updateThirst } = useNeeds();
  const updateHungerRef = useRef(updateHunger);
  updateHungerRef.current = updateHunger;
  const updateThirstRef = useRef(updateThirst);
  updateThirstRef.current = updateThirst;

  const { aura, updateAura } = useAura();
  const updateAuraRef = useRef(updateAura);
  updateAuraRef.current = updateAura;

  const { encumbrance, updateEncumbrance } = useEncumbrance();
  const updateEncumbranceRef = useRef(updateEncumbrance);
  updateEncumbranceRef.current = updateEncumbrance;

  const { movement, updateMovement } = useMovement();
  const updateMovementRef = useRef(updateMovement);
  updateMovementRef.current = updateMovement;

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
            );
            triggerFiringRef.current = true;
            (async () => {
              try {
                for (const cmd of commands) {
                  switch (cmd.type) {
                    case 'send':
                      await sendCommandRef.current?.(cmd.text);
                      break;
                    case 'delay':
                      await new Promise<void>((r) => setTimeout(r, cmd.ms));
                      break;
                    case 'echo':
                      if (terminalRef.current) {
                        smartWrite(terminalRef.current, `\x1b[36m${cmd.text}\x1b[0m\r\n`);
                      }
                      break;
                  }
                }
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
  const handleCounterMatchRef = useRef(handleCounterMatch);
  handleCounterMatchRef.current = handleCounterMatch;

  // Alias system
  const aliasState = useAliases(dataStore, activeCharacter);
  const { mergedAliases, enableSpeedwalk } = aliasState;
  const mergedAliasesRef = useRef(mergedAliases);
  mergedAliasesRef.current = mergedAliases;
  const enableSpeedwalkRef = useRef(enableSpeedwalk);
  enableSpeedwalkRef.current = enableSpeedwalk;
  const activeCharacterRef = useRef(activeCharacter);
  activeCharacterRef.current = activeCharacter;

  // Trigger system
  const triggerState = useTriggers(dataStore, activeCharacter);
  const { mergedTriggers } = triggerState;
  const mergedTriggersRef = useRef(mergedTriggers);
  mergedTriggersRef.current = mergedTriggers;
  const triggerFiringRef = useRef(false);

  // Signature mapping system
  const signatureState = useSignatureMappings(dataStore, activeCharacter);
  const { resolveSignature } = signatureState;
  const resolveSignatureRef = useRef(resolveSignature);
  resolveSignatureRef.current = resolveSignature;

  // Map tracker
  const mapTracker = useMapTracker(dataStore, activeCharacter);
  const mapFeedLineRef = useRef(mapTracker.feedLine);
  mapFeedLineRef.current = mapTracker.feedLine;
  const mapTrackCommandRef = useRef(mapTracker.trackCommand);
  mapTrackCommandRef.current = mapTracker.trackCommand;

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

  // Process output chunks through the skill detection pipeline + buffer for tab completion
  const onOutputChunk = useCallback((data: string) => {
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
    outputFilterRef.current?.startSync(LOGIN_COMMANDS.length + 2);
    for (const cmd of LOGIN_COMMANDS) {
      sendCommandRef.current?.(cmd);
    }
    setLoggedIn(true);
  }, []);

  const transport = useTransport();

  const { connected, passwordMode, skipHistory, sendCommand, reconnect, disconnect } =
    useMudConnection(terminalRef, debugModeRef, transport, onOutputChunk, onCharacterName, outputFilterRef, onLogin);

  // Keep sendCommand ref up to date for login commands
  sendCommandRef.current = sendCommand;

  // Alias-expanded send: preprocesses input through the alias engine
  const handleSend = useCallback(async (rawInput: string) => {
    // Built-in #convert command — intercept before alias expansion
    if (/^#convert\b/i.test(rawInput.trim())) {
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

    const result = expandInput(rawInput, mergedAliasesRef.current, {
      enableSpeedwalk: enableSpeedwalkRef.current,
      activeCharacter: activeCharacterRef.current,
    });
    for (const cmd of result.commands) {
      switch (cmd.type) {
        case 'send':
          mapTrackCommandRef.current(cmd.text);
          await sendCommand(cmd.text);
          break;
        case 'delay':
          await new Promise<void>((r) => setTimeout(r, cmd.ms));
          break;
        case 'echo':
          if (terminalRef.current) {
            smartWrite(terminalRef.current, `\x1b[36m${cmd.text}\x1b[0m\r\n`);
          }
          break;
      }
    }
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

  // Anti-idle change handlers with persistence
  const handleAntiIdleEnabledChange = useCallback((v: boolean) => {
    setAntiIdleEnabled(v);
    dataStore.set('settings.json', 'antiIdleEnabled', v).catch(console.error);
  }, [dataStore]);
  const handleAntiIdleCommandChange = useCallback((v: string) => {
    setAntiIdleCommand(v);
    dataStore.set('settings.json', 'antiIdleCommand', v).catch(console.error);
  }, [dataStore]);
  const handleAntiIdleMinutesChange = useCallback((v: number) => {
    setAntiIdleMinutes(v);
    dataStore.set('settings.json', 'antiIdleMinutes', v).catch(console.error);
  }, [dataStore]);

  // Anti-idle timer — sends command at interval when connected + logged in + enabled
  const antiIdleEnabledRef = useRef(antiIdleEnabled);
  antiIdleEnabledRef.current = antiIdleEnabled;
  const antiIdleCommandRef = useRef(antiIdleCommand);
  antiIdleCommandRef.current = antiIdleCommand;
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

  const isDanger = (themeColor: string) =>
    themeColor === 'red' || themeColor === 'brightRed' || themeColor === 'magenta';

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
    <AliasProvider value={aliasState}>
    <TriggerProvider value={triggerState}>
    <SignatureProvider value={signatureState}>
    <SkillTrackerProvider value={skillTrackerValue}>
    <ChatProvider value={chatValue}>
    <ImproveCounterProvider value={counterValue}>
    <MapProvider value={mapTracker}>
    <div className="flex flex-col h-screen bg-bg-canvas text-text-primary relative p-1 gap-1">
      <Toolbar
        connected={connected}
        onReconnect={reconnect}
        onDisconnect={disconnect}
        showAppearance={activePanel === 'appearance'}
        onToggleAppearance={() => togglePanel('appearance')}
        showSkills={activePanel === 'skills'}
        onToggleSkills={() => togglePanel('skills')}
        skillsPinned={isSkillsPinned}
        showChat={activePanel === 'chat'}
        onToggleChat={() => togglePanel('chat')}
        chatPinned={isChatPinned}
        showCounter={activePanel === 'counter'}
        onToggleCounter={() => togglePanel('counter')}
        counterPinned={isCounterPinned}
        showNotes={activePanel === 'notes'}
        onToggleNotes={() => togglePanel('notes')}
        notesPinned={isNotesPinned}
        showAliases={activePanel === 'aliases'}
        onToggleAliases={() => togglePanel('aliases')}
        showTriggers={activePanel === 'triggers'}
        onToggleTriggers={() => togglePanel('triggers')}
        showSettings={activePanel === 'settings'}
        onToggleSettings={() => togglePanel('settings')}
        showMap={activePanel === 'map'}
        onToggleMap={() => togglePanel('map')}
        mapPinned={isMapPinned}
      />
      <div className="flex-1 overflow-hidden flex flex-row gap-1 relative">
        {/* Left pinned region */}
        <PinnedRegion
          side="left"
          panels={panelLayout.left}
          otherSidePanelCount={panelLayout.right.length}
          onUnpin={unpinPanel}
          onSwapSide={swapPanelSide}
          onMovePanel={movePanel}
        />

        {/* Center: Terminal */}
        <div className="flex-1 overflow-hidden flex flex-col rounded-lg">
          <Terminal terminalRef={terminalRef} inputRef={inputRef} theme={xtermTheme} display={display} onUpdateDisplay={updateDisplay} />
        </div>

        {/* Right pinned region */}
        <PinnedRegion
          side="right"
          panels={panelLayout.right}
          otherSidePanelCount={panelLayout.left.length}
          onUnpin={unpinPanel}
          onSwapSide={swapPanelSide}
          onMovePanel={movePanel}
        />

        {/* Slide-out overlays — anchored to right edge of window */}
        <div
          className={cn(
            'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
            activePanel === 'appearance' ? 'translate-x-0' : 'translate-x-full'
          )}
        >
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
        </div>
        <div
          className={cn(
            'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
            activePanel === 'settings' ? 'translate-x-0' : 'translate-x-full'
          )}
        >
          <SettingsPanel
            antiIdleEnabled={antiIdleEnabled}
            antiIdleCommand={antiIdleCommand}
            antiIdleMinutes={antiIdleMinutes}
            onAntiIdleEnabledChange={handleAntiIdleEnabledChange}
            onAntiIdleCommandChange={handleAntiIdleCommandChange}
            onAntiIdleMinutesChange={handleAntiIdleMinutesChange}
          />
        </div>
        {/* Skills slide-out — only when NOT pinned */}
        {!isSkillsPinned && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
              activePanel === 'skills' ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <SkillPanel
              mode="slideout"
              onPin={(side) => pinPanel('skills', side)}
            />
          </div>
        )}
        {/* Chat slide-out — only when NOT pinned */}
        {!isChatPinned && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
              activePanel === 'chat' ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <ChatPanel
              mode="slideout"
              onPin={(side) => pinPanel('chat', side)}
            />
          </div>
        )}
        {/* Counter slide-out — only when NOT pinned */}
        {!isCounterPinned && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
              activePanel === 'counter' ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <CounterPanel
              mode="slideout"
              onPin={(side) => pinPanel('counter', side)}
            />
          </div>
        )}
        {/* Notes slide-out — only when NOT pinned */}
        {!isNotesPinned && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
              activePanel === 'notes' ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <NotesPanel
              mode="slideout"
              onPin={(side) => pinPanel('notes', side)}
            />
          </div>
        )}
        {/* Aliases slide-out — slideout only, no pinning */}
        <div
          className={cn(
            'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
            activePanel === 'aliases' ? 'translate-x-0' : 'translate-x-full'
          )}
        >
          <AliasPanel onClose={() => setActivePanel(null)} />
        </div>
        {/* Triggers slide-out — slideout only, no pinning */}
        <div
          className={cn(
            'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
            activePanel === 'triggers' ? 'translate-x-0' : 'translate-x-full'
          )}
        >
          <TriggerPanel onClose={() => setActivePanel(null)} />
        </div>
        {/* Map slide-out — only when NOT pinned */}
        {!isMapPinned && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
              activePanel === 'map' ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <MapPanel
              mode="slideout"
              onPin={(side) => pinPanel('map', side)}
              onWalkTo={async (directions) => {
                for (const dir of directions) {
                  await sendCommand(dir);
                }
              }}
            />
          </div>
        )}
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
            {health && (
              <StatusReadout
                icon={<HeartIcon size={11} />}
                label={health.label}
                color={theme[health.themeColor]}
                tooltip={health.message}
                glow={health.severity <= 1}
                danger={isDanger(health.themeColor)}
                compact={autoCompact || !!compactReadouts.health}
                autoCompact={autoCompact}
                onToggleCompact={() => toggleCompactReadout('health')}
              />
            )}
            {concentration && (
              <StatusReadout
                icon={<FocusIcon size={11} />}
                label={concentration.label}
                color={theme[concentration.themeColor]}
                tooltip={concentration.message}
                glow={concentration.severity <= 1}
                danger={isDanger(concentration.themeColor)}
                compact={autoCompact || !!compactReadouts.concentration}
                autoCompact={autoCompact}
                filtered={filterFlags.concentration}
                onClick={() => toggleFilter('concentration')}
                onToggleCompact={() => toggleCompactReadout('concentration')}
              />
            )}
            {aura && (
              <StatusReadout
                icon={<AuraIcon size={11} />}
                label={aura.label}
                color={theme[aura.themeColor]}
                tooltip={aura.key === 'none' ? 'You have no aura.' : `Your aura appears to be ${aura.descriptor}.`}
                glow={aura.severity <= 1}
                danger={isDanger(aura.themeColor)}
                compact={autoCompact || !!compactReadouts.aura}
                autoCompact={autoCompact}
                filtered={filterFlags.aura}
                onClick={() => toggleFilter('aura')}
                onToggleCompact={() => toggleCompactReadout('aura')}
              />
            )}
            {hunger && (
              <StatusReadout
                icon={<FoodIcon size={11} />}
                label={hunger.label}
                color={theme[hunger.themeColor]}
                tooltip={`You are ${hunger.descriptor}.`}
                glow={hunger.severity <= 1}
                danger={isDanger(hunger.themeColor)}
                compact={autoCompact || !!compactReadouts.hunger}
                autoCompact={autoCompact}
                filtered={filterFlags.hunger}
                onClick={() => toggleFilter('hunger')}
                onToggleCompact={() => toggleCompactReadout('hunger')}
              />
            )}
            {thirst && (
              <StatusReadout
                icon={<DropletIcon size={11} />}
                label={thirst.label}
                color={theme[thirst.themeColor]}
                tooltip={`You are ${thirst.descriptor}.`}
                glow={thirst.severity <= 1}
                danger={isDanger(thirst.themeColor)}
                compact={autoCompact || !!compactReadouts.thirst}
                autoCompact={autoCompact}
                filtered={filterFlags.thirst}
                onClick={() => toggleFilter('thirst')}
                onToggleCompact={() => toggleCompactReadout('thirst')}
              />
            )}
            {encumbrance && (
              <StatusReadout
                icon={<WeightIcon size={11} />}
                label={encumbrance.label}
                color={theme[encumbrance.themeColor]}
                tooltip={encumbrance.descriptor}
                glow={encumbrance.severity <= 1}
                danger={isDanger(encumbrance.themeColor)}
                compact={autoCompact || !!compactReadouts.encumbrance}
                autoCompact={autoCompact}
                filtered={filterFlags.encumbrance}
                onClick={() => toggleFilter('encumbrance')}
                onToggleCompact={() => toggleCompactReadout('encumbrance')}
              />
            )}
            {movement && (
              <StatusReadout
                icon={<BootIcon size={11} />}
                label={movement.label}
                color={theme[movement.themeColor]}
                tooltip={movement.descriptor}
                glow={movement.severity <= 1}
                danger={isDanger(movement.themeColor)}
                compact={autoCompact || !!compactReadouts.movement}
                autoCompact={autoCompact}
                filtered={filterFlags.movement}
                onClick={() => toggleFilter('movement')}
                onToggleCompact={() => toggleCompactReadout('movement')}
              />
            )}
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
        onToggleAntiIdle={() => handleAntiIdleEnabledChange(!antiIdleEnabled)}
      />
      </div>
    </div>
    </MapProvider>
    </ImproveCounterProvider>
    </ChatProvider>
    </SkillTrackerProvider>
    </SignatureProvider>
    </TriggerProvider>
    </AliasProvider>
  );
}

export default App;
