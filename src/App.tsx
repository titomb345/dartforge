import { useRef, useState, useEffect, useCallback } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Terminal } from './components/Terminal';
import { CommandInput } from './components/CommandInput';
import { Toolbar } from './components/Toolbar';
import { ColorSettings } from './components/ColorSettings';
import { SkillPanel } from './components/SkillPanel';
import { GameClock } from './components/GameClock';
import { StatusReadout } from './components/StatusReadout';
import { HeartIcon, FocusIcon, FoodIcon, DropletIcon, AuraIcon, WeightIcon, BootIcon, FilterIcon } from './components/icons';
import { useMudConnection } from './hooks/useMudConnection';
import { useClassMode } from './hooks/useClassMode';
import { useThemeColors } from './hooks/useThemeColors';
import { useSkillTracker } from './hooks/useSkillTracker';
import { useConcentration } from './hooks/useConcentration';
import { useHealth } from './hooks/useHealth';
import { useNeeds } from './hooks/useNeeds';
import { useAura } from './hooks/useAura';
import { useEncumbrance } from './hooks/useEncumbrance';
import { useMovement } from './hooks/useMovement';
import { load } from '@tauri-apps/plugin-store';
import { buildXtermTheme } from './lib/defaultTheme';
import { OutputProcessor } from './lib/outputProcessor';
import { OutputFilter } from './lib/outputFilter';
import { matchSkillLine } from './lib/skillPatterns';
import { cn } from './lib/cn';

function App() {
  const terminalRef = useRef<XTerm | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const debugModeRef = useRef(false);
  const [debugMode, setDebugMode] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  // Set window title with version + load compact mode from settings
  useEffect(() => {
    getVersion().then((v) => {
      getCurrentWindow().setTitle(`DartForge v${v}`);
    }).catch(console.error);
    load('settings.json').then(async (store) => {
      const saved = await store.get<boolean>('compactMode');
      if (saved != null) setCompactMode(saved);
    }).catch(console.error);
  }, []);

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

  // Keep compact mode in sync with the filter + persist
  useEffect(() => {
    if (outputFilterRef.current) {
      outputFilterRef.current.compactMode = compactMode;
    }
    load('settings.json').then((store) => store.set('compactMode', compactMode)).catch(console.error);
  }, [compactMode]);

  // Skill tracker — needs sendCommand ref (set after useMudConnection)
  const sendCommandRef = useRef<((cmd: string) => Promise<void>) | null>(null);
  const { activeCharacter, skillData, setActiveCharacter, handleSkillMatch, showInlineImproves, toggleInlineImproves } =
    useSkillTracker(sendCommandRef, processorRef, terminalRef);

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
    // Suppress all sync output so login/reconnect is invisible to the user.
    // Extra counts beyond LOGIN_COMMANDS.length account for server-initiated
    // prompts: the post-login prompt on fresh login, and the server-sent
    // score block prompt on reconnect.
    outputFilterRef.current?.startSync(LOGIN_COMMANDS.length + 2);
    for (const cmd of LOGIN_COMMANDS) {
      sendCommandRef.current?.(cmd);
    }
    setLoggedIn(true);
  }, []);

  const { connected, passwordMode, skipHistory, sendCommand, reconnect, disconnect } =
    useMudConnection(terminalRef, debugModeRef, onOutputChunk, onCharacterName, outputFilterRef, onLogin);

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

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary relative">
      <Toolbar
        connected={connected}
        onReconnect={reconnect}
        onDisconnect={disconnect}
        showAppearance={showAppearance}
        onToggleAppearance={() => setShowAppearance((v) => !v)}
        showSkills={showSkills}
        onToggleSkills={() => setShowSkills((v) => !v)}
      />
      <div className="flex-1 overflow-hidden flex flex-row relative">
        {/* Left: Terminal + overlays */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          <Terminal terminalRef={terminalRef} inputRef={inputRef} theme={xtermTheme} display={display} onUpdateDisplay={updateDisplay} />
          <div
            className={cn(
              'absolute top-0 right-0 bottom-0 z-[100] transition-transform duration-300 ease-in-out',
              showAppearance ? 'translate-x-0' : 'translate-x-full'
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
        </div>
        {/* Right: Skill panel — inline on xl+, overlay on smaller screens */}
        <div
          className={cn(
            'h-full overflow-hidden transition-all duration-300 ease-in-out',
            // xl+: inline panel (pushes terminal content)
            showSkills ? 'xl:w-[360px]' : 'xl:w-0',
            // <xl: overlay panel (slides over content)
            'max-xl:absolute max-xl:right-0 max-xl:top-0 max-xl:bottom-0 max-xl:z-[100] max-xl:w-[360px]',
            showSkills ? 'max-xl:translate-x-0' : 'max-xl:translate-x-full',
          )}
        >
          <SkillPanel
            activeCharacter={activeCharacter}
            skillData={skillData}
            showInlineImproves={showInlineImproves}
            onToggleInlineImproves={toggleInlineImproves}
          />
        </div>
      </div>
      {/* Game status bar — vitals left, clock right */}
      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-bg-secondary border-t border-border-subtle">
        {loggedIn && (
          <>
            <button
              onClick={() => setCompactMode((v) => !v)}
              title={compactMode ? 'Compact mode: status messages hidden from terminal' : 'Verbose mode: status messages shown in terminal'}
              className={cn(
                'flex items-center justify-center w-5 h-5 rounded-[3px] transition-all duration-200 border cursor-pointer',
                compactMode
                  ? 'text-cyan border-cyan/25 bg-cyan/8'
                  : 'text-text-dim border-transparent hover:text-text-muted'
              )}
            >
              <FilterIcon size={10} />
            </button>
        {health && (
          <StatusReadout
            icon={<HeartIcon size={11} />}
            label={health.label}
            color={theme[health.themeColor]}
            tooltip={health.message}
            glow={health.severity <= 1}
            onClick={compactMode ? undefined : () => sendCommand('hp')}
          />
        )}
        {concentration && (
          <StatusReadout
            icon={<FocusIcon size={11} />}
            label={concentration.label}
            color={theme[concentration.themeColor]}
            tooltip={concentration.message}
            glow={concentration.severity <= 1}
            onClick={compactMode ? undefined : () => sendCommand('conc')}
          />
        )}
        {aura && (
          <StatusReadout
            icon={<AuraIcon size={11} />}
            label={aura.label}
            color={theme[aura.themeColor]}
            tooltip={aura.key === 'none' ? 'You have no aura.' : `Your aura appears to be ${aura.descriptor}.`}
            glow={aura.severity <= 1}
            onClick={compactMode ? undefined : () => sendCommand('aura')}
          />
        )}
        {hunger && (
          <StatusReadout
            icon={<FoodIcon size={11} />}
            label={hunger.label}
            color={theme[hunger.themeColor]}
            tooltip={`You are ${hunger.descriptor}.`}
            glow={hunger.severity <= 1}
            onClick={compactMode ? undefined : () => sendCommand('score')}
          />
        )}
        {thirst && (
          <StatusReadout
            icon={<DropletIcon size={11} />}
            label={thirst.label}
            color={theme[thirst.themeColor]}
            tooltip={`You are ${thirst.descriptor}.`}
            glow={thirst.severity <= 1}
            onClick={compactMode ? undefined : () => sendCommand('score')}
          />
        )}
        {encumbrance && (
          <StatusReadout
            icon={<WeightIcon size={11} />}
            label={encumbrance.label}
            color={theme[encumbrance.themeColor]}
            tooltip={encumbrance.descriptor}
            glow={encumbrance.severity <= 1}
            onClick={compactMode ? undefined : () => sendCommand('score')}
          />
        )}
        {movement && (
          <StatusReadout
            icon={<BootIcon size={11} />}
            label={movement.label}
            color={theme[movement.themeColor]}
            tooltip={movement.descriptor}
            glow={movement.severity <= 1}
            onClick={compactMode ? undefined : () => sendCommand('score')}
          />
        )}
          </>
        )}
        <div className="ml-auto">
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
  );
}

export default App;
