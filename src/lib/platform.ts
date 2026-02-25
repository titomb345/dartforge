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

/**
 * Flash the taskbar icon (Tauri) or send a browser notification (web)
 * to alert the user when the window is unfocused.
 */
export async function alertUser(title: string, body: string, tag?: string): Promise<void> {
  if (getPlatform() === 'tauri') {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().requestUserAttention(2); // 2 = Informational
    } catch (e) {
      console.error('Taskbar flash failed:', e);
    }
  } else {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
      }
      if (Notification.permission === 'granted') {
        new Notification(title, { body, tag });
      }
    } catch {
      /* ignore */
    }
  }
}
