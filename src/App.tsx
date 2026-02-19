import { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { getAppVersion, setWindowTitle, getPlatform } from './lib/platform';
import { Terminal } from './components/Terminal';
import { CommandInput } from './components/CommandInput';
import { Toolbar } from './components/Toolbar';
import { ColorSettings } from './components/ColorSettings';
import { DataDirSettings } from './components/DataDirSettings';
import { SetupDialog } from './components/SetupDialog';
import { SkillPanel } from './components/SkillPanel';
import { ChatPanel } from './components/ChatPanel';
import { CounterPanel } from './components/CounterPanel';
import { GameClock } from './components/GameClock';
import { StatusReadout } from './components/StatusReadout';
import { HeartIcon, FocusIcon, FoodIcon, DropletIcon, AuraIcon, WeightIcon, BootIcon } from './components/icons';
import { useMudConnection } from './hooks/useMudConnection';
import { useTransport } from './contexts/TransportContext';
import { useClassMode } from './hooks/useClassMode';
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
import { smartWrite } from './lib/terminalUtils';

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
  const [twoRow, setTwoRow] = useState(false);

  const dataStore = useDataStore();
  const settingsLoadedRef = useRef(false);

  // Load compact mode + filter flags + panel layout from settings
  useEffect(() => {
    (async () => {
      const savedCompact = await dataStore.get<Record<string, boolean>>('settings.json', 'compactReadouts');
      if (savedCompact != null) setCompactReadouts(savedCompact);
      const savedFilters = await dataStore.get<FilterFlags>('settings.json', 'filteredStatuses');
      if (savedFilters != null) setFilterFlags(savedFilters);
      const savedLayout = await dataStore.get<PanelLayout>('settings.json', 'panelLayout');
      if (savedLayout != null) setPanelLayout(savedLayout);
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
  const { messages: chatMessages, filters: chatFilters, mutedSenders, soundAlerts: chatSoundAlerts, newestFirst: chatNewestFirst, handleChatMessage, toggleFilter: toggleChatFilter, setAllFilters: setAllChatFilters, toggleSoundAlert: toggleChatSoundAlert, toggleNewestFirst: toggleChatNewestFirst, muteSender, unmuteSender } =
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

  // Responsive status bar: two-row layout when narrow, auto-compact when overflowing.
  const autoCompactThresholdRef = useRef(0);
  useLayoutEffect(() => {
    const el = statusBarRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      setTwoRow(width < 500);
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
  const { activeCharacter, skillData, setActiveCharacter, handleSkillMatch, showInlineImproves, toggleInlineImproves, updateSkillCount, deleteSkill } =
    useSkillTracker(sendCommandRef, processorRef, terminalRef, dataStore);

  // Improve counter hook
  const { handleCounterMatch, ...counterRest } = useImproveCounters();
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

  // Keep OutputFilter's activeCharacter in sync for chat own-message detection
  useEffect(() => {
    if (outputFilterRef.current) {
      outputFilterRef.current.activeCharacter = activeCharacter;
    }
  }, [activeCharacter]);

  // Process output chunks through the skill detection pipeline
  const onOutputChunk = useCallback((data: string) => {
    const matches = processorRef.current!.processChunk(data);
    for (const match of matches) {
      handleSkillMatch(match);
      handleCounterMatchRef.current(match);
    }
  }, [handleSkillMatch]);

  const onCharacterName = useCallback((name: string) => {
    setActiveCharacter(name);
  }, [setActiveCharacter]);

  // Commands to send automatically after login
  const LOGIN_COMMANDS = ['hp', 'score'];

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
    const result = expandInput(rawInput, mergedAliasesRef.current, {
      enableSpeedwalk: enableSpeedwalkRef.current,
      activeCharacter: activeCharacterRef.current,
    });
    for (const cmd of result.commands) {
      switch (cmd.type) {
        case 'send':
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

  // Clear logged-in state on disconnect
  useEffect(() => {
    if (!connected) setLoggedIn(false);
  }, [connected]);

  // Class mode hook preserved for future use
  useClassMode();

  const toggleDebug = () => {
    const next = !debugMode;
    debugModeRef.current = next;
    setDebugMode(next);
  };

  const toggleFilter = useCallback((key: keyof FilterFlags) => {
    setFilterFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const isDanger = (themeColor: string) =>
    themeColor === 'red' || themeColor === 'brightRed' || themeColor === 'magenta';

  const skillTrackerValue = { activeCharacter, skillData, showInlineImproves, toggleInlineImproves, updateSkillCount, deleteSkill };
  const chatValue = { messages: chatMessages, filters: chatFilters, mutedSenders, soundAlerts: chatSoundAlerts, newestFirst: chatNewestFirst, toggleFilter: toggleChatFilter, setAllFilters: setAllChatFilters, toggleSoundAlert: toggleChatSoundAlert, toggleNewestFirst: toggleChatNewestFirst, muteSender, unmuteSender };
  const counterValue = { handleCounterMatch, ...counterRest };

  return (
    <AliasProvider value={aliasState}>
    <SkillTrackerProvider value={skillTrackerValue}>
    <ChatProvider value={chatValue}>
    <ImproveCounterProvider value={counterValue}>
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
        showAliases={activePanel === 'aliases'}
        onToggleAliases={() => togglePanel('aliases')}
        showSettings={activePanel === 'settings'}
        onToggleSettings={() => togglePanel('settings')}
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
        {getPlatform() === 'tauri' && (
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
              activePanel === 'settings' ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <DataDirSettings />
          </div>
        )}
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
        {/* Aliases slide-out — slideout only, no pinning */}
        <div
          className={cn(
            'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
            activePanel === 'aliases' ? 'translate-x-0' : 'translate-x-full'
          )}
        >
          <AliasPanel onClose={() => setActivePanel(null)} />
        </div>
      </div>
      {/* Bottom controls card — status bar + command input */}
      <div className="rounded-lg bg-bg-primary overflow-hidden">
      {/* Game status bar — vitals left, clock right */}
      <div
        ref={statusBarRef}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5',
          twoRow && 'flex-wrap'
        )}
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
        <div className={cn('ml-auto', twoRow && 'basis-full flex justify-end')}>
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
        disabled={!connected}
        connected={connected}
        passwordMode={passwordMode}
        skipHistory={skipHistory}
      />
      </div>
    </div>
    </ImproveCounterProvider>
    </ChatProvider>
    </SkillTrackerProvider>
    </AliasProvider>
  );
}

export default App;
