# Changelog

All notable changes to DartForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

The `[Unreleased]` header controls automatic version bumping on merge:
- `[Unreleased-patch]` → 0.1.0 → 0.1.1
- `[Unreleased-minor]` → 0.1.0 → 0.2.0
- `[Unreleased-major]` → 0.1.0 → 1.0.0

## [1.2.0] - 2026-02-25

### Added
- Who List panel — shows online players with guild tags, ANSI name colors, and idle status; auto-refreshes in the background (configurable interval), pinnable to left/right side; manual `who` command also updates the panel without suppressing terminal output
- Who title tracking — players using custom who titles (names that don't match "Name the race") can be mapped to suspected or confirmed player names; hover a title row and click "?" to add, click an annotation to edit, right-click to toggle confirmed/suspected; mappings are character-scoped and persisted
- Who panel now supports all 5 player states: Online, Away, Busy, Walkup, and Idle — each with theme-aware colored indicators
- Who auto-refresh countdown badge next to command input (matches alignment/anti-idle pattern); double-click to disable
- Complete spell database (`spellData.ts`) with abbreviations, cast times, and aura costs for all 93+ spells
- Non-spell skill database (`skillData.ts`) with optional abbreviations and category assignments; category sets in `skillCategories.ts` are now derived from these databases automatically
- Movement mode system — cycle through Normal → Leading → Rowing to automatically prefix direction commands (e.g. `e` becomes `lead e`); toggle via Numpad `/` or `/movemode` command; teal pulsing badge shows active mode; resets on disconnect
- Action blocking — automatically queues commands during channeled actions (cast, study, hunt, gather, search, invoke, inscribe, write, revise, learn book, summon armor) to prevent accidental interruption; queued commands flush on completion with chain-aware re-queuing
- `/block` and `/unblock` built-in commands for manual blocking control
- Auto-login: store up to 2 character profiles in Settings > Characters — name and password are sent automatically on connect
- Passwords stored securely in the OS credential manager (Windows Credential Manager / macOS Keychain / Linux Secret Service) via the `keyring` crate — never written to settings.json
- Character switching with 20-minute cooldown enforcement (DartMUD server rule) — cooldown is timestamp-based and survives app restarts
- "Switch to [name]" button with live countdown timer, disabled while connected
- Web build: character form uses `autocomplete="username"` / `autocomplete="current-password"` so browser password managers (1Password, LastPass, etc.) can detect, save, and autofill credentials
- Wrong-credential safety: auto-login only attempts once per connection — if login fails, the user types manually

- Babel language trainer — automatically speaks phrases in a target language at configurable intervals to train language skills; language dropdown populated from learned `language#*` skills; default phrase bank of 30 fantasy-themed phrases with support for custom phrases (inline edit, add, delete, import from `.txt` file); fires immediately on start; language switchable while running
- Babel toolbar button and pinnable panel with collapsible phrase list, interval control, and start/stop toggle
- Babel countdown badge next to command input (purple-pink pulsing indicator); click to stop; language shown in tooltip
- Chat history persistence — chat messages are saved to disk and restored across sessions, so you don't lose conversation history on disconnect or restart
- Relative timestamps in the Chat panel — messages less than 2 hours old show "now", "5m ago", "1 hr ago" instead of a fixed clock time; updates every 30 seconds
- Gag Groups — built-in pattern sets (ported from dartmudlet) that suppress noisy MUD output; 7 toggleable groups: Pets, Creatures, Citizens, Trainers, Sparring, Channels, Quests; accessible via a collapsible section in the Triggers panel

### Changed
- Bumped Who panel player name font size from 11px to 12px
- Added ESLint 9 + Prettier project configuration with `lint`, `lint:fix`, `format`, and `format:check` npm scripts
- Character settings: removed active slot selector buttons (caused cooldown bypass); active character now indicated with a read-only badge, switchable only via the "Switch to" button
- Character 2 inputs disabled until Character 1 is configured

### Fixed
- Character switch cooldown bypass — clicking the active slot selector could invert the cooldown check, allowing immediate switching

## [1.1.0] - 2026-02-23

### Added
- Custom timers — repeating commands at configurable intervals (seconds or minutes) with full alias/trigger body syntax support
- Timer panel with create, edit, delete, duplicate, enable/disable, scope (character/global), group filtering, and search
- Timer countdown badges next to command input — soonest-to-fire shown first, overflow dropdown for additional timers
- Double-click timer badge to stop a timer; stop buttons in overflow dropdown
- Timer countdowns toggle in settings to show/hide all timer badges (anti-idle, alignment, and custom timers)
- `/var <name>` search — typing `/var` with a single argument now regex-searches variable names and displays matches instead of showing a usage error
- `/var`, `/convert`, and `/spam` directives now work inside alias and trigger bodies (e.g., `/var foe $1` in a trigger to track a target)
- Syntax help in alias and trigger editors now documents all available directives
- Alignment tracking — status bar readout with periodic polling and configurable interval
- Notes panel multi-page support with page navigation, add, and delete
- Login commands — fire user-configured commands automatically after logging in
- Counter panel configurable hot/cold rate thresholds with color coding
- Terminal right-click context menu with Copy Selected, Copy Line, Copy Visible, Copy All, Search, Scroll to Bottom, Clear Terminal, and font size controls
- Context menu "Add Line to Trigger" pre-fills and opens the trigger panel
- Context menu "Gag Line" instantly creates a gag trigger for the clicked line
- Context menu "Save Selected to Notes" appends selected text to the current notes page
- Terminal search (Ctrl+F) with next/prev navigation using xterm search addon
- Allocation "Save to Profile" dropdown — can now create a new profile or overwrite an existing one from live allocations (combat and magic)

### Changed
- Settings panel: merged Alignment Tracking and Anti-Idle into a single "Timers" section, reducing accordion clutter
- Timer labels (`[timer: name]`, `[anti-idle]`, `[align]`) now appear before command output in the terminal
- Anti-idle and alignment badges are now display-only countdowns (enable/disable via settings)
- Alias and trigger panels now default to Global scope (tab and editor) since most entries are shared across characters
- Alias and trigger rows now use full available width for pattern text instead of a fixed narrow column
- Group filter pills are now capitalized and case-insensitive ("starknight" and "Starknight" merge into one group)
- Aura readout now uses unique per-level CSS colors instead of ANSI theme colors for better visual distinction
- Scintillating aura displays rainbow-colored letters that randomize every 10 seconds
- Status readout danger flash is now severity-based per status type instead of color-based, giving each indicator its own flash threshold
- Tuned status indicator colors across all types: removed magenta, adjusted red/yellow thresholds to better match in-game severity
- Brightened low-contrast aura colors (indigo, violet, blue, red ranges) for readability on dark backgrounds
- Settings panel now uses accordion behavior (only one section open at a time), matching the guide panel
- Default theme yellow changed from dark orange to actual yellow for better readability
- Trigger bodies now re-expand through the alias engine for nested alias support
- Alias and trigger body textareas default to 5 rows instead of 3
- Alias and trigger search now filters by pattern only, no longer matches body or group text
- Status indicator yellow levels now use bright yellow for better visibility
- Renamed "Post-Sync Commands" to "Login Commands" in settings
- Extracted `CommandInputContext`, `useTimerEngines`, and `useCommandHistory` from App.tsx — CommandInput now reads state from context instead of 20+ props
- Double-click anti-idle and alignment tracking badges to disable them, matching custom timer badge behavior

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
- Prompt stripping no longer eats ANSI color reset codes — previously, stripping `> ` could discard `\x1b[0m`, causing the prior line's color (e.g., cyan) to bleed into subsequent output
- Login commands no longer fire on connect — previously they ran before the login prompt, sending commands as username/password
- Password mode now resets on disconnect — previously, disconnecting while at the password prompt left the input masked on reconnect, and the masked password was revealed when the mask was removed
- Number inputs across settings and editors no longer force minimum value on every keystroke — fields can be cleared and retyped freely

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
