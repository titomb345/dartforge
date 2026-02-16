import { useRef } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { Terminal } from './components/Terminal';
import { CommandInput } from './components/CommandInput';
import { Toolbar } from './components/Toolbar';
import { useMudConnection } from './hooks/useMudConnection';
import { useClassMode } from './hooks/useClassMode';

function App() {
  const terminalRef = useRef<XTerm | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const { connected, passwordMode, skipHistory, sendCommand, reconnect, disconnect } =
    useMudConnection(terminalRef);
  const { classMode, setClassMode } = useClassMode();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0d0d0d',
        color: '#e0e0e0',
      }}
    >
      <Toolbar
        connected={connected}
        onReconnect={reconnect}
        onDisconnect={disconnect}
        classMode={classMode}
        onClassModeChange={setClassMode}
      />
      <Terminal terminalRef={terminalRef} inputRef={inputRef} />
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
