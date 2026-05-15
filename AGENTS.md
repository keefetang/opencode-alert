# AGENTS.md -- opencode-alert

## What This Is

An OpenCode plugin that sends native OS notifications when the agent needs attention — permission requests, questions, errors, session idle. Suppresses notifications when the terminal is focused.

## Architecture

Four source files. `index.ts` is the plugin entry point — loads config, wires the event handler, exports the plugin. `config.ts` handles config file loading, type-safe merging, and quiet hours logic. `terminal.ts` detects the terminal emulator and checks if it's focused. `notify.ts` dispatches notifications via multi-protocol terminal escape sequences (OSC 777/9/99, Windows toast) with tmux passthrough support.

Entry point: `src/index.ts` exports `OpenCodeAlertPlugin`.

## Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin entry, event handler, session title cache, debounce |
| `src/config.ts` | Config types, loadConfig(), isQuietHours() |
| `src/terminal.ts` | Terminal detection, focus check (macOS/Linux) |
| `src/notify.ts` | Multi-protocol notification dispatch (OSC 777/9/99, Windows toast, tmux passthrough) + sound |

## Events Handled

| Event | Notification |
|-------|-------------|
| `permission.updated` | "Permission Needed" with permission title |
| `message.part.updated` (question tool) | "Question — Needs your answer" |
| `session.error` | "Error" with error message |
| `message.updated` (aborted) | "Cancelled" |
| `message.part.updated` (task tool) | "Subagent Done" (if `notifyChildSessions` enabled) |
| `session.idle` | "Completed" (if `notifyOnIdle` enabled) |

## Conventions

- **Pure JS only** — no native dependencies. Uses Node.js built-ins (`child_process`, `fs`, `path`, `os`).
- **Source ships as `.ts`** — Bun transpiles natively. No build step.
- **Fire-and-forget notifications** — `spawn(...).unref()`. Never blocks the event loop.
- **Debounce** — specific events (permission, error) suppress generic idle for 3 seconds per session.
- **Focus detection is cached** — 1.5s TTL to avoid repeated `execSync` on rapid events.
- **Bounded caches** — both Maps (recentSpecific, titleCache) capped at 200 entries.

## Git Conventions

- **Always confirm with the user before pushing to remote.**
- **Squash related commits before pushing** when possible.
- **CI:** `tsc --noEmit` runs on every push to main and on PRs. Auto-publish to npm on version tags (`v*`).
