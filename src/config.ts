import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuietHours {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface SoundConfig {
  permission: string;
  error: string;
}

export interface NotifyConfig {
  sounds: SoundConfig;
  quietHours: QuietHours;
  /** Notify when child (subagent) sessions complete */
  notifyChildSessions: boolean;
  /** Override terminal detection — e.g. "ghostty", "iterm2" */
  terminal: string | null;
  /** Notify on session.idle (false = suppress idle notifications) */
  notifyOnIdle: boolean;
  /** When false, skip terminal focus detection and always send notifications */
  suppressWhenFocused: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: NotifyConfig = {
  sounds: {
    permission: "Submarine",
    error: "Basso",
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
  },
  notifyChildSessions: false,
  terminal: null,
  notifyOnIdle: true,
  suppressWhenFocused: true,
};

const CONFIG_PATH = join(homedir(), ".config", "opencode", "opencode-alert.json");

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export function loadConfig(): NotifyConfig {
  // Create default config file on first run so users can discover options
  if (!existsSync(CONFIG_PATH)) {
    try {
      mkdirSync(dirname(CONFIG_PATH), { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
    } catch {
      // Non-critical — proceed with defaults if write fails
    }
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_CONFIG };
    const obj = parsed as Record<string, unknown>;

    return {
      sounds: mergeSounds(obj["sounds"]),
      quietHours: mergeQuietHours(obj["quietHours"]),
      notifyChildSessions: typeof obj["notifyChildSessions"] === "boolean" ? obj["notifyChildSessions"] : DEFAULT_CONFIG.notifyChildSessions,
      terminal: typeof obj["terminal"] === "string" ? obj["terminal"] : DEFAULT_CONFIG.terminal,
      notifyOnIdle: typeof obj["notifyOnIdle"] === "boolean" ? obj["notifyOnIdle"] : DEFAULT_CONFIG.notifyOnIdle,
      suppressWhenFocused: typeof obj["suppressWhenFocused"] === "boolean" ? obj["suppressWhenFocused"] : DEFAULT_CONFIG.suppressWhenFocused,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

/** Parse "HH:MM" into minutes since midnight. Returns -1 on invalid input. */
function parseTime(time: string): number {
  const parts = time.split(":");
  const h = parseInt(parts[0] ?? "", 10);
  const m = parseInt(parts[1] ?? "", 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

export function isQuietHours(config: NotifyConfig): boolean {
  if (!config.quietHours.enabled) return false;

  const start = parseTime(config.quietHours.start);
  const end = parseTime(config.quietHours.end);
  if (start < 0 || end < 0) return false;

  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();

  // Overnight span: e.g. 22:00 - 08:00
  if (start > end) {
    return current >= start || current < end;
  }
  // Same-day span: e.g. 13:00 - 14:00
  return current >= start && current < end;
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

function mergeSounds(raw: unknown): SoundConfig {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_CONFIG.sounds };
  const obj = raw as Record<string, unknown>;
  return {
    permission: typeof obj["permission"] === "string" ? obj["permission"] : DEFAULT_CONFIG.sounds.permission,
    error: typeof obj["error"] === "string" ? obj["error"] : DEFAULT_CONFIG.sounds.error,
  };
}

function mergeQuietHours(raw: unknown): QuietHours {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_CONFIG.quietHours };
  const obj = raw as Record<string, unknown>;
  return {
    enabled: typeof obj["enabled"] === "boolean" ? obj["enabled"] : DEFAULT_CONFIG.quietHours.enabled,
    start: typeof obj["start"] === "string" ? obj["start"] : DEFAULT_CONFIG.quietHours.start,
    end: typeof obj["end"] === "string" ? obj["end"] : DEFAULT_CONFIG.quietHours.end,
  };
}
