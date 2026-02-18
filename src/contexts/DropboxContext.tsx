import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  loadTokens, saveTokens, clearTokens, isTokenExpired,
  refreshAccessToken, exchangeCodeForTokens,
  generateCodeVerifier, generateCodeChallenge,
  buildAuthUrl, savePkceState, loadPkceState, clearPkceState,
  loadFolderPath, saveFolderPath, clearFolderPath,
  clearStorageMode,
  type DropboxTokens,
} from '../lib/dropbox';

export type DropboxStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface DropboxState {
  status: DropboxStatus;
  accessToken: string | null;
  /** Selected Dropbox folder path (e.g. "/DartForge"), or null if not yet chosen */
  folderPath: string | null;
  connect: () => void;
  disconnect: () => void;
  selectFolder: (path: string) => void;
}

const DropboxContext = createContext<DropboxState | null>(null);

export function useDropbox(): DropboxState {
  const ctx = useContext(DropboxContext);
  if (!ctx) throw new Error('useDropbox must be used within DropboxProvider');
  return ctx;
}

const CLIENT_ID = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined;

function getRedirectUri(): string {
  return window.location.origin + window.location.pathname;
}

export function DropboxProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DropboxStatus>('disconnected');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(loadFolderPath);
  const tokensRef = useRef<DropboxTokens | null>(null);
  const popupRef = useRef<Window | null>(null);

  // Ensure a valid access token, refreshing if needed
  const ensureToken = useCallback(async (tokens: DropboxTokens): Promise<string | null> => {
    if (!CLIENT_ID) return null;
    if (!isTokenExpired(tokens)) return tokens.access_token;

    try {
      const refreshed = await refreshAccessToken(CLIENT_ID, tokens.refresh_token);
      saveTokens(refreshed);
      tokensRef.current = refreshed;
      setAccessToken(refreshed.access_token);
      return refreshed.access_token;
    } catch (e) {
      console.error('Dropbox token refresh failed:', e);
      setStatus('error');
      return null;
    }
  }, []);

  // On mount: restore saved tokens (no redirect detection — popup handles that)
  useEffect(() => {
    if (!CLIENT_ID) return;

    const saved = loadTokens();
    if (saved) {
      setStatus('connecting');
      ensureToken(saved).then((token) => {
        if (token) {
          tokensRef.current = saved;
          setAccessToken(token);
          setStatus('connected');
        } else {
          // Token refresh failed — stay in error, don't clear tokens
          // User can retry from the error screen
          setStatus('error');
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for OAuth callback from popup window (success or error)
  useEffect(() => {
    if (!CLIENT_ID) return;

    function handleMessage(event: MessageEvent) {
      // Only accept messages from our own origin
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'dropbox-oauth-callback') return;

      popupRef.current = null;

      // User cancelled or Dropbox returned an error
      if (event.data.error) {
        clearPkceState();
        setStatus('disconnected');
        return;
      }

      const { code, state } = event.data;
      if (!code || !state) {
        clearPkceState();
        setStatus('disconnected');
        return;
      }

      const pkce = loadPkceState();
      if (!pkce || pkce.state !== state) {
        console.error('Dropbox OAuth state mismatch');
        clearPkceState();
        setStatus('error');
        return;
      }

      setStatus('connecting');
      exchangeCodeForTokens(CLIENT_ID!, getRedirectUri(), code, pkce.verifier)
        .then((tokens) => {
          saveTokens(tokens);
          tokensRef.current = tokens;
          setAccessToken(tokens.access_token);
          setStatus('connected');
          clearPkceState();
        })
        .catch((e) => {
          console.error('Dropbox token exchange failed:', e);
          clearPkceState();
          setStatus('error');
        });
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh token periodically (only check local timestamp, API call only if expired)
  useEffect(() => {
    if (status !== 'connected') return;

    const interval = setInterval(async () => {
      const tokens = tokensRef.current;
      if (tokens && isTokenExpired(tokens)) {
        await ensureToken(tokens);
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, [status, ensureToken]);

  const connect = useCallback(async () => {
    if (!CLIENT_ID) {
      console.error('VITE_DROPBOX_APP_KEY not configured');
      return;
    }

    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = crypto.randomUUID();

    savePkceState(verifier, state);
    setStatus('connecting');

    const authUrl = buildAuthUrl(CLIENT_ID, getRedirectUri(), challenge, state);
    const popup = window.open(authUrl, 'dropbox-auth', 'width=600,height=700');

    if (!popup) {
      // Popup blocked — fall back to redirect
      window.location.href = authUrl;
      return;
    }

    popupRef.current = popup;

    // Poll for popup closure — if the user closes the window manually
    // (clicks X) without completing auth, revert from 'connecting'
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollTimer);
        popupRef.current = null;
        // Only revert if we're still waiting (no message was received)
        setStatus((prev) => (prev === 'connecting' ? 'disconnected' : prev));
      }
    }, 500);
  }, []);

  const disconnect = useCallback(() => {
    clearTokens();
    clearFolderPath();
    clearStorageMode();
    tokensRef.current = null;
    setAccessToken(null);
    setFolderPath(null);
    setStatus('disconnected');
  }, []);

  const selectFolder = useCallback((path: string) => {
    saveFolderPath(path);
    setFolderPath(path);
  }, []);

  return (
    <DropboxContext.Provider value={{ status, accessToken, folderPath, connect, disconnect, selectFolder }}>
      {children}
    </DropboxContext.Provider>
  );
}
