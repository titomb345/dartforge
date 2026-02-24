const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';

const TOKEN_KEY = 'dartforge:dropbox_tokens';
const PKCE_VERIFIER_KEY = 'dartforge:pkce_verifier';
const OAUTH_STATE_KEY = 'dartforge:oauth_state';

export interface DropboxTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

export interface DropboxFileEntry {
  name: string;
  path_lower: string;
  rev: string;
  server_modified: string;
}

export interface DropboxFolderEntry {
  name: string;
  path_lower: string;
  path_display: string;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    state,
    token_access_type: 'offline',
  });
  return `${DROPBOX_AUTH_URL}?${params}`;
}

export async function exchangeCodeForTokens(
  clientId: string,
  redirectUri: string,
  code: string,
  codeVerifier: string
): Promise<DropboxTokens> {
  const resp = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string
): Promise<DropboxTokens> {
  const resp = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token refresh failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  return {
    access_token: data.access_token,
    refresh_token: refreshToken, // refresh_token doesn't change on refresh
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

// ---------------------------------------------------------------------------
// File API
// ---------------------------------------------------------------------------

export async function listFiles(
  accessToken: string,
  folderPath: string
): Promise<DropboxFileEntry[]> {
  const resp = await fetch(`${DROPBOX_API_URL}/files/list_folder`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: folderPath, recursive: false }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`list_folder failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  return data.entries
    .filter((e: Record<string, unknown>) => e['.tag'] === 'file')
    .map((e: Record<string, string>) => ({
      name: e.name,
      path_lower: e.path_lower,
      rev: e.rev,
      server_modified: e.server_modified,
    }));
}

export async function listFolders(
  accessToken: string,
  path: string
): Promise<DropboxFolderEntry[]> {
  const resp = await fetch(`${DROPBOX_API_URL}/files/list_folder`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, recursive: false }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`list_folder failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  return data.entries
    .filter((e: Record<string, unknown>) => e['.tag'] === 'folder')
    .map((e: Record<string, string>) => ({
      name: e.name,
      path_lower: e.path_lower,
      path_display: e.path_display,
    }));
}

export async function downloadFile(
  accessToken: string,
  path: string
): Promise<{ content: string; rev: string }> {
  const resp = await fetch(`${DROPBOX_CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`download failed (${resp.status}) for ${path}: ${text}`);
  }
  const resultHeader = resp.headers.get('dropbox-api-result');
  const meta = resultHeader ? JSON.parse(resultHeader) : {};
  const content = await resp.text();
  return { content, rev: meta.rev ?? '' };
}

export async function uploadFile(
  accessToken: string,
  path: string,
  content: string
): Promise<string> {
  const resp = await fetch(`${DROPBOX_CONTENT_URL}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
      'Content-Type': 'application/octet-stream',
    },
    body: content,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`upload failed (${resp.status}) for ${path}: ${text}`);
  }
  const data = await resp.json();
  return data.rev;
}

// ---------------------------------------------------------------------------
// Token persistence (localStorage)
// ---------------------------------------------------------------------------

export function loadTokens(): DropboxTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: DropboxTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isTokenExpired(tokens: DropboxTokens): boolean {
  // Refresh 5 minutes before actual expiry
  return Date.now() >= tokens.expires_at - 5 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// PKCE state persistence (sessionStorage — survives redirect)
// ---------------------------------------------------------------------------

export function savePkceState(verifier: string, state: string): void {
  localStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  localStorage.setItem(OAUTH_STATE_KEY, state);
}

export function loadPkceState(): { verifier: string; state: string } | null {
  const verifier = localStorage.getItem(PKCE_VERIFIER_KEY);
  const state = localStorage.getItem(OAUTH_STATE_KEY);
  if (!verifier || !state) return null;
  return { verifier, state };
}

export function clearPkceState(): void {
  localStorage.removeItem(PKCE_VERIFIER_KEY);
  localStorage.removeItem(OAUTH_STATE_KEY);
}

// ---------------------------------------------------------------------------
// Folder path persistence (localStorage)
// ---------------------------------------------------------------------------

const FOLDER_KEY = 'dartforge:dropbox_folder';

export function loadFolderPath(): string | null {
  return localStorage.getItem(FOLDER_KEY);
}

export function saveFolderPath(path: string): void {
  localStorage.setItem(FOLDER_KEY, path);
}

export function clearFolderPath(): void {
  localStorage.removeItem(FOLDER_KEY);
}

// ---------------------------------------------------------------------------
// Storage mode persistence (localStorage)
// ---------------------------------------------------------------------------

const STORAGE_MODE_KEY = 'dartforge:storage_mode';

export type StorageMode = 'local' | 'dropbox';

export function loadStorageMode(): StorageMode | null {
  return localStorage.getItem(STORAGE_MODE_KEY) as StorageMode | null;
}

export function saveStorageMode(mode: StorageMode): void {
  localStorage.setItem(STORAGE_MODE_KEY, mode);
}

export function clearStorageMode(): void {
  localStorage.removeItem(STORAGE_MODE_KEY);
}
