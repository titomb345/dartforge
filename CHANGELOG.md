# Changelog

All notable changes to DartForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

The `[Unreleased]` header controls automatic version bumping on merge:
- `[Unreleased-patch]` → 0.1.0 → 0.1.1
- `[Unreleased-minor]` → 0.1.0 → 0.2.0
- `[Unreleased-major]` → 0.1.0 → 1.0.0

## [Unreleased-minor]

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
