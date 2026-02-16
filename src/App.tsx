import { useRef, useState, useEffect } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Terminal } from './components/Terminal';
import { CommandInput } from './components/CommandInput';
import { Toolbar } from './components/Toolbar';
import { ColorSettings } from './components/ColorSettings';
import { useMudConnection } from './hooks/useMudConnection';
import { useClassMode } from './hooks/useClassMode';
import { useThemeColors } from './hooks/useThemeColors';
import { buildXtermTheme } from './lib/defaultTheme';
import { cn } from './lib/cn';

function App() {
  const terminalRef = useRef<XTerm | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const debugModeRef = useRef(false);
  const [debugMode, setDebugMode] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);

  // Set window title with version
  useEffect(() => {
    getVersion().then((v) => {
      getCurrentWindow().setTitle(`DartForge v${v}`);
    }).catch(console.error);
  }, []);

  const { theme, updateColor, resetColor, display, updateDisplay, resetDisplay, resetAll } = useThemeColors();
  const xtermTheme = buildXtermTheme(theme);

  const { connected, passwordMode, skipHistory, sendCommand, reconnect, disconnect } =
    useMudConnection(terminalRef, debugModeRef);
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
      />
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
