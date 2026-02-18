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
import { GameClock } from './components/GameClock';
import { StatusReadout } from './components/StatusReadout';
import { HeartIcon, FocusIcon, FoodIcon, DropletIcon, AuraIcon, WeightIcon, BootIcon, CompressIcon } from './components/icons';
import { useMudConnection } from './hooks/useMudConnection';
import { useTransport } from './contexts/TransportContext';
import { useClassMode } from './hooks/useClassMode';
import { useThemeColors } from './hooks/useThemeColors';
import { useSkillTracker } from './hooks/useSkillTracker';
import { useConcentration } from './hooks/useConcentration';
import { useHealth } from './hooks/useHealth';
import { useNeeds } from './hooks/useNeeds';
import { useAura } from './hooks/useAura';
import { useEncumbrance } from './hooks/useEncumbrance';
import { useMovement } from './hooks/useMovement';
import { useDataStore } from './contexts/DataStoreContext';
import { buildXtermTheme } from './lib/defaultTheme';
import { OutputProcessor } from './lib/outputProcessor';
import { OutputFilter, DEFAULT_FILTER_FLAGS, type FilterFlags } from './lib/outputFilter';
import { matchSkillLine } from './lib/skillPatterns';
import { cn } from './lib/cn';

import type { Panel, PanelLayout, PinnablePanel, DockSide } from './types';
import { PinnedRegion } from './components/PinnedRegion';
import { SkillTrackerProvider } from './contexts/SkillTrackerContext';

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
  const [compactBar, setCompactBar] = useState(false);
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
      const savedCompact = await dataStore.get<boolean>('settings.json', 'compactBar');
      if (savedCompact != null) setCompactBar(savedCompact);
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

  const isSkillsPinned = panelLayout.left.includes('skills') || panelLayout.right.includes('skills');

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

  // Persist compact bar state
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    dataStore.set('settings.json', 'compactBar', compactBar).catch(console.error);
  }, [compactBar]);

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

  const effectiveCompact = compactBar || autoCompact;

  // Skill tracker — needs sendCommand ref (set after useMudConnection)
  const sendCommandRef = useRef<((cmd: string) => Promise<void>) | null>(null);
  const { activeCharacter, skillData, setActiveCharacter, handleSkillMatch, showInlineImproves, toggleInlineImproves } =
    useSkillTracker(sendCommandRef, processorRef, terminalRef, dataStore);

  // Process output chunks through the skill detection pipeline
  const onOutputChunk = useCallback((data: string) => {
    const matches = processorRef.current!.processChunk(data);
    for (const match of matches) {
      handleSkillMatch(match);
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

  // Keep sendCommand ref up to date for the skill tracker
  sendCommandRef.current = sendCommand;

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

  const skillTrackerValue = { activeCharacter, skillData, showInlineImproves, toggleInlineImproves };

  return (
    <SkillTrackerProvider value={skillTrackerValue}>
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary relative">
      <Toolbar
        connected={connected}
        onReconnect={reconnect}
        onDisconnect={disconnect}
        showAppearance={activePanel === 'appearance'}
        onToggleAppearance={() => togglePanel('appearance')}
        showSkills={activePanel === 'skills'}
        onToggleSkills={() => togglePanel('skills')}
        skillsPinned={isSkillsPinned}
        showSettings={activePanel === 'settings'}
        onToggleSettings={() => togglePanel('settings')}
      />
      <div className="flex-1 overflow-hidden flex flex-row relative">
        {/* Left pinned region */}
        <PinnedRegion
          side="left"
          panels={panelLayout.left}
          onUnpin={unpinPanel}
          onSwapSide={swapPanelSide}
        />

        {/* Center: Terminal */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <Terminal terminalRef={terminalRef} inputRef={inputRef} theme={xtermTheme} display={display} onUpdateDisplay={updateDisplay} />
        </div>

        {/* Right pinned region */}
        <PinnedRegion
          side="right"
          panels={panelLayout.right}
          onUnpin={unpinPanel}
          onSwapSide={swapPanelSide}
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
      </div>
      {/* Game status bar — vitals left, clock right */}
      <div
        ref={statusBarRef}
        className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 border-t border-border-faint',
          twoRow && 'flex-wrap'
        )}
        style={{ background: 'linear-gradient(to bottom, #1e1e1e, #1a1a1a)' }}
      >
        {loggedIn && (
          <>
            <button
              onClick={() => setCompactBar((v) => !v)}
              disabled={autoCompact}
              title={autoCompact ? 'Compact mode (auto)' : compactBar ? 'Expand status labels' : 'Compact status bar'}
              className={cn(
                'flex items-center justify-center w-5 h-5 rounded-[3px] transition-all duration-200 border',
                autoCompact
                  ? 'text-text-dim/50 border-transparent cursor-default'
                  : compactBar
                    ? 'text-cyan border-cyan/25 bg-cyan/8 cursor-pointer'
                    : 'text-text-dim border-transparent hover:text-text-muted cursor-pointer'
              )}
            >
              <CompressIcon size={10} />
            </button>

            {/* Combat group — health, concentration, aura */}
            {health && (
              <StatusReadout
                icon={<HeartIcon size={11} />}
                label={health.label}
                color={theme[health.themeColor]}
                tooltip={health.message}
                glow={health.severity <= 1}
                danger={isDanger(health.themeColor)}
                compact={effectiveCompact}
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
                compact={effectiveCompact}
                filtered={filterFlags.concentration}
                onClick={() => toggleFilter('concentration')}
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
                compact={effectiveCompact}
                filtered={filterFlags.aura}
                onClick={() => toggleFilter('aura')}
              />
            )}

            {/* Divider between combat and survival */}
            {(concentration || aura || health) && (hunger || thirst) && (
              <div className="w-px h-3.5 bg-border-dim mx-0.5" />
            )}

            {/* Survival group — hunger, thirst */}
            {hunger && (
              <StatusReadout
                icon={<FoodIcon size={11} />}
                label={hunger.label}
                color={theme[hunger.themeColor]}
                tooltip={`You are ${hunger.descriptor}.`}
                glow={hunger.severity <= 1}
                danger={isDanger(hunger.themeColor)}
                compact={effectiveCompact}
                filtered={filterFlags.hunger}
                onClick={() => toggleFilter('hunger')}
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
                compact={effectiveCompact}
                filtered={filterFlags.thirst}
                onClick={() => toggleFilter('thirst')}
              />
            )}

            {/* Divider between survival and physical */}
            {(hunger || thirst) && (encumbrance || movement) && (
              <div className="w-px h-3.5 bg-border-dim mx-0.5" />
            )}

            {/* Physical group — encumbrance, movement */}
            {encumbrance && (
              <StatusReadout
                icon={<WeightIcon size={11} />}
                label={encumbrance.label}
                color={theme[encumbrance.themeColor]}
                tooltip={encumbrance.descriptor}
                glow={encumbrance.severity <= 1}
                danger={isDanger(encumbrance.themeColor)}
                compact={effectiveCompact}
                filtered={filterFlags.encumbrance}
                onClick={() => toggleFilter('encumbrance')}
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
                compact={effectiveCompact}
                filtered={filterFlags.movement}
                onClick={() => toggleFilter('movement')}
              />
            )}

            {/* Divider before clock */}
            <div className="w-px h-3.5 bg-border-dim mx-0.5" />
          </>
        )}
        <div className={cn('ml-auto', twoRow && 'basis-full flex justify-end')}>
          <GameClock />
        </div>
      </div>
      <CommandInput
        ref={inputRef}
        onSend={sendCommand}
        onReconnect={reconnect}
        disabled={!connected}
        connected={connected}
        passwordMode={passwordMode}
        skipHistory={skipHistory}
      />
    </div>
    </SkillTrackerProvider>
  );
}

export default App;
