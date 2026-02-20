import React from 'react';
import ReactDOM from 'react-dom/client';
import { DataStoreProvider } from './contexts/TauriDataStoreProvider';
import { TransportProvider } from './contexts/TransportContext';
import { TauriTransport } from './lib/TauriTransport';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const transport = new TauriTransport();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TransportProvider value={transport}>
      <DataStoreProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </DataStoreProvider>
    </TransportProvider>
  </React.StrictMode>
);
