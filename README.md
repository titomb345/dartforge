# DartForge

A dedicated desktop client for [DartMUD](http://dartmud.com), built with Tauri v2, React, and xterm.js.

DartForge connects directly to `dartmud.com:2525` on launch -- no server lists, no configuration dialogs. It's a single-purpose client built for one MUD.

<!-- ![DartForge screenshot](docs/screenshot.png) -->

## Features

- **Auto-connect** -- launches straight into DartMUD with connection/disconnection splash screens
- **xterm.js terminal** -- full ANSI color support, clickable links, 10k line scrollback
- **Command history** -- arrow keys to recall previous commands, with password masking for login prompts
- **Appearance panel** -- customize all 16 ANSI colors plus background/foreground/cursor via color picker (react-colorful), choose font family and size
- **Persistent settings** -- colors, font, and display preferences saved across sessions (tauri-plugin-store)
- **Font zoom** -- `Ctrl +`/`Ctrl -` to resize on the fly, `Ctrl 0` to reset
- **Debug mode** -- shows human-readable ANSI color labels (e.g. `[bright green]`) inline with terminal output, useful for tuning your theme
- **Smart scrolling** -- new output won't yank you back to the bottom if you're reading history

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Shell    | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React 19, TypeScript |
| Terminal | [xterm.js](https://xtermjs.org/) v6 with fit + web-links addons |
| Network  | tokio async TCP (Rust backend) |
| Storage  | tauri-plugin-store for persistent settings |
| Build    | Vite 7, Cargo |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) v25+ (see `.nvmrc`)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Tauri v2 system dependencies -- see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
git clone https://github.com/titomb345/dartforge.git
cd dartforge
npm install
```

### Run (dev mode)

```bash
npm run tauri dev
```

This starts Vite's dev server and launches the Tauri window with hot-reload.

### Build

```bash
npm run tauri build
```

Produces platform-specific installers in `src-tauri/target/release/bundle/`.

### Rust-only checks

```bash
cd src-tauri
cargo check      # type-check
cargo clippy      # lint
cargo fmt         # format
```

## Project Structure

```
dartforge/
├── src/                          # React frontend
│   ├── App.tsx                   # Root layout
│   ├── components/
│   │   ├── Terminal.tsx          # xterm.js terminal wrapper
│   │   ├── CommandInput.tsx      # Input with history + password masking
│   │   ├── Toolbar.tsx           # Top bar (connect/disconnect, appearance toggle)
│   │   └── ColorSettings.tsx     # Appearance panel (colors, font, debug)
│   ├── hooks/
│   │   ├── useMudConnection.ts   # Tauri IPC listeners, send/reconnect/disconnect
│   │   └── useThemeColors.ts     # Persistent theme + display settings
│   └── lib/
│       ├── defaultTheme.ts       # Default ANSI color palette
│       └── splash.ts             # ASCII art for connect/disconnect screens
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Tauri setup, IPC commands, state
│   │   ├── connection.rs         # Async TCP connection to DartMUD
│   │   ├── ansi.rs               # ANSI passthrough handling
│   │   └── events.rs             # Event payloads
│   └── tauri.conf.json           # Tauri app config
├── scripts/
│   └── bump-version.sh           # Automated version bumper
├── .github/workflows/
│   ├── ci.yml                    # PR checks (tsc, cargo check, clippy)
│   ├── version-bump.yml          # Auto-bump on merge to main
│   └── build-release.yml         # Build + GitHub Release on tag push
└── CHANGELOG.md                  # Drives versioning (see below)
```

## Versioning & Releases

DartForge uses a CHANGELOG-driven versioning system. No manual version edits needed.

1. Add changes under an `[Unreleased-patch]`, `[Unreleased-minor]`, or `[Unreleased-major]` header in `CHANGELOG.md`
2. Open a PR to `main` -- CI runs TypeScript and Rust checks
3. On merge, GitHub Actions reads the bump type from the changelog header, bumps the version in `package.json`, `tauri.conf.json`, and `Cargo.toml`, stamps the changelog with the new version and date, then tags the commit
4. The tag triggers a build workflow that compiles the Tauri app and creates a GitHub Release with the changelog entry as release notes

## About DartMUD

[DartMUD](http://dartmud.com) is a text-based multiplayer game (MUD) featuring hex-based exploration, a numberless combat system, class archetypes (Mage, Fighter, Multi-class), and permadeath mechanics. It's been running at `dartmud.com:2525` for decades.
