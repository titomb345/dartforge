import React from 'react';
import ReactDOM from 'react-dom/client';
import { DropboxProvider } from './contexts/DropboxContext';
import { DropboxDataStoreProvider } from './contexts/DropboxDataStoreProvider';
import { TransportProvider } from './contexts/TransportContext';
import { WebSocketTransport } from './lib/WebSocketTransport';
import App from './App';
import './index.css';

// OAuth popup callback — if this page was opened as a popup, post the result
// back to the opener and close. Handles success (?code=), error/cancel
// (?error=), and bare redirects. The popup never renders the full app.
if (window.opener) {
  const params = new URLSearchParams(window.location.search);

  if (params.has('code')) {
    // Success — send auth code back
    window.opener.postMessage(
      {
        type: 'dropbox-oauth-callback',
        code: params.get('code'),
        state: params.get('state'),
      },
      window.location.origin,
    );
  } else {
    // Error, cancellation, or bare redirect — notify opener
    window.opener.postMessage(
      {
        type: 'dropbox-oauth-callback',
        error: params.get('error') || 'cancelled',
      },
      window.location.origin,
    );
  }

  window.close();
} else {
  const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
  const transport = new WebSocketTransport(proxyUrl);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <TransportProvider value={transport}>
        <DropboxProvider>
          <DropboxDataStoreProvider>
            <App />
          </DropboxDataStoreProvider>
        </DropboxProvider>
      </TransportProvider>
    </React.StrictMode>,
  );
}
