import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotifyOptions {
  title: string;
  subtitle?: string;
  message: string;
  /** macOS sound name (e.g. "default", "Submarine", "Basso"). Ignored on Linux. */
  sound?: string;
}

// ---------------------------------------------------------------------------
// Platform dispatch
// ---------------------------------------------------------------------------

const platform = process.platform;

/**
 * Send an OS notification. Fire-and-forget — never throws.
 *
 * - macOS: osascript `display notification`
 * - Linux: notify-send
 * - Other platforms: no-op (Windows support can be added later)
 */
export function notify(opts: NotifyOptions): void {
  try {
    if (platform === "darwin") {
      notifyMacOS(opts);
    } else if (platform === "linux") {
      notifyLinux(opts);
    }
    // Other platforms: silent no-op
  } catch {
    // Never let a notification failure propagate
  }
}

// ---------------------------------------------------------------------------
// macOS — osascript
// ---------------------------------------------------------------------------

/** Escape characters that would break AppleScript string literals. */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function notifyMacOS(opts: NotifyOptions): void {
  const title = escapeAppleScript(opts.title);
  const subtitle = opts.subtitle ? escapeAppleScript(opts.subtitle) : "";
  const msg = escapeAppleScript(opts.message);

  const sound = opts.sound ?? "default";
  let script = `display notification "${msg}" with title "${title}"`;
  if (subtitle) {
    script += ` subtitle "${subtitle}"`;
  }
  script += ` sound name "${escapeAppleScript(sound)}"`;

  spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref();
}

// ---------------------------------------------------------------------------
// Linux — notify-send
// ---------------------------------------------------------------------------

function notifyLinux(opts: NotifyOptions): void {
  const titlePart = opts.subtitle
    ? `${opts.title}: ${opts.subtitle}`
    : opts.title;

  const args = [titlePart, opts.message, "-t", "5000"];
  spawn("notify-send", args, { stdio: "ignore", detached: true }).unref();
}
