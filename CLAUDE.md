# DartForge — DartMUD Client

## Overview
DartForge is a dedicated desktop MUD client exclusively for **DartMUD** (`dartmud.com:2525`). Built with Tauri v2 (Rust backend + React/TypeScript frontend). Auto-connects on launch — no generic MUD client features.

## Connection
- **Host**: `dartmud.com`
- **Port**: `2525`
- **Protocol**: Raw TCP (with potential Telnet IAC handling)
- Auto-connects on app launch, no server selection UI

## Architecture
- **Rust backend** (`src-tauri/`): Async TCP connection via tokio, Tauri IPC command handlers, event emission
- **React frontend** (`src/`): xterm.js terminal, command input with history, status bar, class mode toggle

## Directory Structure
```
dartforge/
├── CLAUDE.md                     # This file
├── docs/PLAN.md                  # Architecture plan
├── src/                          # React frontend
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # Root layout
│   ├── components/               # UI components
│   │   ├── Terminal.tsx          # xterm.js terminal
│   │   ├── CommandInput.tsx      # Command input with history
│   │   ├── StatusBar.tsx         # Connection status + class toggle
│   │   └── ClassModeToggle.tsx   # Mage/Fighter/Multi toggle
│   ├── hooks/                    # React hooks
│   │   ├── useMudConnection.ts   # Tauri event listeners + sendCommand
│   │   └── useClassMode.ts       # Class mode state
│   ├── lib/                      # Utilities
│   │   ├── constants.ts          # Class mode definitions
│   │   └── tauriEvents.ts       # Event name constants
│   └── types/index.ts            # Shared TS interfaces
└── src-tauri/                    # Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/
        ├── main.rs
        ├── lib.rs                # Tauri builder + state
        ├── connection.rs         # Async TCP to DartMUD
        ├── ansi.rs               # ANSI passthrough
        └── events.rs             # Event payloads
```

## Commands
- `npm run tauri dev` — Run in development mode
- `npm run tauri build` — Build release binary
- `cargo check` — Check Rust code (from src-tauri/)
- `cargo clippy` — Lint Rust code
- `cargo fmt` — Format Rust code

## Code Style
- **TypeScript**: Prettier — single quotes, semicolons, 100-char width
- **Rust**: `cargo fmt` defaults

## Key Patterns
- **Tauri IPC events**: `mud:output` (server → frontend), `mud:connection-status` (status updates)
- **Tauri commands**: `send_command` (frontend → server)
- **State**: `Mutex<Option<mpsc::Sender<String>>>` for command channel

## DartMUD Notes
- Numberless combat interface
- Class archetypes: Mage, Fighter, Multi-class
- Class mode toggle is cosmetic for now, drives feature panels later
- Hex-based map system
- Permadeath mechanics

## GitHub
- Repo: `titomb345/dartforge`
