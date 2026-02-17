import React from 'react';
import ReactDOM from 'react-dom/client';
import { DataStoreProvider } from './contexts/DataStoreContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DataStoreProvider>
      <App />
    </DataStoreProvider>
  </React.StrictMode>
);
