# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

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
