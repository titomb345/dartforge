# Changelog

All notable changes to DartForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

The `[Unreleased]` header controls automatic version bumping on merge:

- `[Unreleased-patch]` → 0.1.0 → 0.1.1
- `[Unreleased-minor]` → 0.1.0 → 0.2.0
- `[Unreleased-major]` → 0.1.0 → 1.0.0

## [1.15.4] - 2026-07-31

### Changed

- Tapping anywhere on the Mobile Companion screen now focuses the command input, matching the desktop client. Taps on buttons, panel controls, and text selections are left alone

### Fixed

- Mobile Companion output lost its coloring when the game's terminal was set to `ansi256`. Its ANSI parser only understood the 16 basic codes, so 256-color and truecolor sequences were dropped and background codes could be misread as a foreground color. It now mirrors the desktop terminal exactly: the 16 basic colors follow your theme, and 256-color/truecolor values are drawn as sent
- The Mobile Companion no longer unsticks from the bottom of the output after sending a command. The on-screen keyboard opening or closing (and any other relayout) moved the scroll position, which was read as "the user scrolled up", leaving you stranded mid-history until you scrolled down by hand. Only a scroll you actually started unpins the view now, and sending a command always snaps back to the newest output

## [1.15.3] - 2026-07-31

### Fixed

- `scripts/bump-version.sh` now updates `src-tauri/Cargo.lock` alongside the other version files. It only ever updated `Cargo.toml`, so the lockfile's entry for the app itself stayed a release behind and got rewritten by the next local cargo build, showing up as an unrelated dirty file

## [1.15.2] - 2026-07-31

### Changed

- The health, concentration, hunger, and thirst readouts in the status bar now take their color straight from the MUD's own output instead of a hand-maintained text-to-color table. The old table had drifted out of sync with the game and needed updating whenever DartMUD changed a color; the readouts now match what you see in the terminal, in both `ansi` and `ansi256` modes. Hunger and thirst are sampled separately, so "hungry, and slightly thirsty" can show two different colors. The built-in colors remain as a fallback for output that arrives with no coloring at all

### Fixed

- Player name colors in the Who panel went blank when the game's terminal was set to `ansi256`. The color parser only understood the 16 basic ANSI codes, so 256-color and truecolor sequences were ignored (and background codes could even be misread as a foreground color). The panel now uses the exact color the MUD sent: the 16 basic colors still follow your terminal theme, and 256-color/truecolor values are used verbatim. The aura readout in the status bar and the automapper's terrain colors share the same parser, so those work in `ansi256` now too

## [1.15.1] - 2026-07-17

### Changed

- The full-screen map no longer applies the away-from-this-map dim (shown when you're in town on the hex map, or outdoors on a town map). In the small panel the dim is a useful "you're not here" cue, but in full screen it darkened the entire display; the IN TOWN / OUTDOORS badge already carries that signal

## [1.15.0] - 2026-07-17

### Changed

- The Who panel now understands DartMUD's reworked who list. The July reboot re-labeled player states from MMO terms to soul senses — Vibrant (online), Engaged (busy), Distant (afk), Receptive (walkup), and Dim (inactive, including the long-dead) — and removed idle times from the list entirely, which broke parsing. Every state now renders as a colored dot (vibrant green, engaged orange, distant yellow, receptive blue, dim gray; hover a dot for the state name), and the mobile companion shows the same state dots where idle times used to be

### Fixed

- The mobile companion terminal now renders inverse-video ANSI (SGR 7/27), which DartMUD uses for guild tags — the black-on-white [HG] tag in who output previously lost its colors and displayed as plain default-colored text on the phone
- The town mapper no longer remaps rooms it has already visited into duplicates (Soriktos was the worst offender: revisiting the same streets kept planting second copies of rooms one cell away from the originals). Three root causes, each reproduced from the session logs and now regression-tested (`scripts/town-tests/test-soft-fail-desync.ts`):
  - **Moves that fail with room-specific flavor text desynced the tracker.** DartMUD rooms can refuse a move with arbitrary prose ("A very large eunuch, apparently the cook, glares at you… You decide it's not a good idea to go in there.") that no pattern list can ever cover, so the dead move stayed queued and the NEXT room got filed in the dead move's direction — the Blue Pearl's Garden Courtyard spent two days wired west of the Salon when it really lies south, and every true arrival after that created a fresh duplicate. The arrival room's own exits line is now treated as ground truth: a block that doesn't list the way back for the queued move can't be that move's destination, so the dead move is dropped and the room resolves under the move that actually produced it. Genuinely one-way arrivals (sloped trails where "down" returns as "north" — about 2% of all moves) are unaffected: the queue is only repaired when a better explanation is actually waiting behind the dead move
  - **Word-identical twin rooms stole each other's side rooms.** The Royal Stables are three segments with the same name, description, and exits, each with its own pair of word-identical Stalls — and the duplicate-healing rule ("this room's recorded neighbor looks exactly like where I'm standing, so I'm probably standing on a duplicate of it") couldn't tell "duplicate of current" from "identical twin standing next to current". Stepping into segment B's stall reused segment A's stall, silently shifting the whole walk one cell sideways — every move after that resolved one room off, spawning duplicate stalls and swallowing real moves as re-prints. Rooms you have walked between are provably distinct, never duplicates of each other, and the healing rule now refuses them
  - **Wrong-direction links blocked their own repair forever.** The guard that stops a room from being reused as two different neighbors of the same room ("the Landing knows the vestibule is north — it can't also be south") was also protecting the poison links the desync created, so the map could never heal itself. A link is now ignored (and severed on load) when the linked rooms' own exits lines say it's impossible — the next real walk re-maps it correctly. Existing scarred maps heal the first time they're loaded
- Replay validation now mirrors the live client faithfully: session-log replays use the logs' real timestamps (login gaps and queue expiry behave as they did live), replay `door <dir>` as the movement it expands to live (door crossings used to replay as unexplained floaters — the corpus replay counted 15 keep Vestibules where the real keep has 4), and round-trip the map store between chained sessions so the load-time cleanses run. Corpus accuracy moved from 74.9% to 81.9% expected resolutions, unexplained rooms dropped 36 → 7, and every remaining duplicate fingerprint group in the corpus map is a genuinely word-identical set of rooms

## [1.14.2] - 2026-07-09

### Fixed

- The Loadout panel's silent hand re-syncs no longer leak `equip held` output into the terminal or swallow the player's own eq commands. The old gag decided by line shape and timing, which failed three ways: replies that split across network reads (they routinely do, even mid-word, especially during the 5-minute who+equip refresh burst) leaked whatever limbs arrived in the later read; multiple queued re-syncs (login primes one while the wear-restore burst schedules more) leaked every reply after the first, which is why "No equipment to show." printed on almost every clean login; and an eq typed near a hold or summon could have its reply eaten by the auto-verify's gag. Replies are now attributed by send order instead: every outgoing equip command is queued as app-initiated (gag) or player-typed (show), and each reply consumes exactly one entry — the server answers commands strictly in order, so a manual eq can never be swallowed, no matter how it races a background re-sync. Any bookkeeping doubt defaults to showing the output

## [1.14.1] - 2026-07-08

### Fixed

- The Loadout panel now understands the empty-hands reply. `equip held` answers "No equipment to show." when nothing is held, but the tracker only knew the "You are not holding..." shape — so the panel's silent auto re-syncs never completed, the "hands unverified" flag stuck forever, and each background re-sync leaked a stray "No equipment to show." line into the terminal. The reply now commits an all-hands-empty snapshot (and is gagged like the rest of the sync output), and empty hands read "(empty)" in the panel instead of a bare dash

## [1.14.0] - 2026-07-07

### Added

- Landmark icons on both maps. Hex landmarks now auto-classify into distinct icons instead of one generic diamond: towns keep their house, and castles/fortresses, towers (including windmills and lighthouses), caves and chasms, temples, graveyards, camps, farms, and boats/ferry landings each get their own glyph — the vocabulary was mined from five years of survey logs, and existing maps re-classify automatically on load. Town map rooms get point-of-interest icons the same way: banks (coin), shops (awning), inns and taverns (tankard), temples, smithies (anvil), stables (horseshoe), and bulletin boards (detected from room descriptions). Shift+click any hex or room to open a picker and set the icon yourself, remove it, or hand it back to auto-detection — an explicit choice is never overwritten by the auto-classifier. Hover popups name the icon, and the town legend notes the shortcut
- Loadout panel — a live view of what each limb is holding and everything worn, built from output the game already prints (no polling, nothing sent unless you ask). A `view me` (the native examine — `x me` works through the usual alias expansion) teaches it your full state: limb roster (race-agnostic — a spyder's ten limbs work as well as a human's), held items, worn items and clothing, and per-limb health shown as colored dots. An `equip held` re-syncs just the hands. Summoned items carry a ✦ badge (they vanish when dismissed rather than being real gear) — the panel exists to end the reflexive `eq` spam. The header's re-sync and full-sync buttons send `equip held` / `view me` for you, with the re-sync button turning amber while hands are unverified. Hands stay verified on their own: `equip held` joins the login sync (the panel is primed the moment you log in), a background timer re-syncs it at a configurable interval (Settings > Timers, on by default every 5 minutes, same as the Who list, with its own countdown badge by the command input), and every hand-affecting event (summon, dismissal, hold, drop, stow, take) flips the hands to "unverified" and triggers one automatic silent re-sync moments later — the game often doesn't say which hand ("hold X in right hand" on a four-handed spyder, or one of three identical summoned tonfas dissolving), so the panel never guesses at interim hand states: what it shows is always the last eq-verified truth, plus an honest flag while a change is settling. Worn tracking stays live between snapshots (wear/remove echoes name the item exactly). Both the timer's and the panel button's re-syncs are silent — the response is consumed by the same output-gagging the Who refresh uses, so it never clutters the terminal (typing `eq` yourself still shows output normally). State persists per character and reloads flag hands as approximate (output was missed while the client was closed). Pinnable like Who/Chat/Map. Validated by replaying all 54 recorded sessions through the tracker (final states matched the known summon loadouts) plus a regression test built from real log excerpts (`scripts/test-loadout.ts`)

### Changed

- The Map panel's toolbar no longer overflows in a pinned sidebar. It kept view buttons, center, the floor stepper, walking/LOST badges, the town picker, full screen, and the gear menu all in one row — the tail end got cut off at sidebar width. The toolbar now holds just an Auto/Hex/Town segmented switcher, the town picker, and the gear menu; everything else moved onto the map itself like a real map UI: center-on-player, the floor stepper (now vertical, ▲ up on top), and full screen stack in the bottom-right corner, while the Walking cancel pill and LOST badge sit bottom-left. The hex map's decorative compass rose (which occupied that corner) is gone — the map never rotates, so north is always up and it carried no information
- The town map's BROWSING badge is now a button: while browsing another town's map, clicking it snaps the view back to the town you're actually standing in (previously you had to find your town again in the picker)
- Context menus and popovers (map gear menu, quick-button right-click menu, the new marker pickers) now share one component under the hood, so they all close on Escape and right-click, and stay fully on screen — clamped using their real rendered size instead of hardcoded estimates
- The Allocations panel now remembers where you left it, per character. The selected combat and magic profiles were already saved, but the panel always reopened on the Combat tab's Live view — now the Combat/Magic tab and Live/Profiles view are saved too, so the client opens showing the same profile that was on screen when it closed
- The town map's auto-walk now leaves doors as it found them. A door that was already standing open when you reach it is walked straight through and left open — no more closing (and trying to lock) doors that were open to begin with. Doors that are closed still get the full unlock/open/step/close/lock treatment. The exits line's own wording ("an open oak door leading east" vs "a closed oak door…") is the source of truth, read fresh from the room you're leaving at the moment of the crossing

### Fixed

- Portal trips no longer scar town maps with duplicate rooms. Every temple Forecourt looks identical, so a portal arrival couldn't be matched to a town and each trip spawned a fresh fragment map that later merged badly into the real one (corpus replay: five "Forecourt" fragment towns in one week, each leaving orphan duplicate Markets and Forecourts behind). The mapper now remembers where each portal leads — departure room plus the direction the transit line names ("You step into the **north** portal.") — and lands you straight in the mapped destination room, the same way hex anchors re-localize wilderness entrances. Corpus towns dropped from 22 to 13 (all 9 removed were fragments), and Eris shed 25 duplicate rooms
- Time-of-day description changes no longer duplicate rooms. The Eris market cycles through six crowd-level sentences ("The market is active with shoppers…", "A few housewives are about…") inside otherwise identical descriptions, so crossing an hour boundary made the same room read as a different one and the mapper duplicated it. The mapper now learns such volatile prose from confirmed revisits — a sentence swap witnessed on two different rooms marks that prose as world-state, not identity — and ignores it when telling look-alike rooms apart. A description's FIRST sentence is exempt: it is the room's identity headline (the Blue Pearl Inn's floors differ only by their "second/third floor" headline), and learning one would glue look-alike rooms together — cross-floor links and duplicated bedrooms. Saves that already learned a headline sentence are cleansed on load. Replay validation: it learned exactly the six market crowd variants, two weather sentences, and two street-traffic sentences, with zero false learnings
- Sentence fragments can no longer become room names. A description or contents line sliced at a network boundary ("There is an oak chest in the opposite corner. It") could pass the room-name scan and poison the map with a junk room; prose-shaped lines are now rejected
- Mirror-identical stacked floors no longer merge into one on the town map. The rangers' keep in Eris has vertically-copied bedroom wings — same room names, same exits, vestibules with word-identical prose — and entering a 2nd-floor Bedchamber snapped you to the 3rd-floor one directly above it (whichever floor was mapped first captured every bedroom, and walks then dragged the position to the wrong floor). The proximity reuse that closes loops tolerated a one-floor height difference, and its single-candidate path never consulted descriptions, so even the bedchambers' genuinely different prose ("one of the senior rangers… a bed" vs "a pair of rangers… two beds") couldn't save it. Two fixes: a tracked move's destination floor is now ground truth (lateral moves stay on the floor, stairs move exactly one — candidates on any other floor are ineligible, which is the only thing that can separate word-identical floors), and readable, disagreeing descriptions now veto single-candidate reuse the same way they already vetoed ties. Corpus replay confirmed the same bug had been silently gluing the Blue Pearl Inn's identical hallway floors together. Existing scarred maps heal on load: a sideways link that changes floors is structurally impossible, so such links are severed and re-map correctly the next time you walk them
- Diagonal movements (ne/nw/se/sw) now stretch the town map like cardinal moves do. When a diagonal arrival's natural cell was already occupied, the room was shoved to the nearest free cell, scattering diagonally-connected rooms wherever the grid was tight. Now the map stretches along a single component axis — chosen so the displaced room's own street shifts as one piece — and the arriving room lands exactly at its diagonal cell (corpus-replay validated: identical mapping accuracy)

## [1.13.2] - 2026-07-06

### Changed

- Anti-spam's `[repeated xN]` collapse now only kicks in at the **4th** identical line instead of the 2nd, and the threshold is configurable in Settings > Output ("Collapse after N repeats"). Two or three identical lines in a row are usually legitimate (a triple "You bow." emote, a couple of parries), so they now pass through in full; only the 4th and later copies fold into the dim count. Set it back to 2 for the old behavior, or higher to let more repeats through

### Fixed

- Mobile companion colors now match the desktop. The companion had its own Dracula-ish ANSI palette that didn't line up with the desktop terminal — regular white and bright white were nearly identical, and the Who panel's guild tags were a flat purple instead of each guild's real colors. The companion now uses the desktop terminal's actual palette (and picks up your customized theme live), renders bold-as-bright the way the desktop terminal does (so MUD "bright" colors sent as bold + normal color show correctly), colors each Who guild tag like the desktop Who panel (BH, DG, DK, HG, MG, RoE, SR), and defaults uncolored output and names to the terminal foreground instead of near-white
- Town maps no longer go wonky at layout collisions. Previously, when a walk arrived at a cell another room already occupied (non-Euclidean loops, converging streets), the new room was shoved to the nearest free cell — bending straight streets and disjointing the map more with every collision. Now the map **stretches** instead: the rooms beyond the collision shift one cell out of the way and the new room lands exactly where the move says, so streets stay straight and north stays up. A collinear stretched connection now draws as a normal solid corridor (it's a truthful long street); only genuinely non-Euclidean links keep the thin dashed style. Existing town maps are healed automatically: the first load re-derives every town's layout from its walked connections (one-time migration — corpus-replay validated at no loss of mapping accuracy), and a rebuilt layout also repairs maps scarred by older versions' collisions

## [1.13.1] - 2026-07-04

### Added

- Full-screen map view — an expand button in the Map panel toolbar (same idea as the script editor's popout) opens the map in a large widescreen overlay, since the DartMUD world is far wider than it is tall. Everything works exactly like the in-panel map: pan/zoom, hover-to-inspect, right-click auto-walk, Shift/Ctrl+click marker editing, the floor stepper, town picker, and the gear menu. Esc, clicking the backdrop, or the collapse button returns to the normal panel

### Fixed

- The map's hover info popups (hex terrain and town room details) now render through a portal like the gear menu, so a small pinned Map panel can't clip them at its edges

## [1.13.0] - 2026-07-04

### Added

- Town mapper — the Map panel now maps towns, buildings, and dungeons room by room, alongside the hex wilderness map. Step through a doorway and the panel switches to a room map automatically (Auto view; Hex/Town buttons force either view). Rooms you walk through are laid out on a grid — corpus analysis of 5 years of logs showed DartMUD towns are grid-consistent for n/s/e/w/up/down (98%+ of round trips close), while diagonal exits are shortcuts that get drawn as thin connector lines instead of constraining the layout. Buildings with multiple floors render one level at a time with stair glyphs (▲▼) on stair rooms and a floor stepper in the toolbar that follows you as you climb. Doors draw as amber ticks across their corridor, unexplored exits as faint stubs, and non-directional exits ("back", "out", boats you can enter) as dashed purple lines. Each town is remembered by the hexes you've entered or left it from, so walking back in from the wilderness re-localizes you instantly — and the hex map's anchor means the same town can have any number of entrances. Portal networks are handled as teleports: "You step into the north portal." makes the arrival room a fresh entry into its own town instead of gluing the two ends together, so the hub Portal Chamber and each destination temple keep separate maps and swapping through a portal switches the view to the right one. Teleports without a known message (mark/recall spells, Ebon mage portals) are caught by a generic heuristic: an arrival that matches nothing around you but uniquely matches a mapped room in another town is treated as a teleport there Same-named rooms (a street of "Market" rooms) are told apart by their exits, grid position, and link structure — a switchback trail of identical "Path" rooms maps as separate rooms because each one's connections point back to different neighbors, and even mirror-symmetric building wings (the rangers' keep's twin bedroom Vestibules with lookalike Bedchambers) stay apart because two rooms that attach the same physical neighbor on different sides can't be the same room; even a plaza grid of genuinely identical rooms (Eris's market: a walkable 3x3 of rooms all named "Market", several sharing the exact same exits) maps correctly — room descriptions (ignoring the time-of-day lighting sentence) are the final tiebreaker between twins, a diagonal step back into mapped ground reuses the room it lands on instead of duplicating it, hidden moves between lookalike rooms are caught when the description says you're somewhere else, and when several identical candidates are in reach and none can be positively identified the mapper creates a new room rather than guessing (a wrong guess cascades false links across the whole plaza; a duplicate room quietly heals later); if fragments of one town get mapped separately they fuse automatically the moment their room neighborhoods are recognized as the same place, and a connection that turns out to point at the wrong room heals itself the next time you walk through it and the real destination is recognized. Non-Euclidean spots are handled too: where two routes with the same net displacement end in different rooms (in Eris, e-e-e reaches the ferry landing while s-e-e-e-n reaches the abbey — the same grid coordinate), the exits line is treated as ground truth (you can't have walked north into a room that has no south exit), so the colliding rooms stay separate — the later one is nudged to a free cell and its stretched connections draw thin and dashed — each still departing through its exit's own side of the room (a south exit leaves the bottom edge) with only the middle of the line angling across — so they don't read as corridors through unrelated rooms. Town maps persist per character next to the hex map
- Right-click-to-walk in towns — right-click any mapped room to auto-walk there, exactly like the hex map: BFS over the exits you've actually walked (including stairs across floors and named exits like "back"), two moves in flight, every step verified against the room that actually prints. The remaining route is drawn on the map as a dashed gold line with a dot on each room while you walk (and hex walks now draw their route the same way). The walk stops cleanly on closed doors, blocked movement, manual movement, or anything unexpected — but tolerates harmless room re-prints (a look, someone lighting a torch) instead of aborting. Hover a room for its description, exits, and visit count; renaming a town and the confirm-guarded town delete live in the map gear menu. Browsing another floor with the stepper centers the view on that floor's rooms; the gear stats show rooms, floors, and total towns mapped. A town picker in the toolbar browses any mapped town from anywhere (no need to be standing in it) — a cyan BROWSING badge marks that walking is unavailable until you're actually there, the view centers on the browsed town's rooms, and the gear menu's rename/delete apply to the town being viewed. Entering a town snaps the view back to following you. The gear menu also has a room search (type a name, Enter or click jumps to the best match, switches to its floor, and rings it in cyan) and a legend explaining every map glyph; double-clicking a stair room follows its staircase to the next floor
- `/door <dir>` built-in command — passes through a (possibly locked) door in one go: unlocks trying each keyring slot ("key", "key 2", … — slot count configurable in Settings > Doors, default 5), opens, steps through, then closes and locks behind you. Accepts n/s/e/w/u/d, diagonals, and in/out. Replaces the multi-line alias approach with a single first-class command (an alias like `door$1 → /door $1` keeps old muscle memory working)
- Auto-door walking — the town map's right-click walk now handles doors by itself: when a route step crosses an exit the mapper knows is a door (from the room's own exits line), the walker runs the full /door sequence instead of the bare direction. Start in a locked bedroom and right-click the wilderness: it unlocks, opens, closes, and re-locks every door on the way out. The walk banner counts them ("Walking 9 rooms (3 doors)..."), and a genuinely impassable door (no matching key) still stops the walk cleanly
- Portal rooms are marked on town maps — the moment you step through a portal, both the departure and arrival rooms get a purple arch icon (and "· portal" in their hover tooltip), persisted with the map. Eris, Soriktos, and any other portal chambers flag themselves the first time you use them
- Town mapper on/off toggle (Settings > Map) — the town mapper is new, so there's a kill switch: turn it off and the Map panel behaves like v1.12 again (hex map only, with the IN TOWN badge while indoors), town room output is ignored entirely, and right-click town walking is unavailable. Mapped town data is kept, and mapping picks back up the moment you re-enable it
- Town mapper validation harness (`scripts/replay-town.ts`) — replays the full production parser → localizer → store pipeline against the historical log corpora (340k room blocks across 927 MUSHclient logs; 19k command-paired blocks across 166 DartForge session logs). Final corpus numbers: 99.9% of exits lines parse into room blocks, 78% of room arrivals confirm the predicted room, 0 permanently-lost resolutions, and duplicate-room creation held to 1.5% of blocks. A companion regression suite (`scripts/test-town.ts`) locks down the hard-won localizer behaviors as synthetic scenario tests: switchback trails, mirror-symmetric wings, non-Euclidean grid collisions, portal transits, and the uniform-fingerprint market plaza

### Changed

- Map panel toolbar compacted so it fits the pinned sidebar: the panel title is just "Map" (your current location — room or terrain + coordinates — is now an overlay in the map's top-left corner), Hex/Town are a hexagon and house icon, Center is a crosshair icon, and a gear menu at the far right holds the Labels and Fog toggles, map stats, town rename, and the confirm-guarded delete actions (Clear hex map / Delete town map — use the latter to reset a town that mapped badly; it re-maps as you walk). In Auto view the Hex/Town buttons show which map is actually on screen with a cyan tint (amber still marks the selected mode)
- Fog of war now defaults to OFF and the Labels/Fog preferences persist across sessions (they previously reset every launch)

## [1.12.0] - 2026-07-03

### Added

- Hex wilderness automapper — the Map panel is back, rebuilt from the ground up and now actually working. As you move through the wilderness, every survey paints all visible hexes (up to 19) with their terrain onto a persistent per-character map, so the world fills in around your path instead of one hex at a time. Landmarks from the survey legend (towns, caves, towers, ruins) are placed on their actual hexes and marked with a gold diamond — and hexes whose landmarks name a town, village, city, or hamlet render a house icon instead (Shift+click any hex to toggle its town marker manually). Rivers are drawn as blue hex sides along their actual course. Room descriptions are the ground truth for hexes you stand on ("There is a swift river to the southeast, and south." — bridge and fjord variants included), replacing any guesses the moment you visit; hexes seen only from afar get a preview from the art's blue river chars (rivers and paths share the same `*` character and differ only by ANSI color, and a border only counts when the river runs along its whole span — a river merely touching the hex's corner doesn't mark the edge). Crossing a river edge costs concentration, so auto-walk routes around rivers unless a detour is unreasonable — but stone bridges ("There is a swift river with a stone bridge to the northeast.", or the orange `^` in the art) are zero-concentration crossings: they render as an amber bar across the river edge and routes happily use them. River-crossed hex interiors also get a blue stream overlay. Cliffs get the same treatment: `x`/`c` edge chars in the art and "There is a cliff to the..." descriptions draw dashed stone-colored hex sides, and climbing across one costs concentration in routing exactly like a river crossing. Ctrl+click clears a hex's river and cliff marks along with its blocked marks. Blocked movement ("You must swim...", "There is no exit...") is remembered and drawn as red edge ticks; edges that lead into buildings are marked too, so walks stop routing through them. Movement inside buildings never touches the map (surveys prove you're back outside), stale blocked marks heal automatically when you walk through them, and Ctrl+click clears a hex's blocked marks manually
- Click-to-walk — right-click any mapped hex to auto-walk there. Pathfinding is terrain-aware: it prefers easy ground (plains, farmland, woods) and steers around terrain with concentration hits (swamp, hills, mountains, wasteland) unless the detour would be far longer, while avoiding water and known blocked edges. Walks run at full speed — two moves are kept in flight at a time (as fast as spamming directions yourself) with every step verified against its survey; it stops on blocks, manual movement, or entering a building. Rest the cursor on a hex for a moment to see its terrain, landmarks, and visit info (hover-to-inspect, so click-dragging the map never pops it up). While you're inside a town or building the map dims slightly with an IN TOWN badge in the corner — pan, zoom, and inspection all keep working, but walks refuse to start (hex movement doesn't apply indoors) until you step back outside
- The mapper tracks your position by correlating each survey's terrain view against the map (not just by counting your keypresses), so it survives spammed movement, being led by a group leader, swimming, riding, and forced movement — and self-corrects drift. After a teleport into unrecognizable terrain it shows LOST and automatically re-anchors the moment you reach distinctive terrain. Validated by replaying 5 years of play logs (158,914 wilderness surveys, 99.98% parsed)
- Script API can now enable/disable a single timer by name with `enableTimer(name)` and `disableTimer(name)` — the per-timer counterparts to the existing `enableTimerGroup`/`disableTimerGroup`. Enabling a timer restarts it from its full interval rather than resuming any leftover countdown. (`startTimer`/`stopTimer` remain as aliases.)

### Fixed

- Toggling, editing, adding, or deleting one timer no longer restarts the countdowns of your other running timers. The timer engine now reconciles each change incrementally — only the affected timer is started, stopped, or restarted, and every other timer keeps ticking undisturbed. (Editing a timer's body applies on its next fire without resetting its countdown; changing its interval restarts just that timer.)
- The automapper's original fatal flaw: hex art was being fed to the parser with leading whitespace stripped, which destroyed the column alignment the terrain parser depends on. Survey parsing now runs on untrimmed lines and reads the art via DartMUD's fixed layout template, which is immune to desert terrain (whose `-` character previously blended into hex borders)

## [1.11.0] - 2026-06-30

### Added

- Counter panel now shows a live "This period" readout under the session stats — the number of improves counted in the current period window plus a m:ss countdown and a progress bar to the next rollover, so you can see your real-time pace instead of only the lifetime average. The period rolls over on a timer (not just when the next improve lands), and — like the rest of the counter — is measured in active time: pausing (or closing the app) freezes the entire counter, so every number is exactly the same when you resume, whether that's in five minutes or four weeks
- Counter panel skills table is now sortable — click the Skill, Imps, or per-period rate column header to sort by that field, and click again to flip the direction

### Changed

- Counter panel's /min, /period, /hr stats are now explicitly labeled as session averages (so they're not mistaken for the current period's pace, which the new "This period" readout shows)
- Counter panel skills table now has labeled, aligned columns (Skill · Imps · per-period rate) with a header that stays pinned while you scroll a long skill list, so it's clear what each number means and how it ties to the hot/cold thresholds. The per-skill rate dropped its parentheses and is right-aligned in its own column
- Allocation panel slot colors are now meaningful instead of arbitrary. On the Combat tab, offensive slots (Bonus/Daring/Speed/Aiming) share a hot red→gold ramp and defensive slots (Parry/Control) use cool blues, so you can tell offense from defense at a glance. On the Magic tab, each element now wears a color that evokes it — airy pale cyan, fiery orange-red, ocean blue, and earthy green — replacing the muddy, low-contrast water/earth tones. The slot letters in the column header are now filled color chips (the full slot color as the background) rather than just tinted text, making each column's color easier to match to its stepper and distribution-bar segment

## [1.10.0] - 2026-06-19

### Added

- Trigger line rewrite — a trigger can now rewrite the matched line shown in the terminal (with $0/$1–$9/$line/$me substitution), in addition to gag and highlight. Set it in the trigger editor's "Rewrite line" field; an RW badge marks triggers that use it
- Trigger & Alias group enable/disable — each group header now has an on/off toggle that enables or disables every trigger/alias in that group at once
- Mobile Companion character status bar — the companion now shows your live health, concentration, aura, hunger, thirst, encumbrance, movement, and alignment readouts using the same icons and colors as the desktop status bar, pinned above the command input and ordered to match your desktop layout. On phones the readouts collapse to icon-only chips (tap one to reveal its label); wider screens show full labels.
- Mobile Companion numpad input — on a laptop/desktop browser the physical numpad sends commands, mirroring your customizable DartForge numpad bindings (including non-movement bindings like counter info or movement mode), with the same defaults and always-on behavior as the desktop client
- Mobile Companion quick buttons — your custom quick buttons and toggles now appear on the companion above the command input; tapping one runs it on the desktop (commands, scripts, and toggle flips all handled), with live toggle labels and colors
- Mobile Companion Who & Counters panels — collapsible panels for the online players (Who) list and your improve counters (total imps + per-hour rate), pushed live from the desktop
- Mobile Companion in-game clock and text size — a new sub-bar shows the DartMUD time/date and holiday, with A−/A+ buttons to resize the output text (persisted per device)

### Changed

- Output hot path no longer rebuilds the tab-completion line buffer from scratch on every incoming chunk — it updates in place instead, reducing allocation churn (and GC pauses) during heavy output like combat spam. No visible behavior change
- Allocation panel redesign — replaced the tiny hover-only +/- cells with larger always-visible −/value/+ steppers, while keeping every limb visible at a glance: each limb shows its full name, unspent points, and an Apply button on a title line above a single full-width row of steppers. Slot letters now live in a sticky column header (with bulk −/+ that adjust every limb at once), and Apply All / Save to Profile sit in a sticky bottom bar that no longer requires scrolling. Click any value to type an exact number; −/+ step by 1 (shift = ×5). Applies to both Combat and Magic tabs in Live and Profile views
- Mobile Companion is now responsive to the device — phones keep the on-screen d-pad and Prev/Next history buttons, while wider laptop/desktop browsers hide them in favor of a roomier layout driven by the numpad and arrow keys
- Mobile Companion output now uses a true-black background (matching the desktop terminal) instead of an off-black, with a tuned monospace font and tighter line height so ASCII maps and hex grids render with the correct proportions instead of looking scrunched

### Fixed

- A single malformed saved entry can no longer crash the entire app. Variable, trigger, alias, and who-title stores load straight from disk and then sort/look up by a text field (e.g. name/pattern); one corrupt entry (e.g. a value stored in a legacy format) made those operations throw on `undefined` and white-screen the whole client. Bad entries are now dropped on load (and self-healed out of the file on next save), and the lookups/sorts are guarded
- Sound notifications no longer drop when several fire close together. Each chime shared one audio element, so a second tell/shout/zephyr arriving while the first was still playing just restarted (or cancelled) it — making notifications seem to not play. Chimes now play on independent clones so overlapping alerts all sound
- Connection no longer silently goes "half-open" — if a write stalls or the writer fails (server gone, dead network with no clean close), the client now detects it within ~10s and surfaces a disconnect so reconnect can run, instead of continuing to show incoming output while silently dropping every command you send
- Anti-spam now only collapses identical lines that arrive in quick succession. Previously two identical lines were merged into `[repeated xN]` no matter how far apart they appeared (e.g. 30 seconds), because the tracked line never expired. A repeat now only collapses when it lands within 1 second of the previous occurrence, and each repeat restarts that window; lines further apart are shown in full
- Improve counter elapsed time no longer counts time the app or machine was suspended (sleep, tab throttling). A running counter left while the computer slept would credit the entire suspended span as active time (e.g. showing ~10h after a 5h sleep); suspended gaps are now detected and excluded, so elapsed time and per-period/per-hour rates reflect only active time

## [1.9.0] - 2026-04-18

### Added

- Window state persistence — DartForge now remembers its window position, size, and maximized state between sessions, reopening exactly where you left it

### Changed

- Allocation panel profile selector — replaced left/right arrow navigation with a dropdown switcher; click the profile name to rename, click the chevron to pick from all profiles instantly
- Allocation panel now shows content even when disconnected — profiles and settings are always accessible without an active connection
- Backup restore now requires a two-step confirm — first click flips the button to "Overwrite?", second click performs the restore; clicking away cancels

### Fixed

- Pet skill readouts no longer overwrite player skill counts. Skill verification now only runs against the player's own skill the client explicitly asked the MUD about.

## [1.8.0] - 2026-03-18

### Added

- Global panel font size setting — a single control that sets the default font size for all panels, configurable from Settings > Display or from any panel header. Chat, Who, and Allocations panels support per-panel overrides with a clear-override button (only visible when the panel size differs from global)
- Counter archiving — archive counters to a collapsible dropdown; archived counters preserve all stats and can be restored or deleted, with actions always visible
- Counter pill reordering — drag and drop counter pills to rearrange their display order
- `/levels` command — displays a two-column reference table of all DartMUD skill levels and their improve count ranges

### Changed

- Mobile Companion redesign — new dark terminal aesthetic with glowing accents, d-pad style directional navigation grid with Up/Down, collapsible quick-bar with persisted state, send arrow button, empty state with connecting animation, PWA meta tags, safe-area inset support, and landscape/large-phone responsive tweaks

### Fixed

- Companion: virtual keyboard no longer causes a black box to cover the command input when focusing and scrolling
- Companion: page can no longer be scrolled past its bounds when the keyboard is open, preventing the layout from shifting out of view
- Companion: added scroll-to-bottom button that appears when scrolled up in the output area
- Built-in slash commands (`/skill`, `/counter`, `/block`, etc.) now work inside aliases and triggers — previously only `/delay`, `/echo`, `/spam`, `/var`, and `/convert` were recognized

## [1.7.3] - 2026-03-13

### Fixed

- Companion connect/disconnect buttons now correctly reflect MUD connection state on page load and after disconnect; status is tracked from boot rather than only after companion server starts

## [1.7.2] - 2026-03-13

### Fixed

- App crash on startup caused by spawning a background task outside the async runtime during initialization

## [1.7.1] - 2026-03-13

### Fixed

- Mobile Companion connect/disconnect buttons now show the correct initial state when the page loads (previously always showed "Connect" even if already connected to MUD)

## [1.7.0] - 2026-03-13

### Added

- Chat panel Incoming/Outgoing tabs — Outgoing tab captures sent chat commands (say, tell, shout, ooc, sz) as a timestamped log with search and day separators
- Delete individual chat messages — hover any message row (incoming or outgoing) to reveal a trash button that permanently removes it from history
- Customizable command prompt — change the prompt character (default `>`) and color in Appearance > Display settings
- `swipes` added to NPC gag emote verb list
- **Mobile Companion** — embedded web server (Settings > Mobile Companion) serves a phone-friendly page on your local network; see MUD output with ANSI colors and send commands from your phone; commands from the companion go through the full pipeline (aliases, built-in commands, speedwalk, etc.); output respects gag filters; connect/disconnect the desktop client remotely from the companion page; shows QR code for quick connection (also accessible via Ctrl+Q)

## [1.6.0] - 2026-03-08

### Added

- Toggle buttons — quick buttons can now switch between ON and OFF states, each with its own label, color, and body (commands or script); toggle state is stored as a user variable, accessible via `$variable_name` in scripts and triggers
- Optional name field for triggers — label triggers with a custom name for easier identification in the list (falls back to pattern display when not set)
- Collapsible groups in trigger and alias panels — click group headers to collapse/expand; trigger "Gags" group starts collapsed by default to reduce clutter
- "Show skill counts" setting — appends tracked improve counts to `show skills` and `show quick skills` readouts inline (cyan-colored, e.g. `fighting: Mythic. (12345)`)
- Chat search — click the magnifying glass icon in the chat toolbar to filter messages by sender name or message text; shows match count, press Escape to close
- NPC gag — add NPC names to automatically gag all their speech (say/ask/exclaim) and emotes (blinks, bows, grins, etc.) from both the terminal and chat panel; supports multi-line messages; managed in the Triggers panel under Gag Groups
- `readFile(path)` and `writeFile(path, content)` script APIs — read/write any file from the local filesystem in script-mode triggers, timers, and aliases (desktop app only)
- **Sound Library** — upload custom sounds with names (e.g. "deathAlert") alongside the built-in chime1/chime2; manage in Settings > Sound Library
- `playSound(id)` script API — play sounds by 1-based index (playSound(1) = first sound) or by name (playSound('deathAlert')); built-in chime1/chime2 are always indices 1 and 2, custom sounds start at 3
- Trigger sound selector — triggers can now play any sound from the library via a dropdown (replaces the old boolean toggle); existing triggers with sound alerts auto-migrate to chime1
- `startTimer(name)` and `stopTimer(name)` script APIs — enable/disable timers by name from scripts
- `getGameTime()` script API — returns `{ hour, timeOfDay, date, holiday }` for the current in-game DartMUD clock
- `getCounter(name)` script API — query improve counter state: `{ status, totalImps, elapsedMs, perMinute, perHour, skills }`
- `getMovementMode()` and `setMovementMode(mode)` script APIs — read/change movement mode (normal/leading/rowing/sneaking) from scripts
- `enableTrigger(name)` and `disableTrigger(name)` script APIs — enable/disable triggers by name from scripts (mirrors `startTimer`/`stopTimer` pattern)
- `enableAlias(name)` and `disableAlias(name)` script APIs — enable/disable aliases by name from scripts
- Optional name field for aliases — label aliases with a custom name for easier identification and for use with `enableAlias`/`disableAlias` (falls back to pattern display when not set)
- `enableTriggerGroup(group)` / `disableTriggerGroup(group)`, `enableAliasGroup(group)` / `disableAliasGroup(group)`, `enableTimerGroup(group)` / `disableTimerGroup(group)` script APIs — enable/disable all items in a named group with a single call
- Allocation panel bulk adjust — hover column headers to reveal +/- buttons that adjust all limbs at once (hold Shift for ±5)

### Fixed

- "Show quick skills" count injection — two-column format now correctly detected and parsed (was blocked by overly strict prefix regex and underscore-to-space conversion breaking skill lookups)
- Quick skills offset mapping — re-strips ANSI from raw text internally so character positions align correctly (the pre-stripped text had .trim() applied, shifting offsets)
- Quick skills column alignment — fixed-width count injection keeps column 2 properly positioned
- Quick skills single-skill last line — color guard now accepts one color (last row with odd skill count only has one)
- Count padding — all injected counts right-padded to consistent width (derived from highest tracked skill count) for clean column alignment in both formats
- Added missing "grins" emote to Morrigan sparring gag pattern

## [1.5.1] - 2026-03-07

### Fixed

- Fixed aliases whose body starts with `/var` or `/spam` not capturing command separators (`;;`) in `$*` — e.g. alias `rea` → `/var reattackAction $*` now correctly sets the variable to `k demon;;sf` instead of splitting on `;;`

## [1.5.0] - 2026-03-07

### Added

- Programmatic skill data access — query skill info from aliases, triggers, timers, and macros in both text and script modes
  - **Text mode**: `$skillCount(name)`, `$skillLevel(name)`, `$skillTier(name)`, `$skillNext(name)`, `$skillGroup(name)` — supports captures like `$skillCount($1)`
  - **Script mode**: `getSkill("name")` returns `{ level, count, tier, next, group }`; individual accessors `getSkillCount()`, `getSkillLevel()`, `getSkillTier()`, `getSkillNext()`, `getSkillGroup()`
- `/powercast [adjustment]` — casts lirrin's glow at `(spell_casting_count + adjustment) × 100` power; flows through normal command pipeline (action blocking, aliases, triggers)
- Session Log Viewer — full-screen centered modal with session sidebar, whitespace-preserving log display, and working command/output filters; user commands now logged with `>>` prefix for clear identification, bare MUD prompts (`> `) stripped from logs
- "Select on send" setting: after sending a command, keeps it highlighted in the input instead of clearing — type to replace or press Enter to resend (off by default, toggle in Settings)
- Macros panel — bind keyboard hotkeys (Ctrl+1, Alt+F5, etc.) to command sequences or JavaScript scripts; supports the same command/script modes as quick buttons, aliases, and triggers

### Changed

- Quick buttons are now drag-and-droppable for reordering (replaces right-click Move Left/Right)
- Allocations panel compacted for narrow pinned widths: cells shrunk from 36px to 26px, null/arcane columns removed (PointBar still shows distribution)
- Counter panel compacted: merged Total and Elapsed into one line, removed divider, tightened padding throughout
- Chat panel: tightened padding on filter and toggle rows
- DRY: extracted shared `cleanLine`/`stripScorePrefix` utilities — replaced 11 duplicate prompt-stripping regex patterns across all pattern matchers
- Settings migrations collapsed from 17 per-feature steps to 4 per-release steps with version normalization
- Performance: memoized regex compilation in variable engine — avoids recompiling on every command
- Performance: optimized Rust connection hot path — reduced allocations in command sending, TCP read loop, and ANSI processing (fast-path UTF-8 conversion, pre-allocated response buffers, consolidated lock acquisition)

### Fixed

- Removed extra blank line the server inserts before the `>` prompt in the terminal
- Fixed stray newlines from gagged lines: blank lines before AND after gagged content (gag groups, triggers, compact mode, sync) are now suppressed using deferred blank line emission

### Removed

- Removed `[timer: <name>]` echo in the terminal each time a timer fires

## [1.4.0] - 2026-03-05

### Changed

- Web client proxy ported from Fly.io/Rust to a Cloudflare Worker using Durable Objects — eliminates hosting costs by running on Cloudflare's free tier
- Removed old Fly.io Rust proxy (account expired, code no longer needed)
- Chat "Mine" filter is now a visual toggle — own messages are always captured and stored; toggling "Mine" instantly shows/hides them without losing history

### Fixed

- Script editor (Global Script panel) now scrolls with the mouse wheel when content exceeds the panel height
- Script editor fills the full panel height instead of starting at a fixed 120px minimum

### Added

- `lastUserInputTime()` script API — returns the epoch timestamp of the last user-typed command (not timers, triggers, or aliases). Resets each session. Enables idle detection via timer scripts
- Popout script editor — hover over any script editor (triggers, aliases, timers, global scripts, quick buttons) to reveal an expand button; click to open a large centered modal for comfortable editing; includes a Save button, line count, and a syntax help popover with the full script API reference; edits sync in real-time; close with Escape, click outside, or the collapse button
- Skill panel shows total improvement count at the bottom of the skill list, reflecting the currently selected category
- Removed character name from the Skills panel header for a cleaner look
- Configurable command separator — the character(s) used to chain multiple commands is now configurable in Settings > Output (default `;;` for new installs, `;` preserved for existing users). Single semicolons in normal text (e.g. "say hey; how are you?") no longer break into separate commands when using `;;`
- Quick Buttons — customizable command buttons in a row between the terminal and status bar; click to fire commands or scripts instantly; right-click for edit, delete, enable/disable, and reorder; supports both command mode (with alias expansion) and JavaScript script mode; persists across sessions
- JavaScript scripting engine for triggers, aliases, and timers — toggle "Script" in the editor to write JS bodies with `send()`, `echo()`, `await delay()`, `spam()`, `setVar()`, `getVar()`, and capture variables (`$0`-`$9`, `$line`, `$me`). Supports `if/else`, loops, `await`, and shared functions via the Global Script panel
- Per-timer status bar visibility toggle — each timer can be shown or hidden in the command input countdown area via a "Show countdown in status bar" checkbox in the timer editor
- Global Script panel — define reusable JavaScript functions and constants shared across all script-mode triggers and aliases; accessible from the toolbar Scripts button
- Multi-line trigger matching — triggers can now buffer lines between a start pattern and an end pattern (regex), then fire with the joined text; ideal for tells and messages that wrap across multiple lines; toggle "Multi-line" in the trigger editor and set an end pattern; max 10 lines safety cap; buffers clear on disconnect
- CodeMirror 6 editor for all script bodies — syntax highlighting, line numbers, bracket matching, Tab/Shift+Tab indentation, and Ctrl+S save support replaces plain textareas in the Global Script panel, trigger editor, and alias editor
- `spam(count, text)` scripting API — send a command N times (max 1000), matching `/spam` directive syntax
- Retry with exponential backoff for Dropbox uploads — up to 4 retries on 429/5xx errors (1s, 2s, 4s, 8s backoff); failed uploads are queued as pending and retried on next page load
- Allocation panel "Not connected" state — shows a placeholder until the user logs in, matching the Who panel pattern
- StorageModeButton component for switching storage modes
- Settings panel storage section showing the current storage mode
- Web meta tags, favicons, and OG image for the web client
- Netlify deployment config (`netlify.toml`)
- Screenshot Mode — capture the visible terminal as a styled PNG with macOS-style window chrome (colored dots, title bar, rounded corners) and copy to clipboard; triggered via toolbar button, context menu, or `Ctrl+Shift+S`; renders directly from xterm's canvas so ANSI colors are fully preserved
- `/counter toggle` command — smart-toggles the active counter between start and pause
- Numpad `/`, `*`, `-`, and `.` keys are now configurable in Settings → Numpad Mappings (previously `/` and `*` were hardcoded, `-` and `.` were ignored)

### Fixed

- Screenshot Mode failing in desktop app — now uses Tauri clipboard plugin for image writing instead of unsupported web Clipboard API
- Gagged lines leaving orphan blank lines in terminal — empty separator lines adjacent to gagged content (gag groups, triggers, compact mode) are now suppressed so gagging doesn't leave vertical whitespace gaps
- Dropbox sync overwriting allocations — initial sync now uses remote data entirely for non-skill files instead of shallow-merging with localStorage, preventing stale local data from corrupting allocation profiles
- Web client disconnect not updating UI — proxy now sends a status message to the client on disconnect
- Password manager autofill overwriting both character slots with the same credentials — each slot now has unique `name`/`autocomplete` section attributes

## [1.3.0] - 2026-02-28

### Changed

- Chat panel now shows a full-height "Today" section by default — Today fills the entire panel viewport and you scroll past it to reach older messages; if no messages arrived today, a placeholder fills the space; older messages render normally with day separators
- Moved timestamp format toggle (12h/24h) from Settings into the Chat panel toolbar — one less settings section, and the control lives where it's actually used

### Added

- `npm run version:next` command — bump version locally at the start of a feature branch so dev builds reflect the correct upcoming version; idempotent and CI-compatible
- Manual panel collapse — hover the resize handle between a pinned panel and the terminal to reveal a collapse chevron; click to shrink the panel to its icon strip without unpinning; click the expand chevron at the top of the icon strip to restore; state persists across sessions
- Who panel font size controls — +/- buttons in the header to adjust player name size (8–18px, persisted)
- Chat panel font size controls — +/- buttons in the header to adjust message text size (8–18px, persisted); language badges and type badges scale proportionally
- Shared `FontSizeControl` component used by both Who and Chat panels
- Skill panel filter bar now appears on all category tabs, not just "All" — search within any skill group
- Added `--color-pink` to theme for consistent theming of TELL badges
- Shared `PanelHeader` component for consistent panel headers with optional toolbar row
- Anti-spam — collapses consecutive identical MUD output lines into a single line with a dim repeat count (e.g. `[x5 repeated]`); flushes after 1 second of inactivity or when the next different line arrives; toggle in Settings > Output
- `/counter` command — manage improve counters from the command line; `/counter list` shows all counters, `/counter status` shows a quick one-liner for the active counter, `/counter info` shows detailed stats, `/counter start|pause|stop|clear` controls the active counter, `/counter switch <name>` switches by name
- Counter actions (start, pause, resume, stop, clear) now echo feedback to the terminal window
- `/apt` command — show aptitude info for a spell or skill by abbreviation or name (e.g. `/apt sc`, `/apt fireball`); displays current improve count, tier, and improves to next tier
- `/spam` echo — `/spam` now prints `[Spam: command (xN)]` in the terminal before executing
- Fuzzy name matching for spells and skills — `findSpellFuzzy` and `findSkillFuzzy` with punctuation-insensitive lookup (`nameUtils.ts`)
- "Quite Hungry" and "Quite Thirsty" need levels added to hunger/thirst tracking
- Chat panel "Mine" toggle — hide/show your own say/shout/OOC messages in the chat log; defaults to hidden; persisted across sessions
- `/autoinscribe` command — automated inscription practice loop; `/autoinscribe <spell> @<power>` starts the cycle (checks concentration, inscribes, invokes, repeats); echoes the MUD command each cycle; `/autoinscribe power @<n>` adjusts mid-loop; `/autoinscribe off` stops; blue badge in command input shows status and click-to-stop; activates action blocker during inscribing/invoking to prevent accidental interrupts; detects concentration-broken interrupts and stops gracefully
- `/autocast` command — automated spell practice loop with power auto-adjustment and weight mode; `/autocast <spell> @<power> [args]` starts the cycle (checks concentration, casts at given power, adjusts dynamically on success/near-success); echoes the MUD command each cycle; when power hits the floor (50) and a weight item is configured, enters weight mode — takes weight from a container on success, puts it back on fail; `/autocast adjust power @<n>` sets power directly; `/autocast adjust power <up> <down>` and `/autocast adjust weight <up> <down>` set adjustment amounts; `/autocast set weight <item>` and `/autocast set container <name>` configure weight mode (persisted); `/autocast off` stops and returns all carried weight; green badge (normal) / amber badge (weight mode) in command input; activates action blocker during casting to prevent accidental interrupts; detects concentration-broken interrupts and stops gracefully
- `/announce` command — auto-broadcast skill improvements via OOC; `/announce on` sends "skillname+", `/announce brief` sends "+", `/announce verbose` sends "skillname+ (count)"; `/announce pet on|brief|verbose` for pet announcements; orange badge in command input when active; click badge to stop
- `/autoconc` command — auto-execute any command(s) on full concentration (BEBT); `/autoconc <action>` saves the action (does not start — use `/autoconc on` to start); fires the action once on BEBT, then waits for conc to drop and recover before firing again (single-shot re-arm); actions support aliases, `/spam`, `/delay`, `/echo`, `/var`, and semicolons for multi-command chains; `/autoconc on` starts with the saved action (persisted across sessions); `/autoconc off` stops; `/autoconc status` shows current state; purple badge in command input shows status and click-to-stop; auto-stops on unconscious

### Changed

- All built-in `/` command error and usage messages now use a consistent `[CommandName]` prefix in red (e.g. `[Autocast] Usage: ...`, `[Counter] No active counter.`) — makes it clear which command produced the error; `/spam`, `/delay`, and `/echo` now show usage errors instead of being sent raw to the MUD when syntax is wrong
- Aura status bar color now extracted from the MUD's actual ANSI color codes instead of using hardcoded hex values — matches in-game colors exactly and follows terminal theme customization
- Multi-colored aura descriptors (e.g. "very dim red", "reddish-orange") now render each word in its MUD ANSI color in the status bar pill instead of a single flat color
- Auto-tools (`/autocast`, `/autoinscribe`, `/autoconc`) no longer poll concentration by sending `conc` every 2 seconds — they passively watch natural MUD concentration recovery messages instead; `on` sends a single initial `conc` to kick off

### Removed

- `/notify` debug command — was a development-only test for system notifications, not needed

### Fixed

- Aura pill color no longer sticks to the previous color when aura drops to "None" — correctly resets to grey
- "Bashing" skill is now correctly categorized as Other instead of Combat
- Chat timestamps no longer show "-1m" for self-sent messages (clock skew fix)
- TELL badge was rendering white (unresolved `text-pink` class) — now correctly renders in pink
- Chat pattern: "asks you" detection now works (DartMUD omits "to" for ask, e.g. "Alice asks you in common")
- Chat pattern: OOC messages containing "+" (skill improve announcements) are no longer captured as chat
- Chat pattern: multi-line say/ask/exclaim messages are now buffered and matched correctly
- Who pattern parsing improvements for edge cases
- Hunger/thirst danger thresholds adjusted from severity 6 to 7 to account for new intermediate levels
- Who panel now clears player list on disconnect instead of showing stale data

### Changed

- Standardized all panel headers — extracted shared `PanelHeader` component replacing 16 hand-rolled headers across every panel (Skills, Chat, Who, Counter, Notes, Alloc, Currency, Babel, Map, Aliases, Triggers, Timers, Variables, Appearance, Settings, Guide); consistent two-row layout with title row + optional toolbar row; all slideout panels now have a × close button
- Slideout "new" buttons — Alias, Timer, Trigger, Variable, and Skill panels now show labeled "New Alias", "New Timer", etc. buttons instead of bare `+` icons
- Chat panel toolbar reordered — font size control first, sort button second (consistent with Who panel)
- Removed SkillPanel's conditional left/right button ordering based on pin side — actions now live in the standard toolbar row
- Removed custom gold-styled header from Guide panel in favor of standard PanelHeader
- Performance: DRY refactor across App.tsx, useAppSettings, useMudConnection, useTimerEngines, and outputFilter — extracted shared helpers, eliminated redundant computations, and memoized callbacks (~400 lines removed)
- Skill panel filter bar is more compact (smaller padding and input size)
- Chat panel redesigned — compact single-line layout with sender, badges, and message inline instead of two-row format; timestamps simplified to time-only (day separators handle date context); significantly more messages visible in the same space
- Chat panel now shows day separator bars (Today, Yesterday, full date) between message groups from different days
- Chat timestamps show full absolute datetime on hover
- Chat panel language badges now have unique colors per language (previously 7 languages shared gray, several others duplicated)
- Chat panel anonymous messages now show an always-visible inline "who?" button instead of a hidden hover-only "?" button
- Reduced Who panel default player name font size from 12px to 11px
- Who panel title mapping: moved clear icon to trash can icon inside the edit form
- Standardized delete confirmation across all panels — extracted shared `ConfirmDeleteButton` component replacing 10 inline implementations (Alias, Variable, Timer, Trigger, Babel, Skill, Notes, Alloc combat/magic profiles, Counter); Who panel title mapping delete now requires two-click confirmation instead of firing immediately
- Standardized counter panel clear button — now uses the same two-click confirm pattern and visual style as delete, replacing the old timeout-based pill button
- Extracted `ToggleSwitch` from SettingsPanel into shared.tsx for reuse across panels (Triggers gag group toggles now use it too)

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
- Alias system with exact, prefix, and regex match modes, positional args ($1-$9, $\*, $-), and speedwalk
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
