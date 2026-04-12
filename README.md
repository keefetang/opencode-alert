# opencode-alert

OS notifications for OpenCode. Alerts you when your agent needs attention — permission requests, questions, errors — so you don't have to watch the terminal.

## How It Works

The plugin watches OpenCode events and sends native OS notifications:

- **Permission needed** — the agent wants to run a command that requires approval
- **Question asked** — the agent is waiting for your answer
- **Error** — something went wrong
- **Cancelled** — the session was aborted
- **Subagent done** — a delegated task completed (optional)
- **Session idle** — the agent stopped and is waiting for input (optional)

Notifications are suppressed when your terminal is already focused — no interruptions when you're already looking at the output.

## Install

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "plugin": ["opencode-alert"]
}
```

Restart OpenCode. Works immediately with sensible defaults — no configuration needed.

## Supported Platforms

| Platform | Notification method | Dependencies |
|----------|-------------------|--------------|
| **macOS** | `osascript` (Notification Centre) | None |
| **Linux** | `notify-send` | `libnotify` (usually pre-installed) |

Windows support is planned for a future release.

### macOS Notification Style

Notifications appear as banners by default. macOS controls whether they show as dismissible banners or persistent alerts that stay until clicked — this is a system-level setting, not a plugin option.

To change the style: **System Settings → Notifications → Script Editor** → set the alert style to "Alerts".

## Configuration

A default config file is created automatically on first run at `~/.config/opencode/opencode-alert.json`. Edit it to customise:

```json
{
  "sounds": {
    "permission": "Submarine",
    "error": "Basso"
  },
  "quietHours": {
    "enabled": false,
    "start": "22:00",
    "end": "08:00"
  },
  "notifyChildSessions": false,
  "terminal": null,
  "notifyOnIdle": true,
  "suppressWhenFocused": true
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sounds.permission` | string | `"Submarine"` | macOS sound for permission/question notifications |
| `sounds.error` | string | `"Basso"` | macOS sound for error notifications |
| `quietHours.enabled` | boolean | `false` | Suppress all notifications during quiet hours |
| `quietHours.start` | string | `"22:00"` | Quiet hours start (HH:MM) |
| `quietHours.end` | string | `"08:00"` | Quiet hours end (HH:MM) |
| `notifyChildSessions` | boolean | `false` | Notify when subagent tasks complete |
| `terminal` | string \| null | `null` | Override terminal detection (see below) |
| `notifyOnIdle` | boolean | `true` | Notify when agent stops without requesting input |
| `suppressWhenFocused` | boolean | `true` | Skip notifications when terminal is focused |

### Terminal Detection

The plugin auto-detects these terminals and suppresses notifications when they're focused:

- Ghostty
- iTerm2
- WezTerm
- Apple Terminal
- Kitty
- Alacritty
- Hyper

Set `"terminal": "ghostty"` (or any terminal name) in config to override detection if it fails.

## Notification Behaviour

**Debounce:** When a specific event fires (permission, error, question), the plugin marks that session. If a generic `session.idle` fires within 3 seconds of a specific event for the same session, the idle notification is suppressed. This prevents duplicate "completed" notifications after permission prompts.

**Quiet hours:** Supports overnight spans (e.g., 22:00–08:00). All notifications are suppressed during quiet hours.

**Focus detection:** On macOS, uses AppleScript to check the frontmost app. On Linux, uses `xdotool`. If the terminal is focused, notifications are skipped — you're already looking at the output.

## License

MIT
