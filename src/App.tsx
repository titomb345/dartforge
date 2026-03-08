import { useRef, useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { useLatestRef } from './hooks/useLatestRef';
import type { Terminal as XTerm } from '@xterm/xterm';
import { getPlatform, getAppVersion, setWindowTitle } from './lib/platform';
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
import {
  SortableStatusBar,
  DEFAULT_STATUS_BAR_ORDER,
  type StatusReadoutKey,
  type ReadoutConfig,
} from './components/SortableStatusBar';
import {
  HeartIcon,
  FocusIcon,
  FoodIcon,
  DropletIcon,
  AuraIcon,
  WeightIcon,
  BootIcon,
  AlignmentIcon,
} from './components/icons';
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
import { useAlignment } from './hooks/useAlignment';
import { useDataStore } from './contexts/DataStoreContext';
import { buildXtermTheme } from './lib/defaultTheme';
import { OutputProcessor } from './lib/outputProcessor';
import { expandInput, matchAlias } from './lib/aliasEngine';
import { executeCommands, type CommandRunner } from './lib/commandUtils';
import { OutputFilter, DEFAULT_FILTER_FLAGS, type FilterFlags } from './lib/outputFilter';
import { matchSkillLine } from './lib/skillPatterns';
import type { Panel, PanelLayout, PinnablePanel, DockSide } from './types';
import { PinnedRegion } from './components/PinnedRegion';
import { CollapsedPanelStrip } from './components/CollapsedPanelStrip';
import { SlideOut } from './components/SlideOut';
import { SkillTrackerProvider } from './contexts/SkillTrackerContext';
import { ChatProvider } from './contexts/ChatContext';
import { ImproveCounterProvider } from './contexts/ImproveCounterContext';
import { AliasProvider } from './contexts/AliasContext';
import { VariableProvider } from './contexts/VariableContext';
import { VariablePanel } from './components/VariablePanel';
import { AliasPanel } from './components/AliasPanel';
import { TriggerProvider } from './contexts/TriggerContext';
import { NotesProvider, useNotesContext } from './contexts/NotesContext';
import { TriggerPanel } from './components/TriggerPanel';
import { useTriggers } from './hooks/useTriggers';
import { useTimers } from './hooks/useTimers';
import { TimerProvider } from './contexts/TimerContext';
import { TimerPanel } from './components/TimerPanel';
import { useSignatureMappings } from './hooks/useSignatureMappings';
import { matchTriggers, expandTriggerBody, resetTriggerCooldowns } from './lib/triggerEngine';
import { executeTriggerScript, executeAliasScript, stampUserInput } from './lib/scriptEngine';
import { useGlobalScript } from './hooks/useGlobalScript';
import { ScriptPanel } from './components/ScriptPanel';
import { smartWrite } from './lib/terminalUtils';
import { captureTerminalScreenshot } from './lib/screenshotCapture';
import { ActionBlocker } from './lib/actionBlocker';
import { AutoInscriber } from './lib/autoInscriber';
import { AutoCaster } from './lib/autoCaster';
import { AutoConc } from './lib/autoConc';
import { useEngineRef } from './hooks/useEngineRef';
import { type MovementMode, getNextMode, applyMovementMode, movementModeLabel } from './lib/movementMode';
import { queryHour, getTimeOfDay, formatDate, getHoliday, Reckoning } from './lib/dartDate';
import { shouldGagLine, NpcGagTracker } from './lib/gagPatterns';
import { transformSkillReadout } from './lib/skillReadoutTransform';
import { stripAnsi } from './lib/ansiUtils';
import { SignatureProvider } from './contexts/SignatureContext';
import { parseConvertCommand, formatMultiConversion } from './lib/currency';
import { dispatchBuiltinCommand, type BuiltinContext } from './lib/builtinCommands';
// Automapper disabled
// import { useMapTracker } from './hooks/useMapTracker';
// import { MapProvider } from './contexts/MapContext';
import { PanelProvider } from './contexts/PanelLayoutContext';
// import { MapPanel } from './components/MapPanel';
import { useAllocations } from './hooks/useAllocations';
import { AllocProvider } from './contexts/AllocContext';
import { AllocPanel } from './components/AllocPanel';
import { CurrencyPanel } from './components/CurrencyPanel';
import { BabelPanel } from './components/BabelPanel';
import { WhoPanel } from './components/WhoPanel';
import { WhoProvider } from './contexts/WhoContext';
import { WhoTitleProvider } from './contexts/WhoTitleContext';
import { useWhoTitleMappings } from './hooks/useWhoTitleMappings';
import type { WhoSnapshot } from './lib/whoPatterns';
import { ResizeHandle } from './components/ResizeHandle';
import { useResize } from './hooks/useResize';
import { useViewportBudget, MIN_TERMINAL_WIDTH } from './hooks/useViewportBudget';
import {
  AllocLineParser,
  parseAllocCommand,
  applyAllocUpdates,
  MagicLineParser,
  parseMagicAllocCommand,
  applyMagicAllocUpdates,
} from './lib/allocPatterns';
import { useAppSettings } from './hooks/useAppSettings';
import type { AutoLoginConfig } from './hooks/useMudConnection';
import { useCommandHistory } from './hooks/useCommandHistory';
import { usePersistedCRUD } from './hooks/usePersistedCRUD';
import { useTimerEngines } from './hooks/useTimerEngines';
import { CommandInputProvider } from './contexts/CommandInputContext';
import { TerminalThemeProvider } from './contexts/TerminalThemeContext';
import { useSessionLogger } from './hooks/useSessionLogger';
import { useSoundLibrary } from './hooks/useSoundLibrary';
import { AppSettingsProvider } from './contexts/AppSettingsContext';
import { SpotlightProvider } from './contexts/SpotlightContext';
import { SpotlightOverlay } from './components/SpotlightOverlay';
import { HelpPanel } from './components/HelpPanel';
import { LogViewerPanel } from './components/LogViewerPanel';
import { QuickButtonBar } from './components/QuickButtonBar';
import { MacroPanel } from './components/MacroPanel';
import type { QuickButton, Macro } from './types';
import { hotkeyToString, hotkeyFromEvent, isNumpadKey } from './types';

/** Commands to send automatically after login */
const LOGIN_COMMANDS = [
  'hp',
  'score',
  'show combat allocation:all',
  'show magic allocation',
  'show alignment',
  'who',
];

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
    getAppVersion()
      .then((v) => {
        setWindowTitle(`DartForge v${v}`);
      })
      .catch(console.error);
  }, []);

  if (dataStore.needsSetup) {
    return <SetupDialog />;
  }

  if (!dataStore.ready) {
    return null;
  }

  return (
    <NotesProvider>
      <AppMain />
    </NotesProvider>
  );
}

/** Main client — only mounts after data location is configured and ready. */
function AppMain() {
  const terminalRef = useRef<XTerm | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const recentLinesRef = useRef<string[]>([]);
  const debugModeRef = useRef(false);
  const [debugMode, setDebugMode] = useState(false);
  const [activePanel, setActivePanel] = useState<Panel | null>(null);
  const togglePanel = useCallback((panel: Panel) => setActivePanel((v) => (v === panel ? null : panel)), []);
  const closePanel = useCallback(() => setActivePanel(null), []);
  const writeToTerm = useCallback(
    (text: string) => {
      if (terminalRef.current) smartWrite(terminalRef.current, text);
    },
    []
  );
  const [panelLayout, setPanelLayout] = useState<PanelLayout>({ left: [], right: [] });
  const [pinnedWidths, setPinnedWidths] = useState<{ left: number; right: number }>({
    left: 320,
    right: 320,
  });
  const [panelHeights, setPanelHeights] = useState<{ left: number[]; right: number[] }>({
    left: [],
    right: [],
  });
  const [collapsedSides, setCollapsedSides] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  const panelLayoutLoadedRef = useRef(false);
  const [compactReadouts, setCompactReadouts] = useState<Record<string, boolean>>({});
  const [filterFlags, setFilterFlags] = useState<FilterFlags>({ ...DEFAULT_FILTER_FLAGS });
  const [statusBarOrder, setStatusBarOrder] = useState<StatusReadoutKey[]>([
    ...DEFAULT_STATUS_BAR_ORDER,
  ]);
  const [loggedIn, setLoggedIn] = useState(false);
  const statusBarRef = useRef<HTMLDivElement | null>(null);
  const [autoCompact, setAutoCompact] = useState(false);
  const appSettings = useAppSettings();
  const {
    antiIdleEnabled,
    antiIdleCommand,
    antiIdleMinutes,
    alignmentTrackingEnabled,
    alignmentTrackingMinutes,
    boardDatesEnabled,
    stripPromptsEnabled,
    antiSpamEnabled,
    postSyncEnabled,
    postSyncCommands,
    autoLoginEnabled,
    autoLoginActiveSlot,
    autoLoginCharacters,
  } = appSettings;

  // Auto-login ref — kept in sync with settings, passed to useMudConnection
  const autoLoginRef = useRef<AutoLoginConfig | null>(null);
  useEffect(() => {
    const activeChar = autoLoginCharacters[autoLoginActiveSlot];
    if (autoLoginEnabled && activeChar?.name && activeChar?.password) {
      autoLoginRef.current = {
        enabled: true,
        name: activeChar.name,
        password: activeChar.password,
      };
    } else {
      autoLoginRef.current = null;
    }
  }, [autoLoginEnabled, autoLoginActiveSlot, autoLoginCharacters]);

  const dataStore = useDataStore();
  const settingsLoadedRef = useRef(false);
  const { commandHistory, handleHistoryChange } = useCommandHistory(dataStore);
  const quickButtonsCRUD = usePersistedCRUD<QuickButton>(dataStore, 'quickButtons');
  const macrosCRUD = usePersistedCRUD<Macro>(dataStore, 'macros');

  // Load compact mode + filter flags + panel layout from settings (with validation)
  useEffect(() => {
    (async () => {
      const savedCompact = await dataStore.get<Record<string, boolean>>(
        'settings.json',
        'compactReadouts'
      );
      if (
        savedCompact != null &&
        typeof savedCompact === 'object' &&
        !Array.isArray(savedCompact)
      ) {
        setCompactReadouts(savedCompact);
      }
      const savedFilters = await dataStore.get<FilterFlags>('settings.json', 'filteredStatuses');
      if (
        savedFilters != null &&
        typeof savedFilters === 'object' &&
        !Array.isArray(savedFilters)
      ) {
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
      const savedWidths = await dataStore.get<{ left: number; right: number }>(
        'settings.json',
        'pinnedWidths'
      );
      if (
        savedWidths != null &&
        typeof savedWidths.left === 'number' &&
        typeof savedWidths.right === 'number'
      ) {
        setPinnedWidths(savedWidths);
      }
      const savedHeights = await dataStore.get<{ left: number[]; right: number[] }>(
        'settings.json',
        'panelHeights'
      );
      if (
        savedHeights != null &&
        Array.isArray(savedHeights.left) &&
        Array.isArray(savedHeights.right)
      ) {
        setPanelHeights(savedHeights);
      }
      const savedCollapsed = await dataStore.get<{ left: boolean; right: boolean }>(
        'settings.json',
        'collapsedSides'
      );
      if (
        savedCollapsed != null &&
        typeof savedCollapsed.left === 'boolean' &&
        typeof savedCollapsed.right === 'boolean'
      ) {
        setCollapsedSides(savedCollapsed);
      }
      const savedStatusOrder = await dataStore.get<StatusReadoutKey[]>(
        'settings.json',
        'statusBarOrder'
      );
      if (Array.isArray(savedStatusOrder) && savedStatusOrder.length > 0) {
        setStatusBarOrder(savedStatusOrder);
      }
      await quickButtonsCRUD.load();
      await macrosCRUD.load();

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

  const swapPanelsWith = useCallback((panel: PinnablePanel, target: PinnablePanel) => {
    setPanelLayout((prev) => {
      const panelOnLeft = prev.left.includes(panel);
      const targetOnLeft = prev.left.includes(target);
      if (panelOnLeft === targetOnLeft) return prev;
      const newLeft = [...prev.left];
      const newRight = [...prev.right];
      if (panelOnLeft) {
        newLeft[newLeft.indexOf(panel)] = target;
        newRight[newRight.indexOf(target)] = panel;
      } else {
        newRight[newRight.indexOf(panel)] = target;
        newLeft[newLeft.indexOf(target)] = panel;
      }
      return { left: newLeft, right: newRight };
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

  // Persist panel layout, widths, heights, and collapsed state
  useEffect(() => {
    if (!panelLayoutLoadedRef.current) return;
    dataStore.set('settings.json', 'panelLayout', panelLayout).catch(console.error);
    dataStore.set('settings.json', 'pinnedWidths', pinnedWidths).catch(console.error);
    dataStore.set('settings.json', 'panelHeights', panelHeights).catch(console.error);
    dataStore.set('settings.json', 'collapsedSides', collapsedSides).catch(console.error);
  }, [panelLayout, pinnedWidths, panelHeights, collapsedSides]);

  // Clear collapsed flag when a side has no pinned panels
  useEffect(() => {
    if (panelLayout.left.length === 0 && collapsedSides.left) {
      setCollapsedSides((p) => ({ ...p, left: false }));
    }
    if (panelLayout.right.length === 0 && collapsedSides.right) {
      setCollapsedSides((p) => ({ ...p, right: false }));
    }
  }, [panelLayout, collapsedSides]);

  // Callbacks for vertical resize ratio changes
  const onLeftHeightRatiosChange = useCallback((ratios: number[]) => {
    setPanelHeights((p) => ({ ...p, left: ratios }));
  }, []);
  const onRightHeightRatiosChange = useCallback((ratios: number[]) => {
    setPanelHeights((p) => ({ ...p, right: ratios }));
  }, []);

  // Viewport-aware panel width budget
  const budget = useViewportBudget(pinnedWidths, panelLayout);

  // Merge manual collapse with viewport-auto-collapse
  const leftIsCollapsed = budget.leftCollapsed || collapsedSides.left;
  const rightIsCollapsed = budget.rightCollapsed || collapsedSides.right;
  const effectiveLeftWidth = collapsedSides.left ? 0 : budget.effectiveLeftWidth;
  const effectiveRightWidth = collapsedSides.right ? 0 : budget.effectiveRightWidth;

  const collapseLeft = useCallback(() => setCollapsedSides((p) => ({ ...p, left: true })), []);
  const expandLeft = useCallback(() => setCollapsedSides((p) => ({ ...p, left: false })), []);
  const collapseRight = useCallback(() => setCollapsedSides((p) => ({ ...p, right: true })), []);
  const expandRight = useCallback(() => setCollapsedSides((p) => ({ ...p, right: false })), []);

  // Resize hooks for pinned regions (dynamic max from budget)
  const leftResize = useResize({
    side: 'left',
    initialWidth: pinnedWidths.left,
    max: budget.maxLeftWidth,
    onWidthChange: useCallback((w: number) => setPinnedWidths((p) => ({ ...p, left: w })), []),
  });
  const rightResize = useResize({
    side: 'right',
    initialWidth: pinnedWidths.right,
    max: budget.maxRightWidth,
    onWidthChange: useCallback((w: number) => setPinnedWidths((p) => ({ ...p, right: w })), []),
  });

  const { theme, updateColor, resetColor, display, updateDisplay, resetDisplay, resetAll } =
    useThemeColors();
  const xtermTheme = useMemo(() => buildXtermTheme(theme), [theme]);

  // Output processor for skill detection
  const processorRef = useRef<OutputProcessor | null>(null);
  if (!processorRef.current) {
    processorRef.current = new OutputProcessor();
    processorRef.current.registerMatcher(matchSkillLine);
  }

  // Sound library (built-in chimes + custom sounds)
  const { libraryRef: soundLibraryRef } = useSoundLibrary(
    appSettings.customChime1,
    appSettings.customChime2,
    appSettings.customSounds
  );
  // Chat messages hook
  const chatNotificationsRef = useRef(appSettings.chatNotifications);
  chatNotificationsRef.current = appSettings.chatNotifications;
  const chatGaggedNpcsRef = useRef(appSettings.gaggedNpcs);
  chatGaggedNpcsRef.current = appSettings.gaggedNpcs;
  const {
    messages: chatMessages,
    filters: chatFilters,
    mutedSenders,
    soundAlerts: chatSoundAlerts,
    newestFirst: chatNewestFirst,
    hideOwnMessages: chatHideOwnMessages,
    handleChatMessage,
    toggleFilter: toggleChatFilter,
    setAllFilters: setAllChatFilters,
    toggleSoundAlert: toggleChatSoundAlert,
    toggleNewestFirst: toggleChatNewestFirst,
    toggleHideOwnMessages: toggleChatHideOwnMessages,
    muteSender,
    unmuteSender,
    updateSender,
  } = useChatMessages(appSettings.chatHistorySize, chatNotificationsRef, soundLibraryRef, chatGaggedNpcsRef);
  const handleChatMessageRef = useLatestRef(handleChatMessage);

  // Status trackers
  const { concentration, updateConcentration } = useConcentration();
  const updateConcentrationRef = useLatestRef(updateConcentration);

  const { health, updateHealth } = useHealth();
  const updateHealthRef = useLatestRef(updateHealth);

  const { hunger, thirst, updateHunger, updateThirst } = useNeeds();
  const updateHungerRef = useLatestRef(updateHunger);
  const updateThirstRef = useLatestRef(updateThirst);

  const { aura, auraMudColor, auraMudColors, updateAura } = useAura();
  const updateAuraRef = useLatestRef(updateAura);

  const { encumbrance, updateEncumbrance } = useEncumbrance();
  const updateEncumbranceRef = useLatestRef(updateEncumbrance);

  const { movement, updateMovement } = useMovement();
  const updateMovementRef = useLatestRef(updateMovement);

  const { alignment, updateAlignment } = useAlignment();
  const updateAlignmentRef = useLatestRef(updateAlignment);

  const [whoSnapshot, setWhoSnapshot] = useState<WhoSnapshot | null>(null);
  const updateWhoSnapshotRef = useLatestRef(setWhoSnapshot);

  const outputFilterRef = useRef<OutputFilter | null>(null);
  if (!outputFilterRef.current) {
    outputFilterRef.current = new OutputFilter({
      onConcentration: (match) => updateConcentrationRef.current(match),
      onHealth: (match) => updateHealthRef.current(match),
      onHunger: (level) => updateHungerRef.current(level),
      onThirst: (level) => updateThirstRef.current(level),
      onAura: (match) => updateAuraRef.current(match),
      onEncumbrance: (match) => updateEncumbranceRef.current(match),
      onMovement: (match) => updateMovementRef.current(match),
      onAlignment: (match) => updateAlignmentRef.current(match),
      onChat: (msg) => handleChatMessageRef.current(msg),
      onWho: (snapshot) => updateWhoSnapshotRef.current(snapshot),
      onLine: (stripped, raw) => {
        // Action blocker — check for unblock triggers
        const blocker = actionBlockerRef.current;
        if (
          actionBlockingEnabledRef.current &&
          blocker.blocked &&
          blocker.processServerLine(stripped)
        ) {
          const { toSend, reblocked } = blocker.flush();
          // Only show [UNBLOCKED] when there are queued commands to report
          if (toSend.length > 0 || reblocked) {
            const remaining = reblocked ? blocker.queueLength : 0;
            let msg = '[UNBLOCKED';
            if (toSend.length > 0) msg += ` — sending ${toSend.length} queued`;
            if (remaining > 0) msg += `, re-queuing ${remaining} behind ${blocker.blockLabel}`;
            msg += ']';
            writeToTerm(`\x1b[32m${msg}\x1b[0m\r\n`);
          }
          // Flush queued commands via raw sendCommand (bypasses blocker)
          (async () => {
            for (const cmd of toSend) {
              await sendCommand(cmd);
            }
          })();
        }

        // Auto-inscriber — watch for loop patterns
        autoInscriberRef.current.processServerLine(stripped);

        // Auto-caster — watch for cast loop patterns
        autoCasterRef.current.processServerLine(stripped);

        // Auto-conc — watch for BEBT to execute action
        autoConcRef.current.processServerLine(stripped);

        // Feed to automapper room parser — disabled
        // mapFeedLineRef.current(stripped);

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

        // Gag groups + NPC gags — suppress line before trigger evaluation
        if (shouldGagLine(stripped, gagGroupsRef.current, npcGagTrackerRef.current, chatGaggedNpcsRef.current)) {
          return { gag: true, highlight: null };
        }

        // Skill count injection — transform skill readout lines
        let replacement: string | undefined;
        if (showSkillCountsRef.current) {
          const transformed = transformSkillReadout(
            stripped,
            raw,
            skillDataRef.current.skills,
          );
          if (transformed) replacement = transformed;
        }

        const matches = matchTriggers(stripped, raw, mergedTriggersRef.current);
        if (matches.length === 0) {
          return replacement ? { gag: false, highlight: null, replacement } : undefined;
        }

        let gag = false;
        let highlight: string | null = null;

        for (const match of matches) {
          if (match.trigger.gag) gag = true;
          if (match.trigger.highlight) highlight = match.trigger.highlight;
          // Play sound: new soundName field takes priority, fall back to legacy soundAlert
          const soundToPlay = match.trigger.soundName ?? (match.trigger.soundAlert ? 'chime1' : null);
          if (soundToPlay) {
            soundLibraryRef.current.play(soundToPlay);
          }

          // Expand and execute trigger body asynchronously
          if (match.trigger.body.trim()) {
            const work =
              match.trigger.bodyMode === 'script'
                ? executeTriggerScript(
                    match.trigger.body,
                    match,
                    activeCharacterRef.current,
                    triggerRunnerRef.current,
                    globalScriptRef.current
                  )
                : (() => {
                    const raw = expandTriggerBody(match.trigger.body, match, activeCharacterRef.current, commandSeparatorRef.current);
                    const commands = raw.flatMap((cmd) =>
                      cmd.type === 'send' ? triggerRunnerRef.current.expand(cmd.text) : [cmd]
                    );
                    return executeCommands(commands, triggerRunnerRef.current);
                  })();
            work.catch(() => {});
          }
        }

        return { gag, highlight, replacement };
      },
    });
  }

  // Keep OutputFilter properties in sync with settings + persist filter flags
  useEffect(() => {
    const filter = outputFilterRef.current;
    if (!filter) return;
    filter.filterFlags = { ...filterFlags };
    filter.boardDatesEnabled = boardDatesEnabled;
    filter.stripPrompts = stripPromptsEnabled;
    filter.antiSpamEnabled = antiSpamEnabled;
    // Don't persist until settings are loaded — prevents defaults from overwriting synced values
    if (!settingsLoadedRef.current) return;
    dataStore.set('settings.json', 'filteredStatuses', filterFlags).catch(console.error);
  }, [filterFlags, boardDatesEnabled, stripPromptsEnabled, antiSpamEnabled]);

  // Wire anti-spam flush callback so the timer can write to the terminal
  useEffect(() => {
    if (outputFilterRef.current) {
      outputFilterRef.current.onAntiSpamFlush = writeToTerm;
    }
  }, [writeToTerm]);

  // Persist per-readout compact state
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    dataStore.set('settings.json', 'compactReadouts', compactReadouts).catch(console.error);
  }, [compactReadouts]);

  // Clear taskbar flash when window regains focus
  useEffect(() => {
    const handleFocus = async () => {
      if (getPlatform() === 'tauri') {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().requestUserAttention(null);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

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

  // Action blocker — command queueing for channeled actions
  const [actionBlockerRef, blockerState] = useEngineRef(() => new ActionBlocker());
  const actionBlockingEnabledRef = useLatestRef(appSettings.actionBlockingEnabled);
  const gagGroupsRef = useLatestRef(appSettings.gagGroups);
  const npcGagTrackerRef = useRef(new NpcGagTracker());
  const showSkillCountsRef = useLatestRef(appSettings.showSkillCounts);

  // Auto-inscriber — automated inscription practice loop
  const [autoInscriberRef, inscriberState] = useEngineRef(() => new AutoInscriber());

  // Auto-caster — automated spell practice loop
  const [autoCasterRef, casterState] = useEngineRef(() => new AutoCaster());

  // Sync persisted weight config to auto-caster when settings load
  useEffect(() => {
    autoCasterRef.current.configureWeight(
      appSettings.casterWeightItem || 'tallow',
      appSettings.casterWeightContainer || null,
      appSettings.casterWeightAdjustUp,
      appSettings.casterWeightAdjustDown
    );
  }, [
    appSettings.casterWeightItem,
    appSettings.casterWeightContainer,
    appSettings.casterWeightAdjustUp,
    appSettings.casterWeightAdjustDown,
  ]);

  // Auto-conc — auto-execute on full concentration
  const [autoConcRef, concState] = useEngineRef(() => new AutoConc());

  // Sync persisted action to auto-conc when settings load
  useEffect(() => {
    autoConcRef.current.setAction(appSettings.autoConcAction);
  }, [appSettings.autoConcAction]);

  // Movement mode — direction command prefixing (lead/row/sneak)
  const [movementMode, setMovementMode] = useState<MovementMode>('normal');
  const movementModeRef = useLatestRef(movementMode);

  // Skill tracker — needs sendCommand ref (set after useMudConnection)
  const sendCommandRef = useRef<((cmd: string) => Promise<void>) | null>(null);
  const {
    activeCharacter,
    skillData,
    setActiveCharacter,
    handleSkillMatch,
    showInlineImproves,
    toggleInlineImproves,
    addSkill,
    updateSkillCount,
    deleteSkill,
    announceModeRef,
    announcePetModeRef,
  } = useSkillTracker(sendCommandRef, processorRef, terminalRef, dataStore);
  const skillDataRef = useLatestRef(skillData);

  // Keep announce mode refs in sync with settings
  announceModeRef.current = appSettings.announceMode;
  announcePetModeRef.current = appSettings.announcePetMode;

  const cycleMovementMode = useCallback(() => {
    const hasSneaking = !!skillDataRef.current.skills['sneaking'];
    const next = getNextMode(movementModeRef.current, hasSneaking);
    setMovementMode(next);
    writeToTerm(`\x1b[36m[Movement mode: ${movementModeLabel(next)}]\x1b[0m\r\n`);
  }, [skillDataRef, movementModeRef, writeToTerm]);

  // Improve counter hook
  const improveCounters = useImproveCounters();
  const { handleCounterMatch } = improveCounters;
  const handleCounterMatchRef = useLatestRef(handleCounterMatch);
  const improveCountersRef = useLatestRef(improveCounters);

  // Alias system
  const aliasState = useAliases(dataStore, activeCharacter);
  const { mergedAliases, enableSpeedwalk } = aliasState;
  const mergedAliasesRef = useLatestRef(mergedAliases);
  const enableSpeedwalkRef = useLatestRef(enableSpeedwalk);
  // Fast flag: skip matchAlias pre-check when no script aliases exist (common case)
  const hasScriptAliases = useMemo(
    () => mergedAliases.some((a) => a.bodyMode === 'script' && a.enabled),
    [mergedAliases]
  );
  const hasScriptAliasesRef = useLatestRef(hasScriptAliases);
  const activeCharacterRef = useLatestRef(activeCharacter);
  const commandSeparatorRef = useLatestRef(appSettings.commandSeparator);

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
  const triggerRunnerRef = useRef<CommandRunner>({
    send: async () => {},
    echo: () => {},
    expand: () => [],
    setVar: () => {},
    convert: () => {},
    getVariables: () => [],
    getSkillCount: () => 0,
    readFile: async () => '',
    writeFile: async () => {},
    playSound: () => {},
    enableTimer: () => {},
    disableTimer: () => {},
    enableTrigger: () => {},
    disableTrigger: () => {},
    enableAlias: () => {},
    disableAlias: () => {},
    getGameTime: () => ({ hour: 0, timeOfDay: '', date: '', holiday: null }),
    getCounter: () => null,
    getMovementMode: () => 'normal',
    setMovementMode: () => {},
  });

  // Global script system
  const { script: globalScript, saveScript: saveGlobalScript } = useGlobalScript(dataStore);
  const globalScriptRef = useLatestRef(globalScript);

  // Timer system
  const timerState = useTimers(dataStore, activeCharacter);
  const { mergedTimers } = timerState;
  const timerStateRef = useLatestRef(timerState);
  const triggerStateRef = useLatestRef(triggerState);
  const aliasStateRef = useLatestRef(aliasState);

  // Context menu → trigger panel integration
  const handleAddToTrigger = useCallback(
    (selectedText: string) => {
      triggerState.setTriggerPrefill({
        pattern: selectedText,
        matchMode: 'substring',
        gag: false,
        body: '',
        group: 'General',
      });
      setActivePanel('triggers');
    },
    [triggerState.setTriggerPrefill]
  );

  const handleGagLine = useCallback(
    (selectedText: string) => {
      triggerState.createTrigger(
        {
          pattern: selectedText,
          matchMode: 'substring',
          body: '',
          group: 'Gags',
          gag: true,
        },
        'global'
      );
      writeToTerm(`\x1b[90m[Gag trigger created for: ${selectedText}]\x1b[0m\r\n`);
    },
    [triggerState.createTrigger, writeToTerm]
  );

  // Context menu → notes panel integration
  const { appendToNotes } = useNotesContext();
  const handleOpenInNotes = useCallback(
    (text: string) => {
      appendToNotes(text);
      setActivePanel('notes');
    },
    [appendToNotes]
  );

  // Signature mapping system
  const signatureState = useSignatureMappings(dataStore, activeCharacter);

  // Who title mapping system
  const whoTitleState = useWhoTitleMappings(dataStore, activeCharacter);
  const { resolveSignature } = signatureState;
  const resolveSignatureRef = useLatestRef(resolveSignature);

  // Map tracker — disabled (automapper not ready)
  // const mapTracker = useMapTracker(dataStore, activeCharacter);
  // const mapFeedLineRef = useLatestRef(mapTracker.feedLine);
  // const mapTrackCommandRef = useLatestRef(mapTracker.trackCommand);

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
  const onOutputChunk = useCallback(
    (data: string) => {
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
    },
    [handleSkillMatch]
  );

  const onCharacterName = useCallback(
    (name: string) => {
      setActiveCharacter(name);
    },
    [setActiveCharacter]
  );

  const autoLoginActiveSlotRef = useLatestRef(autoLoginActiveSlot);
  const onLogin = useCallback(() => {
    outputFilterRef.current?.startSync();
    for (const cmd of LOGIN_COMMANDS) {
      sendCommandRef.current?.(cmd);
    }
    setLoggedIn(true);
    // Record login timestamp for character switch cooldown
    appSettings.updateLastLoginTimestamp(Date.now());
    appSettings.updateLastLoginSlot(autoLoginActiveSlotRef.current);
  }, []);

  const transport = useTransport();

  const { connected, passwordMode, skipHistory, sendCommand, reconnect, disconnect } =
    useMudConnection(
      terminalRef,
      debugModeRef,
      transport,
      onOutputChunk,
      onCharacterName,
      outputFilterRef,
      onLogin,
      autoLoginRef
    );

  // Session logger
  const { logOutput, logCommand } = useSessionLogger(
    appSettings.sessionLoggingEnabled,
    passwordMode,
    appSettings.timestampFormat
  );
  logOutputRef.current = logOutput;
  logCommandRef.current = logCommand;

  // Wrap sendCommand with action blocker — all senders (timers, triggers,
  // skill tracker, allocations, user commands) go through this ref.
  // Raw sendCommand is used directly only when flushing the queue.
  sendCommandRef.current = async (command: string) => {
    const blocker = actionBlockerRef.current;
    if (actionBlockingEnabledRef.current && blocker.blocked) {
      blocker.enqueue(command);
      writeToTerm(`\x1b[33mQUEUED: ${command}\x1b[0m\r\n`);
      return;
    }
    if (actionBlockingEnabledRef.current) {
      const cat = blocker.shouldBlock(command);
      if (cat) blocker.block(cat);
    }
    await sendCommand(command);
  };

  // Keep trigger runner in sync for use in the output filter closure
  triggerRunnerRef.current = {
    send: async (text) => {
      // mapTrackCommandRef.current(text); // automapper disabled
      await sendCommandRef.current?.(text);
    },
    echo: (text) => writeToTerm(`\x1b[36m${text}\x1b[0m\r\n`),
    expand: (input) =>
      expandInput(input, mergedAliasesRef.current, {
        enableSpeedwalk: enableSpeedwalkRef.current,
        activeCharacter: activeCharacterRef.current,
        separator: commandSeparatorRef.current,
      }).commands,
    setVar: (name, value, scope) => {
      setVarRef.current(name, value, scope);
    },
    convert: (args) => {
      const parsed = parseConvertCommand(`/convert ${args}`);
      if (typeof parsed === 'string') {
        writeToTerm(`\x1b[31m[Convert] ${parsed}\x1b[0m\r\n`);
      } else {
        writeToTerm(`${formatMultiConversion(parsed)}\r\n`);
      }
    },
    getVariables: () => mergedVariablesRef.current,
    getSkillCount: (name: string) => {
      const record = skillDataRef.current.skills[name.toLowerCase()];
      return record?.count ?? 0;
    },
    readFile: async (path: string) => {
      if (!('__TAURI_INTERNALS__' in window)) {
        throw new Error('readFile is only available in the desktop app');
      }
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<string>('read_system_file', { path });
    },
    writeFile: async (path: string, content: string) => {
      if (!('__TAURI_INTERNALS__' in window)) {
        throw new Error('writeFile is only available in the desktop app');
      }
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_system_file', { path, content });
    },
    playSound: (id: number | string) => {
      soundLibraryRef.current.play(id);
    },
    enableTimer: (name: string) => {
      const ts = timerStateRef.current;
      const lower = name.toLowerCase();
      for (const t of ts.mergedTimers) {
        if (t.name.toLowerCase() === lower && !t.enabled) {
          const scope = ts.characterTimers[t.id] ? 'character' : 'global';
          ts.toggleTimer(t.id, scope as 'character' | 'global');
          return;
        }
      }
    },
    disableTimer: (name: string) => {
      const ts = timerStateRef.current;
      const lower = name.toLowerCase();
      for (const t of ts.mergedTimers) {
        if (t.name.toLowerCase() === lower && t.enabled) {
          const scope = ts.characterTimers[t.id] ? 'character' : 'global';
          ts.toggleTimer(t.id, scope as 'character' | 'global');
          return;
        }
      }
    },
    enableTrigger: (name: string) => {
      const ts = triggerStateRef.current;
      const lower = name.toLowerCase();
      for (const t of ts.mergedTriggers) {
        if ((t.name ?? '').toLowerCase() === lower && !t.enabled) {
          const scope = ts.characterTriggers[t.id] ? 'character' : 'global';
          ts.toggleTrigger(t.id, scope as 'character' | 'global');
          return;
        }
      }
    },
    disableTrigger: (name: string) => {
      const ts = triggerStateRef.current;
      const lower = name.toLowerCase();
      for (const t of ts.mergedTriggers) {
        if ((t.name ?? '').toLowerCase() === lower && t.enabled) {
          const scope = ts.characterTriggers[t.id] ? 'character' : 'global';
          ts.toggleTrigger(t.id, scope as 'character' | 'global');
          return;
        }
      }
    },
    enableAlias: (name: string) => {
      const as_ = aliasStateRef.current;
      const lower = name.toLowerCase();
      for (const a of as_.mergedAliases) {
        if ((a.name ?? '').toLowerCase() === lower && !a.enabled) {
          const scope = as_.characterAliases[a.id] ? 'character' : 'global';
          as_.toggleAlias(a.id, scope as 'character' | 'global');
          return;
        }
      }
    },
    disableAlias: (name: string) => {
      const as_ = aliasStateRef.current;
      const lower = name.toLowerCase();
      for (const a of as_.mergedAliases) {
        if ((a.name ?? '').toLowerCase() === lower && a.enabled) {
          const scope = as_.characterAliases[a.id] ? 'character' : 'global';
          as_.toggleAlias(a.id, scope as 'character' | 'global');
          return;
        }
      }
    },
    getGameTime: () => {
      const hour = queryHour();
      return {
        hour,
        timeOfDay: getTimeOfDay(hour),
        date: formatDate(null, Reckoning.Common),
        holiday: getHoliday(null, Reckoning.Common),
      };
    },
    getCounter: (name: string) => {
      const ic = improveCountersRef.current;
      const lower = name.toLowerCase();
      const counter = ic.counters.find((c) => c.name.toLowerCase() === lower);
      if (!counter) return null;
      return {
        status: counter.status,
        totalImps: counter.totalImps,
        elapsedMs: ic.getElapsedMs(counter),
        perMinute: ic.getPerMinuteRate(counter),
        perHour: ic.getPerHourRate(counter),
        skills: ic.getSkillsSorted(counter),
      };
    },
    getMovementMode: () => movementModeRef.current,
    setMovementMode: (mode: string) => {
      const valid: MovementMode[] = ['normal', 'leading', 'rowing', 'sneaking'];
      if (valid.includes(mode as MovementMode)) {
        setMovementMode(mode as MovementMode);
        writeToTerm(`\x1b[36m[Movement mode: ${movementModeLabel(mode as MovementMode)}]\x1b[0m\r\n`);
      }
    },
  };

  // Post-sync commands — fire user-configured commands after login sync completes
  useEffect(() => {
    if (!outputFilterRef.current) return;
    outputFilterRef.current.onSyncEnd = () => {
      if (!postSyncEnabledRef.current) return;
      const raw = postSyncCommandsRef.current.trim();
      if (!raw) return;
      writeToTerm('\x1b[90m[login commands]\x1b[0m\r\n');
      const result = expandInput(raw, mergedAliasesRef.current, {
        enableSpeedwalk: enableSpeedwalkRef.current,
        activeCharacter: activeCharacterRef.current,
        separator: commandSeparatorRef.current,
      });
      executeCommands(result.commands, triggerRunnerRef.current);
    };
    return () => {
      if (outputFilterRef.current) outputFilterRef.current.onSyncEnd = null;
    };
  }, []);

  // Command echo ref (used in handleSend callback)
  const commandEchoRef = useLatestRef(appSettings.commandEchoEnabled);
  const passwordModeRef = useLatestRef(passwordMode);

  // Built-in command context — avoids closing over dozens of refs in handleSend
  const builtinCtxRef = useRef<BuiltinContext>(null!);
  builtinCtxRef.current = {
    writeToTerm,
    sendCommand,
    sendCommandViaRef: async () => sendCommandRef.current!,
    actionBlocker: actionBlockerRef.current,
    actionBlockingEnabled: () => actionBlockingEnabledRef.current,
    autoInscriber: autoInscriberRef.current,
    autoCaster: autoCasterRef.current,
    autoConc: autoConcRef.current,
    cycleMovementMode,
    appSettings: {
      announceMode: appSettings.announceMode,
      announcePetMode: appSettings.announcePetMode,
      autoConcAction: appSettings.autoConcAction,
      updateAnnounceMode: appSettings.updateAnnounceMode,
      updateAnnouncePetMode: appSettings.updateAnnouncePetMode,
      updateAutoConcAction: appSettings.updateAutoConcAction,
      updateCasterWeightItem: appSettings.updateCasterWeightItem,
      updateCasterWeightContainer: appSettings.updateCasterWeightContainer,
      updateCasterWeightAdjustUp: appSettings.updateCasterWeightAdjustUp,
      updateCasterWeightAdjustDown: appSettings.updateCasterWeightAdjustDown,
    },
    mergedVariables: () => mergedVariablesRef.current,
    setVar: (name, value, scope) => setVarRef.current(name, value, scope),
    deleteVariableByName: (name) => deleteVariableByNameRef.current(name),
    skillData: () => skillDataRef.current,
    improveCounters: () => improveCountersRef.current,
    counterValue: () => counterValueRef.current,
    expandAndExecute: async (action) => {
      const result = expandInput(action, mergedAliasesRef.current, {
        enableSpeedwalk: enableSpeedwalkRef.current,
        activeCharacter: activeCharacterRef.current,
        separator: commandSeparatorRef.current,
      });
      await executeCommands(result.commands, triggerRunnerRef.current);
    },
  };

  // Alias-expanded send: preprocesses input through the alias engine
  const handleSend = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim();

      // Command echo — write dimmed line to terminal before processing
      if (commandEchoRef.current && trimmed) {
        if (passwordModeRef.current) {
          writeToTerm('\x1b[90m> ******\x1b[0m\r\n');
        } else {
          writeToTerm(`\x1b[90m> ${rawInput}\x1b[0m\r\n`);
        }
      }

      // Session logging — log sent command
      if (trimmed) logCommandRef.current?.(rawInput);

      // Idle tracking — stamp on any keypress-driven send (even empty Enter)
      stampUserInput();


      // Dispatch built-in slash commands (/block, /autocast, /var, etc.)
      if (await dispatchBuiltinCommand(trimmed, builtinCtxRef.current)) return;

      // Movement mode — prepend direction prefix if active
      const effectiveInput =
        movementModeRef.current !== 'normal'
          ? applyMovementMode(rawInput, movementModeRef.current)
          : rawInput;

      // Check for script-mode alias before text expansion (skip if no script aliases exist)
      if (hasScriptAliasesRef.current) {
        const aliasMatch = matchAlias(effectiveInput.trim(), mergedAliasesRef.current);
        if (aliasMatch?.alias.bodyMode === 'script') {
          // Exclude the matched alias from expansion within its own script
          // to prevent recursion (e.g., alias "e" calling send("door e") which
          // expands to ";;e;;" which would re-match alias "e")
          const excludeIds = new Set([aliasMatch.alias.id]);
          const runner: typeof triggerRunnerRef.current = {
            ...triggerRunnerRef.current,
            expand: (input) =>
              expandInput(input, mergedAliasesRef.current, {
                enableSpeedwalk: enableSpeedwalkRef.current,
                activeCharacter: activeCharacterRef.current,
                separator: commandSeparatorRef.current,
                excludeAliasIds: excludeIds,
              }).commands,
          };
          await executeAliasScript(
            aliasMatch.alias.body,
            aliasMatch.args,
            activeCharacterRef.current,
            runner,
            globalScriptRef.current
          );
          return;
        }
      }

      const result = expandInput(effectiveInput, mergedAliasesRef.current, {
        enableSpeedwalk: enableSpeedwalkRef.current,
        activeCharacter: activeCharacterRef.current,
        separator: commandSeparatorRef.current,
      });
      await executeCommands(result.commands, {
        ...triggerRunnerRef.current,
        send: async (text) => {
          // mapTrackCommandRef.current(text); // automapper disabled
          await sendCommandRef.current?.(text);
          // Update live allocs directly from outgoing set commands
          const parsed = parseAllocCommand(text);
          if (parsed) {
            const base = liveAllocationsRef.current[parsed.limb] ?? {
              bonus: 0,
              daring: 0,
              speed: 0,
              aiming: 0,
              parry: 0,
              control: 0,
            };
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
      });
    },
    [sendCommand]
  );

  // Clear logged-in state, reset trigger cooldowns, action blocker, and movement mode on disconnect
  useEffect(() => {
    if (!connected) {
      setLoggedIn(false);
      resetTriggerCooldowns();
      actionBlockerRef.current.reset();
      autoInscriberRef.current.reset();
      autoCasterRef.current.reset();
      autoConcRef.current.reset();
      npcGagTrackerRef.current.reset();
      setMovementMode('normal');
      setWhoSnapshot(null);
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

  const reorderStatusBar = useCallback(
    (newOrder: StatusReadoutKey[]) => {
      setStatusBarOrder(newOrder);
      dataStore.set('settings.json', 'statusBarOrder', newOrder).catch(console.error);
    },
    [dataStore]
  );

  // Quick buttons and macros CRUD managed by usePersistedCRUD hooks (declared above)

  const fireQuickButton = useCallback(
    async (body: string, bodyMode: 'commands' | 'script') => {
      // Quick button clicks are user activity — stamp idle tracker
      stampUserInput();
      if (bodyMode === 'script') {
        await executeAliasScript(
          body,
          [],
          activeCharacterRef.current,
          triggerRunnerRef.current,
          globalScriptRef.current
        );
      } else {
        // Send each line through handleSend (gets alias expansion)
        for (const line of body.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) await handleSend(trimmed);
        }
      }
    },
    [handleSend]
  );

  // Global macro hotkey listener
  const macrosRef = useLatestRef(macrosCRUD.items);
  const fireQuickButtonRef = useLatestRef(fireQuickButton);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept if a modal/editor input is focused (except the command textarea)
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.tagName !== 'BODY' &&
        target.tagName !== 'TEXTAREA' &&
        target.tagName !== 'CANVAS' &&
        !target.classList.contains('xterm-helper-textarea')
      ) {
        // Allow macros from the command input textarea
        const isCommandInput = target.closest('[data-help-id="command-input"]');
        if (!isCommandInput) return;
      }

      const combo = hotkeyFromEvent(e);
      if (!combo) return;
      if (isNumpadKey(combo.key)) return; // numpad handled by CommandInput

      const key = hotkeyToString(combo);
      const macro = macrosRef.current.find(
        (m) => m.enabled && hotkeyToString(m.hotkey) === key
      );
      if (!macro) return;

      e.preventDefault();
      e.stopPropagation();
      fireQuickButtonRef.current(macro.body, macro.bodyMode);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // Post-sync commands
  const postSyncEnabledRef = useLatestRef(postSyncEnabled);
  const postSyncCommandsRef = useLatestRef(postSyncCommands);

  // Timer engines (anti-idle, alignment tracking, who refresh, babel, custom timers)
  const {
    antiIdleNextAt,
    alignmentNextAt,
    whoNextAt,
    babelNextAt,
    activeTimerBadges,
    handleToggleTimer,
    refreshWho,
  } = useTimerEngines({
    connected,
    loggedIn,
    antiIdleEnabled,
    antiIdleCommand,
    antiIdleMinutes,
    alignmentTrackingEnabled,
    alignmentTrackingMinutes,
    whoAutoRefreshEnabled: appSettings.whoAutoRefreshEnabled,
    whoRefreshMinutes: appSettings.whoRefreshMinutes,
    babelEnabled: appSettings.babelEnabled,
    babelLanguage: appSettings.babelLanguage,
    babelIntervalSeconds: appSettings.babelIntervalSeconds,
    babelPhrases: appSettings.babelPhrases,
    mergedTimers,
    timerState,
    sendCommandRef,
    terminalRef,
    outputFilterRef,
    mergedAliasesRef,
    enableSpeedwalkRef,
    activeCharacterRef,
    triggerRunnerRef,
    globalScriptRef,
    commandSeparatorRef,
  });

  // First-launch: auto-open Guide panel
  useEffect(() => {
    if (!settingsLoadedRef.current || appSettings.hasSeenGuide) return;
    const timer = setTimeout(() => setActivePanel('help'), 500);
    return () => clearTimeout(timer);
  }, [appSettings.hasSeenGuide]);

  const readoutConfigs: ReadoutConfig[] = useMemo(
    () => [
      {
        id: 'health',
        data: health,
        icon: <HeartIcon size={11} />,
        tooltip: (d) => d.message ?? '',
        dangerThreshold: 5,
      },
      {
        id: 'concentration',
        data: concentration,
        icon: <FocusIcon size={11} />,
        tooltip: (d) => d.message ?? '',
        filterKey: 'concentration',
        dangerThreshold: 6,
      },
      {
        id: 'aura',
        data: aura ? { ...aura, mudColor: auraMudColor, mudColors: auraMudColors } : null,
        icon: <AuraIcon size={11} />,
        tooltip: (d) =>
          d.key === 'none' ? 'You have no aura.' : `Your aura appears to be ${d.descriptor}.`,
        filterKey: 'aura',
        dangerThreshold: 99,
      },
      {
        id: 'hunger',
        data: hunger,
        icon: <FoodIcon size={11} />,
        tooltip: (d) => `You are ${d.descriptor}.`,
        filterKey: 'hunger',
        dangerThreshold: 7,
      },
      {
        id: 'thirst',
        data: thirst,
        icon: <DropletIcon size={11} />,
        tooltip: (d) => `You are ${d.descriptor}.`,
        filterKey: 'thirst',
        dangerThreshold: 7,
      },
      {
        id: 'encumbrance',
        data: encumbrance,
        icon: <WeightIcon size={11} />,
        tooltip: (d) => d.descriptor ?? '',
        filterKey: 'encumbrance',
        dangerThreshold: 5,
      },
      {
        id: 'movement',
        data: movement,
        icon: <BootIcon size={11} />,
        tooltip: (d) => d.descriptor ?? '',
        filterKey: 'movement',
        dangerThreshold: 6,
      },
      {
        id: 'alignment',
        data: alignment,
        icon: <AlignmentIcon size={11} />,
        tooltip: (d) =>
          d.key === 'none' ? "You don't feel strongly about anything." : `${d.label}`,
        filterKey: 'alignment',
        dangerThreshold: 99,
      },
    ],
    [health, concentration, aura, auraMudColor, auraMudColors, hunger, thirst, encumbrance, movement, alignment]
  );

  const skillTrackerValue = useMemo(
    () => ({
      activeCharacter,
      skillData,
      showInlineImproves,
      toggleInlineImproves,
      addSkill,
      updateSkillCount,
      deleteSkill,
    }),
    [
      activeCharacter,
      skillData,
      showInlineImproves,
      toggleInlineImproves,
      addSkill,
      updateSkillCount,
      deleteSkill,
    ]
  );

  const chatValue = useMemo(
    () => ({
      messages: chatMessages,
      filters: chatFilters,
      mutedSenders,
      soundAlerts: chatSoundAlerts,
      newestFirst: chatNewestFirst,
      hideOwnMessages: chatHideOwnMessages,
      toggleFilter: toggleChatFilter,
      setAllFilters: setAllChatFilters,
      toggleSoundAlert: toggleChatSoundAlert,
      toggleNewestFirst: toggleChatNewestFirst,
      toggleHideOwnMessages: toggleChatHideOwnMessages,
      muteSender,
      unmuteSender,
      updateSender,
    }),
    [
      chatMessages,
      chatFilters,
      mutedSenders,
      chatSoundAlerts,
      chatNewestFirst,
      chatHideOwnMessages,
      toggleChatFilter,
      setAllChatFilters,
      toggleChatSoundAlert,
      toggleChatNewestFirst,
      toggleChatHideOwnMessages,
      muteSender,
      unmuteSender,
      updateSender,
    ]
  );

  const counterEcho = useCallback(
    (id: string, action: string) => {
      const c = improveCounters.counters.find((c) => c.id === id);
      if (c) writeToTerm(`\x1b[36m[Counter "${c.name}" ${action}]\x1b[0m\r\n`);
    },
    [improveCounters.counters, writeToTerm]
  );

  const counterValue = useMemo(
    () => ({
      ...improveCounters,
      startCounter: (id: string) => {
        counterEcho(id, 'started');
        improveCounters.startCounter(id);
      },
      pauseCounter: (id: string) => {
        counterEcho(id, 'paused');
        improveCounters.pauseCounter(id);
      },
      resumeCounter: (id: string) => {
        counterEcho(id, 'resumed');
        improveCounters.resumeCounter(id);
      },
      stopCounter: (id: string) => {
        counterEcho(id, 'stopped');
        improveCounters.stopCounter(id);
      },
      clearCounter: (id: string) => {
        counterEcho(id, 'cleared');
        improveCounters.clearCounter(id);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are stable (useCallback), only state values change
    [improveCounters.counters, improveCounters.activeCounterId, improveCounters.periodLengthMinutes, counterEcho]
  );
  const counterValueRef = useLatestRef(counterValue);

  // Toggle active counter: stopped→running, running→paused, paused→running
  const toggleActiveCounter = useCallback(() => {
    const { activeCounterId, counters } = improveCounters;
    if (!activeCounterId) return;
    const counter = counters.find((c) => c.id === activeCounterId);
    if (!counter) return;
    if (counter.status === 'running') counterValue.pauseCounter(activeCounterId);
    else if (counter.status === 'paused') counterValue.resumeCounter(activeCounterId);
    else counterValue.startCounter(activeCounterId);
  }, [improveCounters, counterValue]);

  // Who list context value
  const whoValue = useMemo(
    () => ({ snapshot: whoSnapshot, refresh: refreshWho }),
    [whoSnapshot, refreshWho]
  );

  // CommandInput context value
  const commandInputValue = useMemo(
    () => ({
      connected,
      disabled: !connected,
      passwordMode,
      skipHistory,
      recentLinesRef,
      onToggleCounter: toggleActiveCounter,
      antiIdleEnabled,
      antiIdleCommand,
      antiIdleMinutes,
      antiIdleNextAt,
      onToggleAntiIdle: () => appSettings.updateAntiIdleEnabled(false),
      alignmentTrackingEnabled,
      alignmentTrackingMinutes,
      alignmentNextAt,
      onToggleAlignmentTracking: () => appSettings.updateAlignmentTrackingEnabled(false),
      whoAutoRefreshEnabled: appSettings.whoAutoRefreshEnabled,
      whoRefreshMinutes: appSettings.whoRefreshMinutes,
      whoNextAt,
      onToggleWhoAutoRefresh: () => appSettings.updateWhoAutoRefreshEnabled(false),
      activeTimers: activeTimerBadges,
      onToggleTimer: handleToggleTimer,
      initialHistory: commandHistory,
      onHistoryChange: handleHistoryChange,
      actionBlocked: blockerState.blocked,
      actionBlockLabel: blockerState.blockLabel,
      actionQueueLength: blockerState.queueLength,
      movementMode,
      onToggleMovementMode: cycleMovementMode,
      babelEnabled: appSettings.babelEnabled,
      babelLanguage: appSettings.babelLanguage,
      babelNextAt,
      onToggleBabel: () => appSettings.updateBabelEnabled(false),
      inscriberActive: inscriberState.active,
      inscriberSpell: inscriberState.spell,
      inscriberCycleCount: inscriberState.cycleCount,
      onStopInscriber: () =>
        autoInscriberRef.current.stop((msg) => writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`)),
      casterActive: casterState.active,
      casterSpell: casterState.spell,
      casterPower: casterState.power,
      casterCycleCount: casterState.cycleCount,
      casterWeightMode: casterState.weightMode,
      casterCarriedWeight: casterState.carriedWeight,
      casterWeightItem: casterState.weightItem,
      onStopCaster: () =>
        autoCasterRef.current.stop((msg) => writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`)),
      concActive: concState.active,
      concAction: concState.action,
      concCycleCount: concState.cycleCount,
      onStopConc: () =>
        autoConcRef.current.stop((msg) => writeToTerm(`\x1b[36m${msg}\x1b[0m\r\n`)),
      announceMode: appSettings.announceMode,
      onStopAnnounce: () => {
        appSettings.updateAnnounceMode('off');
        appSettings.updateAnnouncePetMode('off');
      },
    }),
    [
      connected,
      passwordMode,
      skipHistory,
      recentLinesRef,
      toggleActiveCounter,
      antiIdleEnabled,
      antiIdleCommand,
      antiIdleMinutes,
      antiIdleNextAt,
      alignmentTrackingEnabled,
      alignmentTrackingMinutes,
      alignmentNextAt,
      appSettings.whoAutoRefreshEnabled,
      appSettings.whoRefreshMinutes,
      whoNextAt,
      appSettings.updateWhoAutoRefreshEnabled,
      activeTimerBadges,
      handleToggleTimer,
      commandHistory,
      handleHistoryChange,
      appSettings.updateAntiIdleEnabled,
      appSettings.updateAlignmentTrackingEnabled,
      blockerState,
      movementMode,
      cycleMovementMode,
      appSettings.babelEnabled,
      appSettings.babelLanguage,
      babelNextAt,
      appSettings.updateBabelEnabled,
      inscriberState,
      casterState,
      concState,
      appSettings.announceMode,
      appSettings.updateAnnounceMode,
      appSettings.updateAnnouncePetMode,
      writeToTerm,
    ]
  );

  // Character switch: swap active slot, disconnect, reconnect
  const switchCharacter = useCallback(() => {
    const newSlot = (autoLoginActiveSlot === 0 ? 1 : 0) as 0 | 1;
    appSettings.updateAutoLoginActiveSlot(newSlot);
    disconnect();
    setTimeout(() => reconnect(), 300);
  }, [autoLoginActiveSlot, appSettings.updateAutoLoginActiveSlot, disconnect, reconnect]);

  // Memoized toolbar callbacks to avoid re-renders
  const handleReconnect = useCallback(() => {
    reconnect();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [reconnect]);
  const handleDisconnect = useCallback(() => {
    disconnect();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disconnect]);

  const handleScreenshot = useCallback(async () => {
    const term = terminalRef.current;
    if (!term?.element) return;
    try {
      await captureTerminalScreenshot(term.element, xtermTheme.background ?? '#000000');
      smartWrite(term, '\r\n\x1b[90m[Screenshot copied to clipboard]\x1b[0m\r\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Screenshot failed:', err);
      smartWrite(term, `\r\n\x1b[31m[Screenshot failed: ${msg}]\x1b[0m\r\n`);
    }
  }, [xtermTheme.background]);

  const appSettingsWithExtras = useMemo(
    () => ({
      ...appSettings,
      onSwitchCharacter: switchCharacter,
      connected,
    }),
    [appSettings, switchCharacter, connected]
  );

  // Automapper disabled — leave for future use
  // const handleMapWalkTo = useCallback(
  //   async (directions: string[]) => {
  //     for (const dir of directions) {
  //       await sendCommand(dir);
  //     }
  //   },
  //   [sendCommand]
  // );

  return (
    <TerminalThemeProvider value={theme}>
      <AppSettingsProvider value={appSettingsWithExtras}>
        <CommandInputProvider value={commandInputValue}>
          <VariableProvider value={variableState}>
            <AliasProvider value={aliasState}>
              <TriggerProvider value={triggerState}>
                <TimerProvider value={timerState}>
                  <SignatureProvider value={signatureState}>
                    <SkillTrackerProvider value={skillTrackerValue}>
                      <ChatProvider value={chatValue}>
                        <ImproveCounterProvider value={counterValue}>
                          {/* MapProvider disabled — automapper not ready */}
                            <AllocProvider value={allocState}>
                              <WhoProvider value={whoValue}>
                                <WhoTitleProvider value={whoTitleState}>
                                <PanelProvider
                                  layout={panelLayout}
                                  activePanel={activePanel}
                                  togglePanel={togglePanel}
                                  pinPanel={pinPanel}
                                >
                                  <SpotlightProvider>
                                    <div className="flex flex-col h-dvh bg-bg-canvas text-text-primary relative p-1 gap-1 overflow-hidden">
                                      <Toolbar
                                        connected={connected}
                                        onReconnect={handleReconnect}
                                        onDisconnect={handleDisconnect}
                                        onScreenshot={handleScreenshot}
                                      />
                                      <div className="flex-1 overflow-hidden flex flex-row gap-1 relative">
                                        {/* Left pinned region — full, collapsed strip, or hidden */}
                                        {effectiveLeftWidth > 0 ? (
                                          <>
                                            <PinnedRegion
                                              side="left"
                                              panels={panelLayout.left}
                                              width={effectiveLeftWidth}
                                              otherSidePanels={panelLayout.right}
                                              onUnpin={unpinPanel}
                                              onSwapSide={swapPanelSide}
                                              onSwapWith={swapPanelsWith}
                                              onMovePanel={movePanel}
                                              heightRatios={panelHeights.left}
                                              onHeightRatiosChange={onLeftHeightRatiosChange}
                                            />
                                            {panelLayout.left.length > 0 && (
                                              <ResizeHandle
                                                side="left"
                                                onMouseDown={leftResize.handleMouseDown}
                                                isDragging={leftResize.isDragging}
                                                constrained={
                                                  effectiveLeftWidth < pinnedWidths.left
                                                }
                                                onCollapse={collapseLeft}
                                              />
                                            )}
                                          </>
                                        ) : leftIsCollapsed && panelLayout.left.length > 0 ? (
                                          <CollapsedPanelStrip
                                            side="left"
                                            panels={panelLayout.left}
                                            panelWidth={pinnedWidths.left}
                                            otherSidePanels={panelLayout.right}
                                            onUnpin={unpinPanel}
                                            onSwapSide={swapPanelSide}
                                            onSwapWith={swapPanelsWith}
                                            onMovePanel={movePanel}
                                            onExpand={
                                              collapsedSides.left && !budget.leftCollapsed
                                                ? expandLeft
                                                : undefined
                                            }
                                          />
                                        ) : null}

                                        {/* Center: Terminal + bottom controls */}
                                        <div
                                          className="flex-1 overflow-hidden flex flex-col"
                                          style={{ minWidth: MIN_TERMINAL_WIDTH }}
                                        >
                                          <div className="flex-1 overflow-hidden rounded-lg flex flex-col">
                                            <Terminal
                                              terminalRef={terminalRef}
                                              inputRef={inputRef}
                                              theme={xtermTheme}
                                              display={display}
                                              onUpdateDisplay={updateDisplay}
                                              onAddToTrigger={handleAddToTrigger}
                                              onGagLine={handleGagLine}
                                              onOpenInNotes={handleOpenInNotes}
                                              onScreenshot={handleScreenshot}
                                            />
                                          </div>
                                          {/* Quick buttons */}
                                          <QuickButtonBar
                                            buttons={quickButtonsCRUD.items}
                                            onFire={fireQuickButton}
                                            onAdd={quickButtonsCRUD.add}
                                            onUpdate={quickButtonsCRUD.update}
                                            onDelete={quickButtonsCRUD.remove}
                                            onReorder={quickButtonsCRUD.reorder}
                                          />
                                          {/* Status bar + command input */}
                                          <div className="rounded-lg bg-bg-primary overflow-hidden shrink-0">
                                            <div
                                              ref={statusBarRef}
                                              data-help-id="status-bar"
                                              className="flex items-center gap-1 px-1.5 py-0.5"
                                              style={{
                                                background:
                                                  'linear-gradient(to bottom, #1e1e1e, #1a1a1a)',
                                              }}
                                            >
                                              {loggedIn && (
                                                <SortableStatusBar
                                                  items={readoutConfigs}
                                                  order={statusBarOrder}
                                                  onReorder={reorderStatusBar}
                                                  theme={theme}
                                                  autoCompact={autoCompact}
                                                  compactReadouts={compactReadouts}
                                                  filterFlags={filterFlags}
                                                  toggleFilter={toggleFilter}
                                                  toggleCompactReadout={toggleCompactReadout}
                                                />
                                              )}
                                              <div className="ml-auto">
                                                <GameClock
                                                  compact={autoCompact || !!compactReadouts.clock}
                                                  onToggleCompact={() =>
                                                    toggleCompactReadout('clock')
                                                  }
                                                />
                                              </div>
                                            </div>
                                            <CommandInput
                                              ref={inputRef}
                                              onSend={handleSend}
                                              onReconnect={reconnect}
                                            />
                                          </div>
                                        </div>

                                        {/* Right pinned region — full, collapsed strip, or hidden */}
                                        {effectiveRightWidth > 0 ? (
                                          <>
                                            {panelLayout.right.length > 0 && (
                                              <ResizeHandle
                                                side="right"
                                                onMouseDown={rightResize.handleMouseDown}
                                                isDragging={rightResize.isDragging}
                                                constrained={
                                                  effectiveRightWidth < pinnedWidths.right
                                                }
                                                onCollapse={collapseRight}
                                              />
                                            )}
                                            <PinnedRegion
                                              side="right"
                                              panels={panelLayout.right}
                                              width={effectiveRightWidth}
                                              otherSidePanels={panelLayout.left}
                                              onUnpin={unpinPanel}
                                              onSwapSide={swapPanelSide}
                                              onSwapWith={swapPanelsWith}
                                              onMovePanel={movePanel}
                                              heightRatios={panelHeights.right}
                                              onHeightRatiosChange={onRightHeightRatiosChange}
                                            />
                                          </>
                                        ) : rightIsCollapsed &&
                                          panelLayout.right.length > 0 ? (
                                          <CollapsedPanelStrip
                                            side="right"
                                            panels={panelLayout.right}
                                            panelWidth={pinnedWidths.right}
                                            otherSidePanels={panelLayout.left}
                                            onUnpin={unpinPanel}
                                            onSwapSide={swapPanelSide}
                                            onSwapWith={swapPanelsWith}
                                            onMovePanel={movePanel}
                                            onExpand={
                                              collapsedSides.right && !budget.rightCollapsed
                                                ? expandRight
                                                : undefined
                                            }
                                          />
                                        ) : null}

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
                                            onClose={closePanel}
                                          />
                                        </SlideOut>
                                        <SlideOut panel="settings">
                                          <SettingsPanel onClose={closePanel} />
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
                                          <AliasPanel onClose={closePanel} />
                                        </SlideOut>
                                        <SlideOut panel="triggers">
                                          <TriggerPanel onClose={closePanel} />
                                        </SlideOut>
                                        <SlideOut panel="timers">
                                          <TimerPanel onClose={closePanel} />
                                        </SlideOut>
                                        <SlideOut panel="macros">
                                          <MacroPanel
                                            onClose={closePanel}
                                            macros={macrosCRUD.items}
                                            onAdd={macrosCRUD.add}
                                            onUpdate={macrosCRUD.update}
                                            onDelete={macrosCRUD.remove}
                                          />
                                        </SlideOut>
                                        <SlideOut panel="variables">
                                          <VariablePanel onClose={closePanel} />
                                        </SlideOut>
                                        <SlideOut panel="scripts">
                                          <ScriptPanel
                                            script={globalScript}
                                            onSave={saveGlobalScript}
                                            onClose={closePanel}
                                          />
                                        </SlideOut>
                                        {/* Automapper disabled
                                        <SlideOut panel="map" pinnable="map">
                                          <MapPanel mode="slideout" onWalkTo={handleMapWalkTo} />
                                        </SlideOut>
                                        */}
                                        <SlideOut panel="alloc" pinnable="alloc">
                                          <AllocPanel mode="slideout" />
                                        </SlideOut>
                                        <SlideOut panel="currency" pinnable="currency">
                                          <CurrencyPanel mode="slideout" />
                                        </SlideOut>
                                        <SlideOut panel="babel" pinnable="babel">
                                          <BabelPanel mode="slideout" />
                                        </SlideOut>
                                        <SlideOut panel="who" pinnable="who">
                                          <WhoPanel mode="slideout" />
                                        </SlideOut>
                                        {activePanel === 'logs' && (
                                          <LogViewerPanel onClose={closePanel} />
                                        )}
                                        <SlideOut panel="help">
                                          <HelpPanel onClose={closePanel} />
                                        </SlideOut>
                                      </div>
                                    </div>
                                    <SpotlightOverlay />
                                  </SpotlightProvider>
                                </PanelProvider>
                                </WhoTitleProvider>
                              </WhoProvider>
                            </AllocProvider>
                          {/* </MapProvider> */}
                        </ImproveCounterProvider>
                      </ChatProvider>
                    </SkillTrackerProvider>
                  </SignatureProvider>
                </TimerProvider>
              </TriggerProvider>
            </AliasProvider>
          </VariableProvider>
        </CommandInputProvider>
      </AppSettingsProvider>
    </TerminalThemeProvider>
  );
}

export default App;
