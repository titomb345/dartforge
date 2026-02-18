export type Platform = 'tauri' | 'web';

export function getPlatform(): Platform {
  return '__TAURI_INTERNALS__' in window ? 'tauri' : 'web';
}

export async function getAppVersion(): Promise<string> {
  if (getPlatform() === 'tauri') {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  }
  return import.meta.env.VITE_APP_VERSION ?? 'web';
}

export async function setWindowTitle(title: string): Promise<void> {
  if (getPlatform() === 'tauri') {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().setTitle(title);
  } else {
    document.title = title;
  }
}
