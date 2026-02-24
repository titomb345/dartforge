import { useState, type ReactNode } from 'react';
import { HelpSection } from './HelpSection';
import { useSpotlight } from '../contexts/SpotlightContext';
import { useAppSettingsContext } from '../contexts/AppSettingsContext';
import { usePanelContext } from '../contexts/PanelLayoutContext';
import {
  HELP_CATEGORIES,
  QUICK_TOUR_STEPS,
  type HelpItem as HelpItemData,
  type InteractionType,
} from '../lib/helpContent';
import { PowerIcon, ChatIcon, TrendingUpIcon, AliasIcon, HelpIcon } from './icons';

const GOLD = '#d9af50';
const GOLD_DIM = 'rgba(217, 175, 80, 0.3)';
const GOLD_BG = 'rgba(217, 175, 80, 0.08)';

/* ── Section Icon Mapping ────────────────────────────────── */

const SECTION_ICONS: Record<string, ReactNode> = {
  power: <PowerIcon size={13} />,
  layout: (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="9" y1="12" x2="21" y2="12" />
    </svg>
  ),
  sparkle: (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  ),
  keyboard: (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="6" y1="8" x2="6" y2="8" />
      <line x1="10" y1="8" x2="10" y2="8" />
      <line x1="14" y1="8" x2="14" y2="8" />
      <line x1="18" y1="8" x2="18" y2="8" />
      <line x1="6" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="18" y2="12" />
      <line x1="8" y1="16" x2="16" y2="16" />
    </svg>
  ),
  terminal: (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  alias: <AliasIcon size={13} />,
  chat: <ChatIcon size={13} />,
  data: <TrendingUpIcon size={13} />,
};

/* ── Interaction Badge ───────────────────────────────────── */

function InteractionBadge({ type }: { type: InteractionType }) {
  return (
    <span
      className="shrink-0"
      style={{
        fontSize: 8,
        fontFamily: 'inherit',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        padding: '1px 4px',
        borderRadius: 3,
        color: GOLD,
        border: `1px solid rgba(217, 175, 80, 0.2)`,
        background: 'rgba(217, 175, 80, 0.06)',
      }}
    >
      {type}
    </span>
  );
}

/* ── Keyboard Shortcut Display ───────────────────────────── */

function KbdDisplay({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {keys.map((k, i) => (
        <kbd key={i} className="help-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/* ── Show Me Button ──────────────────────────────────────── */

function ShowMeButton({ helpId, description }: { helpId: string; description: string }) {
  const { highlight } = useSpotlight();

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        highlight(helpId, description);
      }}
      className="show-me-btn shrink-0 cursor-pointer transition-colors duration-150"
      style={{
        fontSize: 9,
        fontFamily: 'inherit',
        padding: '1px 6px',
        borderRadius: 10,
        color: GOLD,
        border: `1px solid ${GOLD_DIM}`,
        background: GOLD_BG,
        whiteSpace: 'nowrap',
      }}
    >
      Show me
    </button>
  );
}

/* ── Single Help Item Row ────────────────────────────────── */

function HelpItemRow({ item }: { item: HelpItemData }) {
  return (
    <div className="py-1.5 border-border-dim" style={{ borderBottom: '1px solid #1a1a1a' }}>
      <div className="flex items-center gap-1.5 mb-0.5">
        {item.interaction && <InteractionBadge type={item.interaction} />}
        <span className="text-[11px] text-text-primary font-medium flex-1">{item.title}</span>
        {item.kbd && <KbdDisplay keys={item.kbd} />}
        {item.helpId && <ShowMeButton helpId={item.helpId} description={item.description} />}
      </div>
      <p className="text-[10px] text-text-muted leading-[1.5]">{item.description}</p>
    </div>
  );
}

/* ── Welcome Banner ──────────────────────────────────────── */

function WelcomeBanner() {
  const { startTour } = useSpotlight();
  const { togglePanel } = usePanelContext();
  const { updateHasSeenGuide } = useAppSettingsContext();

  const handleTour = () => {
    updateHasSeenGuide(true);
    togglePanel('help');
    setTimeout(() => {
      startTour(QUICK_TOUR_STEPS);
    }, 350);
  };

  const handleDismiss = () => {
    updateHasSeenGuide(true);
  };

  return (
    <div
      className="rounded-lg p-3 mb-3"
      style={{
        background:
          'linear-gradient(135deg, rgba(217, 175, 80, 0.06) 0%, rgba(217, 175, 80, 0.02) 100%)',
        border: `1px solid ${GOLD_DIM}`,
      }}
    >
      <h3 className="text-[13px] font-semibold mb-1" style={{ color: GOLD }}>
        Welcome to DartForge
      </h3>
      <p className="text-[10px] text-text-muted leading-[1.5] mb-3">
        This client is built for DartMUD and packed with features to help you play. Take a quick
        tour to see the highlights, or browse the sections below at your own pace.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={handleTour}
          className="cursor-pointer transition-colors duration-150"
          style={{
            fontSize: 10,
            fontFamily: 'inherit',
            padding: '4px 12px',
            borderRadius: 4,
            color: '#0d0d0d',
            background: GOLD,
            border: 'none',
            fontWeight: 600,
          }}
        >
          Take a quick tour
        </button>
        <button
          onClick={handleDismiss}
          className="cursor-pointer transition-colors duration-150"
          style={{
            fontSize: 10,
            fontFamily: 'inherit',
            padding: '4px 12px',
            borderRadius: 4,
            color: '#888',
            background: 'transparent',
            border: '1px solid #333',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/* ── Main Panel ──────────────────────────────────────────── */

export function HelpPanel() {
  const { hasSeenGuide } = useAppSettingsContext();
  const defaultOpen = HELP_CATEGORIES.find((c) => c.defaultOpen)?.key ?? null;
  const [openSection, setOpenSection] = useState<string | null>(defaultOpen);

  return (
    <div className="h-full w-[380px] flex flex-col bg-bg-primary border-l border-border-dim">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{
          borderBottom: `1px solid ${GOLD_DIM}`,
          background: 'linear-gradient(to right, rgba(217, 175, 80, 0.04), transparent)',
        }}
      >
        <span style={{ color: GOLD }}>
          <HelpIcon size={14} />
        </span>
        <span
          className="text-[12px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: GOLD }}
        >
          Guide
        </span>
        <div className="flex-1" />
        <span className="text-[9px] text-text-dim">? for help anytime</span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {!hasSeenGuide && <WelcomeBanner />}

        {HELP_CATEGORIES.map((cat) => (
          <HelpSection
            key={cat.key}
            icon={SECTION_ICONS[cat.iconName] ?? <HelpIcon size={13} />}
            title={cat.title}
            open={openSection === cat.key}
            onToggle={() => setOpenSection((prev) => (prev === cat.key ? null : cat.key))}
          >
            {cat.items.map((item, i) => (
              <HelpItemRow key={i} item={item} />
            ))}
          </HelpSection>
        ))}
      </div>
    </div>
  );
}
