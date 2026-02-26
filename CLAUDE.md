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
│   │   ├── settingsMigrations.ts # Settings versioning + migration pipeline
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

## Code Quality Rules
- **Fix ALL build errors and warnings immediately when seen.** Never dismiss them as "pre-existing" or defer them. If `tsc`, `cargo check`, or `cargo clippy` reports an issue, fix it right then and there — no exceptions.

## Code Style
- **TypeScript**: Prettier — single quotes, semicolons, 100-char width
- **Rust**: `cargo fmt` defaults

## Key Patterns
- **Tauri IPC events**: `mud:output` (server → frontend), `mud:connection-status` (status updates)
- **Tauri commands**: `send_command` (frontend → server)
- **State**: `Mutex<Option<mpsc::Sender<String>>>` for command channel

## Settings & Migrations
Settings are persisted via `@tauri-apps/plugin-store` in `settings.json` (Tauri app data dir). On load, a migration pipeline in `src/lib/settingsMigrations.ts` runs before settings are read:
- `_version` key tracks the schema version (missing = `0`, pre-versioning installs)
- Sequential migration functions (`MIGRATIONS[0]` = v0→v1, `MIGRATIONS[1]` = v1→v2, ...) run to reach `CURRENT_VERSION`
- After migrations, the existing spread-defaults pattern (`{ ...DEFAULTS, ...saved }`) acts as a final safety net

**Adding a new migration:**
1. Bump `CURRENT_VERSION` to N+1 in `src/lib/settingsMigrations.ts`
2. Add `MIGRATIONS[N]` function that transforms the store data
3. That's it — existing users' stores get migrated on next launch

## Changelog & Releases
Versioning is automated via CHANGELOG.md bump hints and GitHub Actions.

**Workflow:**
1. Every PR to `main` must include an `[Unreleased-patch]`, `[Unreleased-minor]`, or `[Unreleased-major]` section in CHANGELOG.md (enforced by CI)
2. List changes under that section using [Keep a Changelog](https://keepachangelog.com/) format (Added/Changed/Fixed/Removed)
3. On merge to `main`, the `version-bump.yml` workflow:
   - Reads the bump type from the `[Unreleased-<type>]` header
   - Runs `scripts/bump-version.sh` which updates version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, then stamps the changelog with the new version and date
   - Creates a version bump PR, tags it, and triggers the build-release workflow
4. `build-release.yml` builds the Tauri app on Windows and creates a GitHub Release with notes extracted from CHANGELOG.md

**Version files** (all kept in sync by `scripts/bump-version.sh`):
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

## Guide (`src/lib/helpContent.ts`)
When adding a new feature, panel, keyboard shortcut, or non-obvious interaction, update the in-app guide:
- **New panel** → add entry to the "Panels & Layout" section (`key: 'panels'`)
- **New keyboard shortcut** → add entry to "Keyboard Shortcuts" (`key: 'shortcuts'`)
- **Non-obvious interaction** (right-click, double-click, drag, hover) → add to "Hidden Powers" (`key: 'hidden'`) with the appropriate `interaction` type
- **New built-in command** (`/echo`, `/delay`, etc.) → add to "Built-in Commands" (`key: 'commands'`)
- If the feature has a toolbar button, set `helpId` to match its `data-help-id` (e.g., `'toolbar-timers'`) so the "Show me" spotlight works

## DartMUD Notes
- Numberless combat interface
- Class archetypes: Mage, Fighter, Multi-class
- Class mode toggle is cosmetic for now, drives feature panels later
- Hex-based map system
- Permadeath mechanics

## Git Workflow
- **NEVER commit directly to `main`.** Always create a new feature branch.
- When asked to commit, check the current branch first. If on `main`, create a contextual branch (e.g., `feature/skill-tracker`, `fix/connection-bug`) before committing.
- PRs go to `main` (the only long-lived branch — there is no `staging` branch).

## GitHub
- Repo: `titomb345/dartforge`
