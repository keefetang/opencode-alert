import { execSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotifyOptions {
  title: string;
  subtitle?: string;
  message: string;
  /** macOS sound file path (default: /System/Library/Sounds/Glass.aiff). Set to "" to disable. */
  sound?: string;
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
 * Not cached — if the tmux client detaches and reattaches from a different
 * terminal, the TTY path changes. The execSync cost (~2-5ms) is negligible
 * since notifications fire at most every few seconds.
 *
 * Fallback chain: tmux client_tty → TTY env → tty command → /dev/stdout
 */
function getDestTty(): string {
  try {
    if (process.env["TMUX"]) {
      const clientTty = execSync('tmux display-message -p "#{client_tty}"', {
        encoding: "utf-8",
        timeout: 2000,
      }).trim();
      if (clientTty) return clientTty;
    }
  } catch {
    // tmux command failed — fall through
  }

  // Outside tmux: use TTY env var or tty command
  const ttyEnv = process.env["TTY"];
  if (ttyEnv) return ttyEnv;

  try {
    const ttyCmd = execSync("tty", { encoding: "utf-8", timeout: 2000 }).trim();
    if (ttyCmd && !ttyCmd.includes("not a tty")) return ttyCmd;
  } catch {
    // tty command failed — fall through
  }

  return "/dev/stdout";
}

// ---------------------------------------------------------------------------
// Platform dispatch
// ---------------------------------------------------------------------------

const platform = process.platform;

const DEFAULT_SOUND = "/System/Library/Sounds/Glass.aiff";

/**
 * Send a desktop notification. Fire-and-forget — never throws.
 *
 * - macOS/Linux with supported terminal: OSC 777 escape sequence + optional sound (macOS only)
 * - Windows: no-op (support can be added later)
 */
export function notify(opts: NotifyOptions): void {
  try {
    if (platform === "darwin") {
      notifyOSC777(opts);
      playSound(opts.sound);
    } else if (platform === "linux") {
      notifyOSC777(opts);
    }
    // Other platforms: silent no-op
  } catch {
    // Never let a notification failure propagate
  }
}

// ---------------------------------------------------------------------------
// OSC 777 — works in Ghostty, WezTerm, foot, rxvt-unicode
// ---------------------------------------------------------------------------

/** Strip characters that could break the OSC sequence. */
function sanitizeOSC(s: string): string {
  return s.replace(/[\x07\x1b\n\r]/g, " ");
}

function notifyOSC777(opts: NotifyOptions): void {
  const title = sanitizeOSC(opts.title);
  const body = opts.subtitle
    ? sanitizeOSC(`${opts.subtitle} — ${opts.message}`)
    : sanitizeOSC(opts.message);

  const sequence = `\x1b]777;notify;${title};${body}\x07`;

  try {
    const destTty = getDestTty();
    writeFileSync(destTty, sequence);
  } catch {
    // TTY write failed — notification silently dropped
  }
}

// ---------------------------------------------------------------------------
// Sound — macOS only, via afplay
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
