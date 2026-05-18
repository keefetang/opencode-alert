import { execSync, spawn } from "node:child_process";
import { open, write as fsWrite, close } from "node:fs";

import type { NotifyProtocol } from "./terminal.js";

// Re-export for convenience — index.ts imports from here
export type { NotifyProtocol } from "./terminal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotifyOptions {
  title: string;
  subtitle?: string;
  message: string;
  /** macOS sound file path (default: /System/Library/Sounds/Glass.aiff). Set to "" to disable. */
  sound?: string;
  /** Optional shell command to run alongside the built-in sound. */
  soundCommand?: string | null;
}

// ---------------------------------------------------------------------------
// Protocol detection — runs once, result cached at module level
// ---------------------------------------------------------------------------

let cachedProtocol: NotifyProtocol | null = null;
let protocolDetected = false;

/**
 * Detect the notification protocol based on environment variables.
 * Detection order (most specific first):
 *   1. WT_SESSION → windows-toast
 *   2. KITTY_WINDOW_ID → osc99
 *   3. TERM_PROGRAM=iTerm.app or ITERM_SESSION_ID → osc9
 *   4. Everything else → osc777 (Ghostty, WezTerm, foot, rxvt-unicode)
 *
 * Call once at plugin init. The result is cached for subsequent notify() calls.
 */
export function detectProtocol(): NotifyProtocol {
  if (protocolDetected) return cachedProtocol!;

  const env = process.env;

  if (env["WT_SESSION"]) {
    cachedProtocol = "windows-toast";
  } else if (env["KITTY_WINDOW_ID"]) {
    cachedProtocol = "osc99";
  } else if (env["TERM_PROGRAM"] === "iTerm.app" || env["ITERM_SESSION_ID"]) {
    cachedProtocol = "osc9";
  } else {
    // Catch-all: osc777 covers Ghostty, WezTerm, foot, rxvt-unicode.
    // This is correct even when TERM_PROGRAM=tmux (Ghostty inside tmux) —
    // Ghostty uses osc777, so the fallback protocol matches by coincidence.
    cachedProtocol = "osc777";
  }

  protocolDetected = true;
  return cachedProtocol;
}

// ---------------------------------------------------------------------------
// TTY resolution — find the real terminal for OSC escape sequences
// ---------------------------------------------------------------------------

/**
 * Resolve the destination TTY for OSC notifications.
 *
 * Inside tmux, stdout goes to a pseudo-terminal that tmux owns — OSC sequences
 * written there are consumed by tmux, not the outer terminal. We need the
 * tmux *client's* TTY (the real terminal connection) instead.
 *
 * tmux path: re-resolved every call — the client can detach and reattach from
 * a different terminal, changing the TTY path. The execSync cost (~2-5ms) is
 * negligible since notifications fire at most every few seconds.
 *
 * Non-tmux path: cached after first resolution — the TTY doesn't change during
 * a session outside tmux.
 *
 * Fallback chain: tmux client_tty → TTY env → tty command → null (drop silently)
 */
let staticTtyCache: string | null | undefined; // undefined = not yet resolved

function getDestTty(): string | null {
  // Inside tmux: always re-resolve (client may reattach from a different terminal)
  if (process.env["TMUX"]) {
    try {
      const clientTty = execSync('tmux display-message -p "#{client_tty}"', {
        encoding: "utf-8",
        timeout: 2000,
      }).trim();
      if (clientTty) return clientTty;
    } catch {
      // tmux command failed — fall through to static resolution
    }
  }

  // Outside tmux (or tmux resolution failed): use cached result
  if (staticTtyCache !== undefined) return staticTtyCache;

  // First call — resolve and cache
  const ttyEnv = process.env["TTY"];
  if (ttyEnv) {
    staticTtyCache = ttyEnv;
    return staticTtyCache;
  }

  try {
    const ttyCmd = execSync("tty", { encoding: "utf-8", timeout: 2000 }).trim();
    if (ttyCmd && !ttyCmd.includes("not a tty")) {
      staticTtyCache = ttyCmd;
      return staticTtyCache;
    }
  } catch {
    // tty command failed — fall through
  }

  staticTtyCache = null;
  return null;
}

// ---------------------------------------------------------------------------
// tmux DCS passthrough
// ---------------------------------------------------------------------------

/**
 * @internal Wrap an OSC sequence in tmux DCS passthrough when running inside tmux.
 * Escapes inner ESC bytes so the outer terminal receives them correctly.
 * Applied to all OSC protocols (777, 9, 99).
 */
export function wrapForTmux(sequence: string): string {
  if (!process.env["TMUX"]) return sequence;
  const escaped = sequence.split("\x1b").join("\x1b\x1b");
  return `\x1bPtmux;${escaped}\x1b\\`;
}

// ---------------------------------------------------------------------------
// OSC payload sanitization
// ---------------------------------------------------------------------------

/**
 * @internal Strip characters that could break an OSC sequence or inject terminal commands.
 * Covers all C0 control characters (0x00-0x1F), DEL (0x7F), and C1 control
 * characters (0x80-0x9F) — including ST (0x9C) which terminates OSC in 8-bit mode.
 */
export function sanitizeOSC(s: string): string {
  return s.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

// ---------------------------------------------------------------------------
// Protocol-specific formatters
// ---------------------------------------------------------------------------

/** @internal */
export function formatOSC777(title: string, body: string): string {
  return `\x1b]777;notify;${title};${body}\x07`;
}

/** @internal */
export function formatOSC9(message: string): string {
  return `\x1b]9;${message}\x07`;
}

/**
 * Kitty OSC 99: two-part notification (title + body).
 * Each notification gets a unique id (monotonic counter) so concurrent
 * notifications don't collide. d=0 means "not done yet" (title part),
 * p=body for the second part (d defaults to 1 = "done, display now").
 */
let osc99Counter = 0;

/** @internal */
export function formatOSC99(title: string, body: string): string {
  const id = ++osc99Counter;
  const titlePart = `\x1b]99;i=${id}:d=0;${title}\x1b\\`;
  const bodyPart = `\x1b]99;i=${id}:p=body;${body}\x1b\\`;
  return titlePart + bodyPart;
}

// ---------------------------------------------------------------------------
// Non-blocking TTY write
// ---------------------------------------------------------------------------

/**
 * Write a buffer to a TTY path asynchronously. Fire-and-forget — errors are
 * silently ignored. Uses the low-level fs.open/write/close callbacks to avoid
 * blocking the event loop (replaces the previous writeFileSync).
 */
function writeTtyAsync(ttyPath: string, data: string): void {
  open(ttyPath, "w", (err, fd) => {
    if (err) return;
    fsWrite(fd, data, (writeErr) => {
      // Always close the fd regardless of write result
      close(fd, () => {});
      if (writeErr) return;
    });
  });
}

// ---------------------------------------------------------------------------
// Windows toast notification
// ---------------------------------------------------------------------------

/** @internal Escape single quotes for PowerShell single-quoted string literals. */
export function escapePowerShell(s: string): string {
  return s.replace(/'/g, "''");
}

/** @internal */
export function windowsToastScript(title: string, body: string): string {
  const safeTitle = escapePowerShell(title);
  const safeBody = escapePowerShell(body);
  const type = "Windows.UI.Notifications";
  const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
  const template = `[${type}.ToastTemplateType]::ToastText01`;
  const toast = `[${type}.ToastNotification]::new($xml)`;
  return [
    `${mgr} > $null`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${safeBody}')) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${safeTitle}').Show(${toast})`,
  ].join("; ");
}

function notifyWindowsToast(title: string, body: string): void {
  try {
    spawn("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)], {
      stdio: "ignore",
      detached: true,
    }).unref();
  } catch {
    // Toast notification failed — non-critical
  }
}

// ---------------------------------------------------------------------------
// Platform dispatch
// ---------------------------------------------------------------------------

const DEFAULT_SOUND = "/System/Library/Sounds/Glass.aiff";

/**
 * Send a desktop notification. Fire-and-forget — never throws.
 *
 * Routes to the appropriate protocol (detected once at init via detectProtocol()).
 * Sound plays on macOS via afplay + optional soundCommand hook.
 */
export function notify(opts: NotifyOptions): void {
  try {
    const protocol = detectProtocol();

    if (protocol === "windows-toast") {
      const title = sanitizeOSC(opts.title);
      const body = opts.subtitle
        ? sanitizeOSC(`${opts.subtitle} — ${opts.message}`)
        : sanitizeOSC(opts.message);
      notifyWindowsToast(title, body);
    } else {
      sendOSCNotification(protocol, opts);
    }

    // Sound: macOS afplay for per-event sounds
    if (process.platform === "darwin") {
      playSound(opts.sound);
    }

    // Sound: user-provided command hook (any platform)
    runSoundCommand(opts.soundCommand);
  } catch {
    // Never let a notification failure propagate
  }
}

// ---------------------------------------------------------------------------
// OSC notification dispatch
// ---------------------------------------------------------------------------

function sendOSCNotification(protocol: "osc777" | "osc9" | "osc99", opts: NotifyOptions): void {
  const title = sanitizeOSC(opts.title);
  const body = opts.subtitle
    ? sanitizeOSC(`${opts.subtitle} — ${opts.message}`)
    : sanitizeOSC(opts.message);

  let sequence: string;
  switch (protocol) {
    case "osc9":
      sequence = formatOSC9(`${title}: ${body}`);
      break;
    case "osc99":
      sequence = formatOSC99(title, body);
      break;
    case "osc777":
    default:
      sequence = formatOSC777(title, body);
      break;
  }

  const wrapped = wrapForTmux(sequence);

  try {
    const destTty = getDestTty();
    if (destTty) {
      writeTtyAsync(destTty, wrapped);
    }
    // No TTY resolved — drop silently. Never write to stdout — OpenCode owns it.
  } catch {
    // TTY write failed — notification silently dropped
  }
}

// ---------------------------------------------------------------------------
// Sound — macOS afplay for per-event sounds
// ---------------------------------------------------------------------------

function playSound(sound: string | undefined): void {
  // Explicit empty string = no sound
  if (sound === "") return;

  const soundPath = sound ?? DEFAULT_SOUND;

  try {
    spawn("afplay", [soundPath], {
      stdio: "ignore",
      detached: true,
    }).unref();
  } catch {
    // Sound playback failed — non-critical
  }
}

// ---------------------------------------------------------------------------
// Sound command hook — user-provided shell command (any platform)
// SAFETY: command must only come from trusted sources (config file, env var).
// Never derive from notification content (error messages, session titles).
// ---------------------------------------------------------------------------

function runSoundCommand(command: string | null | undefined): void {
  if (!command) return;

  try {
    spawn(command, {
      shell: true,
      stdio: "ignore",
      detached: true,
    }).unref();
  } catch {
    // Sound command failed — non-critical
  }
}
