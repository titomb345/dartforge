import { useRef } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { Terminal } from './components/Terminal';
import { CommandInput } from './components/CommandInput';
import { StatusBar } from './components/StatusBar';
import { useMudConnection } from './hooks/useMudConnection';
import { useClassMode } from './hooks/useClassMode';

function App() {
  const terminalRef = useRef<XTerm | null>(null);
  const { connected, statusMessage, sendCommand } = useMudConnection(terminalRef);
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
      <StatusBar
        connected={connected}
        statusMessage={statusMessage}
        classMode={classMode}
        onClassModeChange={setClassMode}
      />
      <Terminal terminalRef={terminalRef} />
      <CommandInput onSend={sendCommand} disabled={!connected} />
    </div>
  );
}

export default App;
