import type { SpotlightStep } from '../contexts/SpotlightContext';

export type InteractionType = 'click' | 'double-click' | 'right-click' | 'hover' | 'drag';

export interface HelpItem {
  title: string;
  description: string;
  helpId?: string;
  kbd?: string[];
  interaction?: InteractionType;
}

export interface HelpCategory {
  key: string;
  title: string;
  iconName: string;
  defaultOpen?: boolean;
  items: HelpItem[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    key: 'getting-started',
    title: 'Getting Started',
    iconName: 'power',
    defaultOpen: true,
    items: [
      {
        title: 'Connection',
        description:
          'DartForge is built exclusively for DartMUD. Press Enter or click the power button to connect. Green means connected, red means disconnected.',
        helpId: 'toolbar-power',
      },
      {
        title: 'Terminal Font Zoom',
        description:
          'Adjust the terminal font size on the fly. Ctrl and + to zoom in, Ctrl and - to zoom out, Ctrl and 0 to reset.',
        kbd: ['Ctrl +', 'Ctrl -', 'Ctrl 0'],
      },
      {
        title: 'Password Detection',
        description:
          'When DartMUD asks for your password, the input field automatically switches to masked mode — your keystrokes are hidden.',
      },
      {
        title: 'Sending Commands',
        description:
          'Type in the command input and press Enter. Use Shift+Enter for multi-line input. Press Escape to clear the input.',
        helpId: 'command-input',
      },
      {
        title: 'Auto-Login',
        description:
          'Store up to two character profiles in Settings > Characters. When enabled, your name and password are sent automatically on connect.',
      },
    ],
  },
  {
    key: 'panels',
    title: 'Panels & Layout',
    iconName: 'layout',
    items: [
      {
        title: 'Opening Panels',
        description:
          'Click any panel button in the toolbar to open it as a slide-out overlay on the right side. Click again or click outside to close.',
        helpId: 'toolbar-chat',
      },
      {
        title: 'Pinning Panels',
        description:
          'Eight panels (Who, Chat, Counters, Skills, Notes, Allocations, Currency, Babel) can be pinned to the left or right side. Click the pin icon in the panel header, then choose "Pin Left" or "Pin Right". Up to 3 panels per side.',
      },
      {
        title: 'Reorder & Swap',
        description:
          'Pinned panels show up/down arrows to reorder within a side, and a swap arrow to move to the opposite side.',
      },
      {
        title: 'Resize Pinned Regions',
        description:
          'Drag the thin handle between pinned panels and the terminal to resize. Widths are saved automatically.',
        interaction: 'drag',
      },
      {
        title: 'Auto-Collapsing Panels',
        description:
          'When the window is too small to fit pinned panels and the terminal, panels automatically collapse into a narrow icon strip. Click an icon to open that panel as an overlay. Your pinned layout is preserved — panels restore to full size when the window grows.',
      },
      {
        title: 'Chat Panel',
        description:
          'Filtered chat with color-coded message types (Say, Shout, OOC, Tell, SZ). Mute senders, identify anonymous tells, and toggle sound alerts.',
        helpId: 'toolbar-chat',
      },
      {
        title: 'Counters Panel',
        description:
          'Track improve rates with named counters. Start, pause, resume, or stop. Shows rates per minute, per period, and per hour.',
        helpId: 'toolbar-counters',
      },
      {
        title: 'Skills Panel',
        description:
          'Auto-tracks skill improvements as you play. Organized by category with tier information and progress to next tier.',
        helpId: 'toolbar-skills',
      },
      {
        title: 'Notes Panel',
        description: 'Free-form text notes saved per character. Auto-saves as you type.',
        helpId: 'toolbar-notes',
      },
      // TODO: Re-enable when automapper is ready
      // {
      //   title: 'Map Panel',
      //   description: 'Auto-mapping hex grid built as you explore. Shows terrain types, fog of war, and room labels. Click rooms to walk there.',
      //   helpId: 'toolbar-map',
      // },
      {
        title: 'Allocations Panel',
        description:
          'Tracks your combat and magic allocations. Auto-parses from "show combat allocation:all" output. Click cells to edit values.',
        helpId: 'toolbar-alloc',
      },
      {
        title: 'Currency Panel',
        description:
          'Convert between and list all DartMUD currency systems. Supports freeform input like "3ri 5dn" or "1 gold sun 2g".',
        helpId: 'toolbar-currency',
      },
      {
        title: 'Babel Language Trainer',
        description:
          'Automatically speaks phrases in a target language at regular intervals to train language skills. Select from your learned languages, customize the phrase list or load a .txt file, and start training. A badge appears next to the command input while active.',
        helpId: 'toolbar-babel',
      },
      {
        title: 'Timers Panel',
        description:
          'Create repeating timers that execute commands at set intervals. Supports full alias/trigger body syntax including semicolons, /delay, /echo, /spam, and /var. Character-scoped or Global.',
        helpId: 'toolbar-timers',
      },
    ],
  },
  {
    key: 'hidden',
    title: 'Hidden Powers',
    iconName: 'sparkle',
    items: [
      {
        title: 'Quick Character Switch',
        description:
          'In Settings > Characters, click "Switch to [name]" to disconnect and immediately reconnect as your other character. A 20-minute cooldown applies between different characters (DartMUD server rule).',
        interaction: 'click',
      },
      {
        title: 'Filter Status Readouts',
        description:
          'Click any status (hunger, thirst, aura, etc.) in the bottom bar to filter that status from the terminal output. A dashed border indicates a filtered status.',
        helpId: 'status-bar',
        interaction: 'click',
      },
      {
        title: 'Compact Status Readouts',
        description:
          'Right-click any status readout to toggle compact mode, saving horizontal space. The status bar also auto-compacts when it overflows.',
        helpId: 'status-bar',
        interaction: 'right-click',
      },
      {
        title: 'Reorder Status Readouts',
        description:
          'Drag and drop status readouts in the bottom bar to rearrange them in any order you prefer. Your custom order is saved automatically.',
        helpId: 'status-bar',
        interaction: 'drag',
      },
      {
        title: 'Chat Sound Alerts',
        description:
          'Right-click a chat filter pill (Say, Shout, OOC, Tell, SZ) to toggle sound alerts for that message type.',
        helpId: 'chat-filters',
        interaction: 'right-click',
      },
      {
        title: 'Mute Chat Senders',
        description:
          'Hover over a chat message to reveal the mute button. Click it to mute that sender. Manage muted senders in the "Muted" section.',
        interaction: 'hover',
      },
      {
        title: 'Identify Anonymous Tells',
        description:
          'When you receive a tell from an unknown sender, a "?" button appears. Click it to map their signature to a player name for future identification.',
        interaction: 'click',
      },
      // TODO: Re-enable when automapper is ready
      // {
      //   title: 'Auto-Walk on Map',
      //   description: 'Right-click any explored room on the map to automatically walk there. The client calculates the shortest path and sends direction commands.',
      //   helpId: 'map-canvas',
      //   interaction: 'right-click',
      // },
      {
        title: 'Stop a Timer',
        description:
          'Double-click any timer countdown badge next to the command input to disable that timer. In the overflow dropdown, click the stop button.',
        helpId: 'command-input',
        interaction: 'double-click',
      },
      {
        title: 'Terminal Context Menu',
        description:
          'Right-click the terminal for quick actions: copy, gag a line, add a line to triggers, save selected text to notes, search, and font size controls.',
        interaction: 'right-click',
      },
      {
        title: 'Cycle Game Clock',
        description:
          'Click the game clock in the bottom-right to cycle between different reckoning systems (Ferdarchian, Tirachian, etc.).',
        helpId: 'game-clock',
        interaction: 'click',
      },
    ],
  },
  {
    key: 'shortcuts',
    title: 'Keyboard Shortcuts',
    iconName: 'keyboard',
    items: [
      {
        title: 'Numpad Movement',
        description:
          'Use the numpad for instant directional movement without typing. Numpad 0 = Up, Numpad + = Back.',
        kbd: ['7', '8', '9', '4', '5', '6', '1', '2', '3'],
        helpId: 'command-input',
      },
      {
        title: 'Toggle Active Counter',
        description:
          'Quickly toggle your active improve counter between running and paused states.',
        kbd: ['Numpad *'],
      },
      {
        title: 'Cycle Movement Mode',
        description:
          'Cycle through movement modes: Normal → Leading → Rowing. Active mode prefixes all direction commands automatically.',
        kbd: ['Numpad /'],
      },
      {
        title: 'Tab Completion',
        description:
          'Press Tab to auto-complete from recent terminal output. Press Tab again to cycle through matches.',
        kbd: ['Tab'],
        helpId: 'command-input',
      },
      {
        title: 'Command History',
        description:
          'Navigate previous commands. If you type first, history filters to matching prefixes only.',
        kbd: ['\u2191', '\u2193'],
        helpId: 'command-input',
      },
      {
        title: 'Multi-line Input',
        description: 'Enter multiple commands at once. Each line is sent separately.',
        kbd: ['Shift', 'Enter'],
      },
      {
        title: 'Clear Input',
        description: 'Clear the command input and reset history navigation.',
        kbd: ['Esc'],
      },
      {
        title: 'Copy from Terminal',
        description: 'Select text in the terminal, then copy it to clipboard.',
        kbd: ['Ctrl', 'C'],
      },
      {
        title: 'Terminal Search',
        description:
          'Search for text in the terminal output. Use Enter / Shift+Enter to jump between matches.',
        kbd: ['Ctrl', 'F'],
      },
      {
        title: 'Terminal Font Zoom',
        description:
          'Adjust the terminal font size on the fly. Ctrl and + to zoom in, Ctrl and - to zoom out, Ctrl and 0 to reset to default (14px).',
        kbd: ['Ctrl +', 'Ctrl -', 'Ctrl 0'],
      },
    ],
  },
  {
    key: 'commands',
    title: 'Built-in Commands',
    iconName: 'terminal',
    items: [
      {
        title: '/convert',
        description:
          'Currency conversion. Use "/convert 3ri 5dn" or "/convert 1 gold sun". Supports all DartMUD currency systems with flexible parsing.',
      },
      {
        title: '/var',
        description:
          'Manage user variables. "/var name value" to set, "/var -g name value" for global, "/var -d name" to delete, "/var" to list all.',
      },
      {
        title: '/delay',
        description:
          'Pause between commands in aliases. "/delay 500" waits 500ms. Useful for timed sequences.',
      },
      {
        title: '/echo',
        description:
          'Print text to your terminal without sending to the MUD. Useful in alias and trigger bodies for local feedback.',
      },
      {
        title: '/spam',
        description:
          'Repeat a command N times. "/spam 10 kill rat" sends "kill rat" 10 times. Max 1000 repetitions.',
      },
      {
        title: '/block',
        description:
          'Manually activate action blocking. Commands typed while blocked are queued until /unblock or the action completes.',
      },
      {
        title: '/unblock',
        description: 'Manually release action blocking and send all queued commands immediately.',
      },
      {
        title: '/movemode',
        description:
          'Cycle movement mode: Normal → Leading → Rowing. When active, direction commands are automatically prefixed (e.g. "e" becomes "lead e"). Also toggleable via Numpad /.',
      },
      {
        title: '/apt',
        description:
          'Look up aptitude for a spell or skill. Accepts abbreviations — "/apt lg" expands to "show aptitude:lirrin\'s_glow". Echoes the resolved name so you know what was looked up.',
      },
      {
        title: '/skill',
        description:
          'Show skill details. Accepts abbreviations — "/skill mt" expands to "show skills magic theory". Pass a full name if no abbreviation is set.',
      },
      {
        title: '/inscribe',
        description:
          'Automated inscription practice loop. "/inscribe <spell> <power>" starts the cycle — checks concentration, inscribes, invokes, and repeats. "/inscribe power <n>" adjusts power mid-loop. "/inscribe off" stops. "/inscribe status" shows current state. A blue badge appears while active.',
      },
    ],
  },
  {
    key: 'aliases',
    title: 'Aliases & Triggers',
    iconName: 'alias',
    items: [
      {
        title: 'Aliases',
        description:
          'Create shortcuts for commands. Open the Aliases panel to add, edit, or delete. Supports Exact, Prefix, and Regex match modes. Character-scoped or Global.',
        helpId: 'toolbar-aliases',
      },
      {
        title: 'Alias Variables',
        description:
          '$1-$9 for positional args, $* for all args, $- for all except last, $! for last arg, $me for character name, $Me for capitalized name, $varName for user variables.',
      },
      {
        title: 'Opposite Directions',
        description:
          'Use $opposite1-$9 to get the reverse direction of an argument. Great for "go and come back" aliases.',
      },
      {
        title: 'Speedwalk',
        description:
          'Type "3n2e" to walk north 3 times then east 2 times. Enable/disable via the "SW" toggle in the Aliases panel.',
      },
      {
        title: 'Triggers',
        description:
          'Auto-react to MUD output. Match patterns with Substring, Exact, or Regex. Supports gag (hide line), highlight (color line), cooldown, and sound alerts.',
        helpId: 'toolbar-triggers',
      },
      {
        title: 'Gag Groups',
        description:
          'Built-in pattern sets that suppress noisy MUD output. Toggle groups on/off in the Triggers panel: Pets, Creatures, Citizens, Trainers, Sparring, Channels, and Quests.',
      },
      {
        title: 'Anti-Spam',
        description:
          'Collapses consecutive identical lines into a single line with a dim repeat count (e.g. "x5"). Enable in Settings > Output.',
      },
      {
        title: 'Command Chaining',
        description:
          'Use semicolons to chain commands: "kill rat;loot corpse". Escape with \\; for a literal semicolon.',
      },
    ],
  },
  {
    key: 'chat',
    title: 'Chat & Social',
    iconName: 'chat',
    items: [
      {
        title: 'Chat Filters',
        description:
          'Click filter pills to show/hide message types. The "All" pill toggles everything. Active filters are color-coded.',
        helpId: 'chat-filters',
        interaction: 'click',
      },
      {
        title: 'Sound Alerts',
        description:
          'Right-click a filter pill to toggle sound alerts for that channel. A small dot appears when alerts are active.',
        helpId: 'chat-filters',
        interaction: 'right-click',
      },
      {
        title: 'Signature Mapping',
        description:
          'DartMUD anonymizes some senders. The "Sigs" section in Chat maps message signatures to known player names, so future messages show the real name.',
      },
      {
        title: 'Taskbar Alerts',
        description:
          'Enable per-channel taskbar alerts in Settings > Notifications. When a message arrives while the window is unfocused, the taskbar icon flashes to get your attention. The flash clears when you switch back to DartForge.',
      },
    ],
  },
  {
    key: 'tracking',
    title: 'Tracking & Data',
    iconName: 'data',
    items: [
      {
        title: 'Skill Auto-Tracking',
        description:
          'Skills are tracked automatically as you improve them. View your full skill database in the Skills panel, organized by category with tier progress.',
        helpId: 'toolbar-skills',
      },
      {
        title: 'Improve Counters',
        description:
          'Create named counters to track improve rates over time. Shows per-minute, per-period, and per-hour rates. Use Numpad * to quick-toggle.',
        helpId: 'toolbar-counters',
      },
      {
        title: 'Hot & Cold Skills',
        description:
          'Skills improving quickly glow amber, slow ones glow icy blue. Configure the rate thresholds in Settings > Counters.',
      },
      {
        title: 'Alignment Tracking',
        description:
          'Automatically polls your alignment at a configurable interval. Displays alignment and conviction in the status bar. Also prevents idle disconnect. Enable in Settings > Alignment Tracking.',
      },
      {
        title: 'Allocation Tracking',
        description:
          'Combat and magic allocations auto-parse from "show combat allocation:all" and "show magic allocation" output. Edit values inline.',
        helpId: 'toolbar-alloc',
      },
      {
        title: 'Session Logging',
        description:
          'Enable in Settings. Logs all terminal output and commands to timestamped files, with ANSI codes stripped for readability.',
      },
      {
        title: 'Who List',
        description:
          'Shows online players with guild tags, idle status, and ANSI name colors. Auto-refreshes in the background (configurable interval in Settings > Timers). Click the refresh button for a manual update. Players using who titles (names that don\'t match the standard "Name the race" format) can be mapped to suspected or confirmed player names — hover over a title and click "?" to add a mapping. Pin the panel to keep it visible.',
        helpId: 'toolbar-who',
      },
      {
        title: 'Action Blocking',
        description:
          'Prevents interrupting channeled actions (cast, study, hunt, gather, search, etc.) by queueing commands until the action completes. An amber BLOCKED badge appears next to the input showing queue count. Enable in Settings.',
        helpId: 'command-input',
      },
      {
        title: 'Anti-Idle',
        description:
          'Automatically sends a command (default "hp") at intervals to prevent idle disconnect. Configure command and interval in Settings. Countdown shown in the input area.',
        helpId: 'command-input',
      },
      {
        title: 'User Variables',
        description:
          'Store values for use in aliases and triggers via $varName syntax. Manage in the Variables panel or with the /var command.',
        helpId: 'toolbar-variables',
      },
    ],
  },
];

export const QUICK_TOUR_STEPS: SpotlightStep[] = [
  {
    helpId: 'toolbar-help',
    tooltip:
      'This is your Guide. Click it anytime to learn about features, keyboard shortcuts, and hidden interactions.',
  },
  {
    helpId: 'toolbar-chat',
    tooltip:
      'These are your panel buttons. Click to open, or pin them to either side of the screen for a persistent view. Up to 3 panels per side.',
  },
  {
    helpId: 'status-bar',
    tooltip:
      'Your status bar shows health, hunger, thirst, and more. Click to filter, right-click to toggle compact mode.',
    position: 'above',
  },
  {
    helpId: 'game-clock',
    tooltip: 'The game clock shows DartMUD time. Click to cycle between reckoning systems.',
    position: 'above',
  },
  {
    helpId: 'command-input',
    tooltip:
      'Type commands here. Use arrow keys for history, Tab for auto-complete, and numpad for movement. Shift+Enter for multi-line.',
    position: 'above',
  },
];
