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
import { useMudConnection } from './hooks/useMudConnection';
import { useClassMode } from './hooks/useClassMode';
import { useThemeColors } from './hooks/useThemeColors';
import { useSkillTracker } from './hooks/useSkillTracker';
import { buildXtermTheme } from './lib/defaultTheme';
import { OutputProcessor } from './lib/outputProcessor';
import { matchSkillLine } from './lib/skillPatterns';
import { cn } from './lib/cn';

function App() {
  const terminalRef = useRef<XTerm | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const debugModeRef = useRef(false);
  const [debugMode, setDebugMode] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showSkills, setShowSkills] = useState(false);

  // Set window title with version
  useEffect(() => {
    getVersion().then((v) => {
      getCurrentWindow().setTitle(`DartForge v${v}`);
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

  const { connected, passwordMode, skipHistory, sendCommand, reconnect, disconnect } =
    useMudConnection(terminalRef, debugModeRef, onOutputChunk, onCharacterName);

  // Keep sendCommand ref up to date for the skill tracker
  sendCommandRef.current = sendCommand;

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
      {/* Game status bar — clock right-aligned, left side reserved for concentration/aura */}
      <div className="flex items-center justify-end px-1.5 py-0.5 bg-bg-secondary border-t border-border-subtle">
        <GameClock />
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
