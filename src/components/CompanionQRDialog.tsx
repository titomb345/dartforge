import { useState, useEffect } from 'react';
import { SmartphoneIcon } from './icons';
import { getPlatform } from '../lib/platform';

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
if (getPlatform() === 'tauri') {
  import('@tauri-apps/api/core').then((m) => { invoke = m.invoke; });
}

interface CompanionInfo {
  running: boolean;
  url: string;
  qr_svg: string;
  local_ip: string;
  port: number;
}

export function CompanionQRDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<CompanionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!invoke) return;
    invoke('get_companion_info')
      .then((result) => setInfo(result as CompanionInfo))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#282a36] border border-[#44475a] rounded-lg p-6 flex flex-col items-center gap-3 shadow-2xl max-w-[340px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-[#8be9fd]">
          <SmartphoneIcon size={18} />
          <span className="text-[14px] font-mono font-bold">Mobile Companion</span>
        </div>

        {loading ? (
          <div className="text-[12px] font-mono text-[#6272a4] py-4">Loading...</div>
        ) : !info?.running ? (
          <div className="text-[12px] font-mono text-[#6272a4] py-4 text-center leading-relaxed">
            Companion server is not running.<br />
            Enable it in Settings &gt; Mobile Companion.
          </div>
        ) : (
          <>
            <a
              href={info.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] font-mono text-[#8be9fd] underline"
            >
              {info.url}
            </a>
            {info.qr_svg && (
              <div dangerouslySetInnerHTML={{ __html: info.qr_svg }} />
            )}
            <div className="text-[10px] font-mono text-[#6272a4]">
              Scan with your phone camera
            </div>
          </>
        )}

        <button
          onClick={onClose}
          className="mt-1 px-4 py-1.5 text-[11px] font-mono font-semibold rounded bg-[#44475a] text-[#f8f8f2] hover:bg-[#6272a4] transition-colors cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  );
}
