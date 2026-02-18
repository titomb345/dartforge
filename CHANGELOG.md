# Changelog

All notable changes to DartForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

The `[Unreleased]` header controls automatic version bumping on merge:
- `[Unreleased-patch]` → 0.1.0 → 0.1.1
- `[Unreleased-minor]` → 0.1.0 → 0.2.0
- `[Unreleased-major]` → 0.1.0 → 1.0.0

## [Unreleased-minor]

### Added
- Web client — play DartMUD in any browser via WebSocket proxy
- WebSocket-to-TCP proxy server (Rust) with Fly.io deployment config
- Dropbox integration with popup OAuth (PKCE), folder picker, and bidirectional sync
- Storage mode setup gate — first-run screen blocks app until user chooses Dropbox or localStorage
- Web setup screen with colorful DARTMUD block-letter banner
- Transport abstraction layer (Tauri IPC for desktop, WebSocket for web)

### Changed
- Terminal splash banner updated from DARTFORGE to DARTMUD with rainbow gradient
- Splash now includes "1991 - 2025" tagline and "Welcome to the Lands of Ferdarchi"

### Fixed
- Settings (filteredStatuses, compactBar) no longer overwritten with defaults on page reload

## [0.3.0] - 2026-02-17

### Added
- Configurable data directory with Dropbox/cloud sync support
- First-run setup dialog for selecting data location
- Rust storage backend for reading/writing to arbitrary paths
- Automatic backup system (session-start, hourly, pre-restore)
- Backup browser and restore UI in settings panel
- Settings panel with data location management and backup tabs
- Skill tracker panel with categorization, persistence, and responsive layout
- In-game clock with three DartMUD calendar systems
- Status bar with 7 game state trackers (health, concentration, aura, hunger, thirst, encumbrance, movement)
- Per-status message filtering (click a readout to suppress its terminal messages)
- Hover-to-expand on compact status readouts
- Manual connect flow — press Enter or click power button to connect (no auto-connect)
- Connecting/Connected/Disconnected splash screens
- macOS build support in release workflow

### Changed
- Panels (appearance, skills, settings) are now mutually exclusive — only one open at a time
- Status bar auto-compacts on narrow windows with disabled compress button
- Skills panel uses consistent overlay behavior at all screen sizes
- Resize transitions suppressed to prevent panel flash at breakpoints

## [0.2.0] - 2026-02-16

### Added
- Customizable terminal colors with persistent settings (react-colorful picker)
- Debug mode showing human-readable ANSI color names (e.g. [bright green])
- Per-color reset buttons in color panel
- Smart MUD prompt detection for clean output formatting
- Connection/disconnection splash screens with block-letter art
- Version displayed in window title bar
- Automated versioning via CHANGELOG bump hints
- Font family selector with auto-detection of installed monospace fonts
- Font size control with +/- stepper (synced with Ctrl+/- keyboard shortcuts)
- Display settings persisted to settings store with individual reset buttons
- Tailwind CSS v4 with design token system for consistent theming
- README with project overview, setup instructions, and architecture docs

### Changed
- Color panel slides in from right as overlay, toggled from toolbar
- Renamed color panel to "Appearance" panel
- Default theme colors updated to classic MUD palette
- Default terminal font changed to Courier New
- Disconnect screen uses block-letter "DISCONNECTED" art
- Terminal font and size now driven by persisted display settings
- Migrated all inline styles to Tailwind CSS utility classes
- Power button now shows connection status (green=connected, red=disconnected)
- "Connected" splash text now bright green for better visibility
- "Press enter to reconnect" text brighter (removed dim)

### Fixed
- Server prompt no longer jams next output onto same line
- Clippy warnings in Rust backend (inlined format args)
- Color picker handles no longer clipped at panel edges
- Enter key no longer triggers reconnect when typing at Name: prompt

## [0.1.0] - 2026-02-15

### Added
- Initial DartForge client with Tauri v2 + React/TypeScript + xterm.js
- Auto-connect to DartMUD (dartmud.com:2525)
- Command input with history, password masking
- Custom app icons
