# DartForge — DartMUD Client Scaffold Plan

## Context

We're building **DartForge**, a dedicated desktop MUD client exclusively for DartMUD (`dartmud.com:2525`). It's a Tauri v2 app (Rust backend + React/TypeScript frontend) that auto-connects on launch — no generic MUD client features.

The user doesn't have Rust installed yet, so Phase 0 covers toolchain setup.

DartMUD has mage, fighter, and multi-class archetypes. A class mode toggle in the status bar will switch UI context (cosmetic for now, drives feature panels later).

## Phase 0: Git Repo Setup

1. Create `C:\Users\titom\Projects\dartforge\` directory
2. `git init` + initial commit
3. Create GitHub repo on `titomb345` account: `gh repo create titomb345/dartforge --public --source=.`
4. Write `CLAUDE.md` with project conventions and architecture docs
5. Copy this plan into `docs/PLAN.md` in the repo for future session context

## Phase 0.5: Prerequisites

1. **Install Rust** via `winget install --id Rustlang.Rustup`, then `rustup default stable-msvc`
2. **Verify WebView2** — pre-installed on Windows 11, no action needed
3. **Verify Node 24** — already installed for CreatiCalc

## Phase 1: Scaffold the Tauri project

```
cd C:\Users\titom\Projects
npm create tauri-app@latest dartforge
# Select: TypeScript, npm, React, TypeScript
cd dartforge
npm install
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
npm install -D tailwindcss @tailwindcss/vite
```

Verify scaffold works with `npm run tauri dev` (first Rust compile takes ~5-10 min).

## Phase 2: Project Structure

```
dartforge/
├── CLAUDE.md                     # Claude Code project instructions
├── docs/
│   └── PLAN.md                   # Architecture plan for future sessions
├── src/                          # React frontend
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # Root: StatusBar + Terminal + CommandInput
│   ├── index.css                 # Tailwind + dark MUD theme tokens
│   ├── components/
│   │   ├── Terminal.tsx          # xterm.js terminal panel
│   │   ├── CommandInput.tsx      # Input with command history (up/down arrows)
│   │   ├── StatusBar.tsx         # Connection dot + status text + class toggle
│   │   └── ClassModeToggle.tsx   # Mage / Fighter / Multi button group
│   ├── hooks/
│   │   ├── useMudConnection.ts   # Tauri event listeners + sendCommand invoke
│   │   └── useClassMode.ts       # Class mode state (mage/fighter/multi)
│   ├── lib/
│   │   ├── constants.ts          # Class mode definitions
│   │   └── tauriEvents.ts       # Event name constants matching Rust
│   └── types/
│       └── index.ts              # Shared TS interfaces
└── src-tauri/                    # Rust backend
    ├── Cargo.toml                # + tokio, serde, serde_json, log, env_logger
    ├── tauri.conf.json           # DartForge identity, 1200x800 window
    ├── capabilities/default.json # IPC permissions
    └── src/
        ├── main.rs               # Calls lib::run()
        ├── lib.rs                # Tauri builder, state mgmt, command handlers
        ├── connection.rs         # Async TCP to dartmud.com:2525, read/write loops
        ├── ansi.rs               # Passthrough for now (xterm.js renders ANSI)
        └── events.rs             # Event payload structs + name constants
```

## Phase 3: Rust Backend

### Crate dependencies (add to existing Cargo.toml)
- `tokio` (net, io-util, sync, macros, rt) — async TCP
- `serde` + `serde_json` — IPC payload serialization
- `log` + `env_logger` — dev logging

### Key files

**`connection.rs`** — The core. Uses `TcpStream::connect("dartmud.com:2525")`, splits into read/write halves. Read loop emits `mud:output` events to frontend. Write loop receives commands from an `mpsc::Receiver<String>`.

**`lib.rs`** — Stores `mpsc::Sender` in Tauri managed state (`Mutex<Option<Sender>>`). Registers `send_command` invoke handler. Spawns connection in `setup()` so it auto-connects on launch.

**`events.rs`** — Defines `MudOutputPayload { data: String }` and `ConnectionStatusPayload { connected: bool, message: String }`.

**`ansi.rs`** — `String::from_utf8_lossy` passthrough. Future home for DartMUD-specific parsing.

### Telnet note
Raw TCP should work initially. If DartMUD sends Telnet IAC negotiation sequences (0xFF bytes), we'll handle them incrementally in `connection.rs`.

## Phase 4: React Frontend

### Theme (index.css)
Dark background (`#0d0d0d`), monospace font, class-specific accent colors:
- Mage: `#a78bfa` (purple)
- Fighter: `#f59e0b` (amber)
- Multi: `#10b981` (green)

### Components

**`Terminal.tsx`** — xterm.js with FitAddon + WebLinksAddon. Dark theme matching CSS tokens. 10K line scrollback. ResizeObserver for dynamic fitting.

**`CommandInput.tsx`** — Text input + Send button. Up/Down arrow command history (100 entries). Auto-focus. Disabled when disconnected.

**`StatusBar.tsx`** — Green/red connection dot, status message, class mode toggle, version label.

**`ClassModeToggle.tsx`** — Three buttons (Mage/Fighter/Multi). Highlights active mode with class-specific accent color. Cosmetic for now.

### Hooks

**`useMudConnection`** — Listens for `mud:output` and `mud:connection-status` Tauri events. Writes output to xterm.js terminal ref. Exposes `sendCommand` via `invoke('send_command')`.

**`useClassMode`** — Simple `useState<'mage' | 'fighter' | 'multi'>` with a setter.

### Layout
```
┌─ StatusBar ─────────────────────────────────┐
│ 🟢 Connected to dartmud.com:2525    [M][F][X] │
├─────────────────────────────────────────────┤
│                                             │
│              xterm.js Terminal              │
│            (fills remaining space)          │
│                                             │
├─────────────────────────────────────────────┤
│ > [command input_______________] [Send]     │
└─────────────────────────────────────────────┘
```

## Phase 5: Config

- **tauri.conf.json**: productName "DartForge", window title "DartForge — DartMUD Client", 1200x800, min 800x600
- **Vite**: Add `@tailwindcss/vite` plugin, `@` path alias
- **.prettierrc.json**: Match CreatiCalc style (single quotes, semis, 100-char width)

## End State

After scaffold is complete, `npm run tauri dev` opens a desktop window that:
1. Auto-connects to dartmud.com:2525
2. Displays DartMUD output with full ANSI colors in xterm.js
3. Accepts commands via input box (Enter to send, Up/Down for history)
4. Shows connection status in the status bar
5. Has a class mode toggle (Mage/Fighter/Multi) — cosmetic for now

## Known Risks

- **Telnet IAC negotiation**: DartMUD may require responding to telnet protocol sequences. If the connection drops or behaves oddly, we add IAC handling to `connection.rs`.
- **Tailwind dynamic classes**: `ClassModeToggle` uses dynamic `bg-accent-*` classes — will use a static lookup object to ensure Tailwind picks them up.
- **First Rust compile**: ~5-10 min to download and compile all crates. Subsequent builds are fast.
