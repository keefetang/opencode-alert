import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalInfo {
  name: string;
  /** macOS bundle identifier, if known */
  bundleId: string | null;
  /** Process name for Linux window matching */
  processName: string | null;
}

// ---------------------------------------------------------------------------
// Terminal database
// ---------------------------------------------------------------------------

const TERMINALS: Record<string, TerminalInfo> = {
  ghostty: { name: "Ghostty", bundleId: "com.mitchellh.ghostty", processName: "ghostty" },
  iterm2: { name: "iTerm2", bundleId: "com.googlecode.iterm2", processName: "iTerm2" },
  wezterm: { name: "WezTerm", bundleId: "com.github.wez.wezterm", processName: "wezterm-gui" },
  "apple-terminal": { name: "Terminal", bundleId: "com.apple.Terminal", processName: null },
  kitty: { name: "Kitty", bundleId: "net.kovidgoyal.kitty", processName: "kitty" },
  alacritty: { name: "Alacritty", bundleId: "org.alacritty", processName: "alacritty" },
  hyper: { name: "Hyper", bundleId: "co.zeit.hyper", processName: "hyper" },
  "windows-terminal": { name: "Windows Terminal", bundleId: null, processName: "WindowsTerminal" },
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the current terminal emulator from environment variables.
 * Returns null if the terminal cannot be identified.
 */
export function detectTerminal(override?: string | null): TerminalInfo | null {
  // Config override takes precedence
  if (override) {
    const key = override.toLowerCase().replace(/\s+/g, "-");
    return TERMINALS[key] ?? null;
  }

  const env = process.env;

  // TERM_PROGRAM is the most reliable indicator
  const termProgram = env["TERM_PROGRAM"]?.toLowerCase();
  if (termProgram) {
    if (termProgram.includes("ghostty")) return TERMINALS["ghostty"]!;
    if (termProgram.includes("iterm")) return TERMINALS["iterm2"]!;
    if (termProgram.includes("wezterm")) return TERMINALS["wezterm"]!;
    if (termProgram === "apple_terminal") return TERMINALS["apple-terminal"]!;
    if (termProgram.includes("hyper")) return TERMINALS["hyper"]!;
  }

  // LC_TERMINAL (set by some terminals)
  const lcTerminal = env["LC_TERMINAL"]?.toLowerCase();
  if (lcTerminal) {
    if (lcTerminal.includes("iterm")) return TERMINALS["iterm2"]!;
  }

  // Kitty sets its own env var
  if (env["KITTY_WINDOW_ID"]) return TERMINALS["kitty"]!;

  // Alacritty detection via TERM
  if (env["TERM"]?.includes("alacritty")) return TERMINALS["alacritty"]!;

  // Windows Terminal
  if (env["WT_SESSION"]) return TERMINALS["windows-terminal"]!;

  return null;
}

// ---------------------------------------------------------------------------
// Focus detection
// ---------------------------------------------------------------------------

const platform = process.platform;

/**
 * Check if the terminal emulator is the focused (frontmost) application.
 * Returns false if detection fails or platform is unsupported.
 */
export function isTerminalFocused(terminal: TerminalInfo | null): boolean {
  if (!terminal) return false;

  try {
    if (platform === "darwin") {
      return isFocusedMacOS(terminal);
    }
    if (platform === "linux") {
      return isFocusedLinux(terminal);
    }
  } catch {
    // If focus detection fails, assume not focused (i.e., send the notification)
  }
  return false;
}

function isFocusedMacOS(terminal: TerminalInfo): boolean {
  const script = `tell application "System Events" to set frontApp to name of first application process whose frontmost is true`;
  const frontApp = execSync(`osascript -e '${script}'`, {
    timeout: 2000,
    encoding: "utf-8",
  }).trim().toLowerCase();

  return frontApp === terminal.name.toLowerCase();
}

function isFocusedLinux(terminal: TerminalInfo): boolean {
  if (!terminal.processName) return false;

  // Get the active window's PID via xdotool
  const windowId = execSync("xdotool getactivewindow", {
    timeout: 2000,
    encoding: "utf-8",
  }).trim();

  // Validate windowId is numeric before interpolating into a shell command
  if (!/^\d+$/.test(windowId)) return false;

  const pid = execSync(`xdotool getwindowpid ${windowId}`, {
    timeout: 2000,
    encoding: "utf-8",
  }).trim();

  // Validate PID is numeric before using in a file path
  if (!/^\d+$/.test(pid)) return false;

  // Read the process name directly from procfs — no need to spawn a shell
  const comm = readFileSync(`/proc/${pid}/comm`, "utf-8").trim();

  return comm.toLowerCase() === terminal.processName.toLowerCase();
}

// ---------------------------------------------------------------------------
// Focus terminal
// ---------------------------------------------------------------------------

/**
 * Bring the terminal emulator to the front.
 * No-op if the terminal or platform doesn't support it.
 */
export function focusTerminal(terminal: TerminalInfo | null): void {
  if (!terminal) return;

  try {
    if (platform === "darwin" && terminal.bundleId) {
      execSync(`open -b "${terminal.bundleId}"`, { timeout: 2000, stdio: "ignore" });
    } else if (platform === "linux" && terminal.processName) {
      execSync(`wmctrl -a "${terminal.processName}"`, { timeout: 2000, stdio: "ignore" });
    }
  } catch {
    // Silently ignore focus failures — non-critical
  }
}
