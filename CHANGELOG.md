# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [0.3.2] — 2026-05-16

### Added
- 79 tests across 3 files (config, terminal, notify)
- CI and publish workflows now run `bun test`

### Changed
- Strict tsconfig (added `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.)
- Standardized .gitignore, switched lockfile from package-lock.json to bun.lock
- AGENTS.md references shared plugin SDK doc

## [0.3.1] - 2026-05-16

### Changed
- Updated `@opencode-ai/plugin` from ^1.4.3 to ^1.15.0
- Updated `softprops/action-gh-release` from v2 to v3 (Node 24 runtime)
- Updated `typescript` from 6.0.2 to 6.0.3
- Updated `bun-types` from 1.3.12 to 1.3.14

## [0.3.0] - 2026-05-15

### Added
- **Multi-protocol notification dispatch** — routes to OSC 777 (Ghostty, WezTerm, foot, rxvt-unicode), OSC 9 (iTerm2), OSC 99 (Kitty), or Windows toast (Windows Terminal) based on auto-detected terminal
- **tmux passthrough** — OSC sequences are wrapped in DCS passthrough when `$TMUX` is set, alongside existing client TTY resolution
- **Kitty support** — OSC 99 with monotonic notification IDs for concurrent notifications
- **iTerm2 support** — OSC 9 protocol, detected via `TERM_PROGRAM` or `ITERM_SESSION_ID`
- **Windows Terminal support** — PowerShell toast notifications with injection-safe escaping
- **`soundCommand` config option** — run a custom shell command alongside built-in sounds (any platform). Also available via `OPENCODE_ALERT_SOUND_CMD` env var
- **`protocol` field on terminal database entries** — informational, indicates which notification protocol each terminal supports

### Changed
- Notification writes are now non-blocking — replaced `writeFileSync` with async `fs.open`/`write`/`close` callbacks
- When no TTY path is resolved, notifications are dropped silently (never writes to stdout — OpenCode owns it)
- Non-tmux TTY resolution is cached after first call — eliminates repeated `execSync("tty")` on every notification

### Security
- OSC sanitization now strips all C0/C1 control characters (0x00-0x1F, 0x7F-0x9F), including ST (0x9C) which terminates OSC in 8-bit terminal mode

## [0.2.0] - 2026-05-13

### Changed
- Switched notifications from `osascript` to OSC 777 escape sequences — lighter weight, works inside tmux, no applescript dependency
- Sound system changed from macOS sound names to full file paths (e.g. `/System/Library/Sounds/Glass.aiff`)
- Per-event sound configuration: separate sound paths for idle, permission, question, and error events

## [0.1.1] - 2026-04-12

### Removed
- `persistentAlerts` config option — the modal dialog (`display alert`) was a poor substitute for native persistent notifications and appeared as a centered blocking dialog rather than a proper macOS notification

### Changed
- All macOS notifications now use `display notification` (Notification Centre banners) consistently

### How to get persistent notifications on macOS
macOS controls notification style at the system level. To make OpenCode notifications stay on screen until clicked: **System Settings → Notifications → Script Editor → Alert style → Alerts**.

## [0.1.0] - 2026-04-01

### Added
- Initial release
- OS notifications for OpenCode sessions: permission requests, questions, errors, cancellations, session idle, subagent completion
- macOS support via `osascript`, Linux support via `notify-send`
- Terminal focus detection — suppresses notifications when your terminal is already active
- Quiet hours support with overnight span handling
- Configurable sounds per event type
- Auto-generated config file on first run at `~/.config/opencode/opencode-alert.json`
