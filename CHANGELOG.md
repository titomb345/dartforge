# Changelog

All notable changes to DartForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

The `[Unreleased]` header controls automatic version bumping on merge:
- `[Unreleased-patch]` → 0.1.0 → 0.1.1
- `[Unreleased-minor]` → 0.1.0 → 0.2.0
- `[Unreleased-major]` → 0.1.0 → 1.0.0

## [Unreleased-minor]

### Added
- `/var <name>` search — typing `/var` with a single argument now regex-searches variable names and displays matches instead of showing a usage error
- `/var`, `/convert`, and `/spam` directives now work inside alias and trigger bodies (e.g., `/var foe $1` in a trigger to track a target)
- Syntax help in alias and trigger editors now documents all available directives

### Changed
- Alias and trigger panels now default to Global scope (tab and editor) since most entries are shared across characters
- Alias and trigger rows now use full available width for pattern text instead of a fixed narrow column
- Group filter pills are now capitalized and case-insensitive ("starknight" and "Starknight" merge into one group)
- Aura readout now uses unique per-level CSS colors instead of ANSI theme colors for better visual distinction
- Scintillating aura displays rainbow-colored letters that randomize every 10 seconds
- Status readout danger flash is now severity-based per status type instead of color-based, giving each indicator its own flash threshold
- Tuned status indicator colors across all types: removed magenta, adjusted red/yellow thresholds to better match in-game severity
- Brightened low-contrast aura colors (indigo, violet, blue, red ranges) for readability on dark backgrounds

### Fixed
- Removed click-outside-to-close behavior on slide-out panels — panels now stay open until explicitly closed via the × button or toolbar toggle
- Prefix aliases with `$*` now capture the full argument string including semicolons (e.g., `rea /spam 1 k demon;sf` no longer splits on `;` before alias consumption)
- `/var` values now preserve semicolons (treated as rest-of-line, like `/spam`)
- Variables that expand to directives (e.g., `$reattackAction` → `/spam 1 k demon;sf`) are now re-processed through the command pipeline instead of being sent raw to the MUD
- Alias and trigger preview now properly expands `/spam` commands, showing all repeated commands instead of blank lines
- Skill category lists updated to use actual in-game skill names (underscores, apostrophes, `language#` prefix) so skills are correctly grouped
- `language#magic` now properly categorized under both Magic and Language via multi-category skill support
- Variable expansion in aliases and triggers now happens at execution time, so `/var foe $1;/echo $foe` correctly reflects the just-set value
- Aura matcher now recognizes "You appear to have no aura." (from `aura` command and `score` output) in addition to "You have no aura."
- Pet skill deletion now works — previously clicking "Del?" on a pet's skill did nothing because the delete function only handled character skills
- Allocation panel delete button no longer animates with a jarring size transition — now matches the standard "Del?" pattern used elsewhere

## [1.0.0] - 2026-02-22

### Added
- Pinnable panel docking system — pin up to 3 panels per side (left/right) with reorder, swap-side, and resize controls
- Responsive panel collapsing — auto-collapses pinned panels to icon strips on narrow windows with click-to-overlay access
- Chat panel with color-coded message types (Say, Shout, OOC, Tell, SZ), sender muting, and anonymous tell identification
- Improve counter panel with per-minute, per-period, and per-hour rate tracking
- Notes panel with per-character auto-saving text notes
- Allocations panel for combat and magic allocation tracking with inline editing
- Currency converter panel with freeform multi-denomination input (e.g., "3ri 5dn")
- Trigger system with substring, exact, and regex matching, gag/highlight actions, cooldowns, and sound alerts
- Alias system with exact, prefix, and regex match modes, positional args ($1-$9, $*, $-), and speedwalk
- Variable system with /var command and $varName substitution in aliases and triggers
- Signature-to-player name mapping for identifying anonymous chat senders
- Session logging with timestamped files and ANSI stripping
- Anti-idle timer with configurable command and interval
- Custom chime sound selection with file picker, preview, and reset
- Taskbar flash alerts for chat messages (per-channel, toggleable in settings)
- Persistent command history across sessions with deduplication
- Interactive help guide with categorized feature documentation and spotlight tour
- Tab completion from recent terminal output
- Per-status-readout compact toggle (right-click) and drag-and-drop reorder
- Per-status message filtering (click a readout to suppress its terminal messages)
- Built-in commands: /convert, /var, /delay, /echo, /spam
- Connect/disconnect splash screens with timestamps
- Error boundary for graceful crash recovery
- Numpad directional movement with customizable mappings

### Changed
- Panel system uses context providers (PanelContext, PinnedControlsContext) instead of prop drilling
- Splash screens show connection/disconnection timestamps
- Default notification settings are all off (user opts in per channel)
- Strip prompts and board date conversion default to off

### Fixed
- Chat pattern matching for OOC spacing and tell quote variants
- Terminal selection preserved when new data arrives
- React StrictMode compliance for skill tracker side effects
- Empty command submissions blocked during login prompts

## [0.4.0] - 2026-02-18

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
