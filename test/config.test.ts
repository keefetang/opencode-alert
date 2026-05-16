import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import { isQuietHours, parseTime, mergeSounds, mergeQuietHours, resolveSoundCommand } from "../src/config.js";
import type { NotifyConfig, QuietHours, SoundConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a NotifyConfig with quiet hours for testing isQuietHours. */
function qhConfig(overrides: Partial<QuietHours> & { enabled: boolean }): NotifyConfig {
  return {
    sounds: { idle: "", permission: "", question: "", error: "" },
    quietHours: {
      enabled: overrides.enabled,
      start: overrides.start ?? "22:00",
      end: overrides.end ?? "08:00",
    },
    notifyChildSessions: false,
    terminal: null,
    notifyOnIdle: true,
    suppressWhenFocused: true,
    soundCommand: null,
  };
}

// ---------------------------------------------------------------------------
// parseTime
// ---------------------------------------------------------------------------

describe("parseTime", () => {
  test("parses valid HH:MM strings", () => {
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("12:30")).toBe(750);
    expect(parseTime("23:59")).toBe(1439);
    expect(parseTime("08:00")).toBe(480);
  });

  test("returns -1 for invalid formats", () => {
    expect(parseTime("")).toBe(-1);
    expect(parseTime("abc")).toBe(-1);
    expect(parseTime("25:00")).toBe(-1);
    expect(parseTime("12:60")).toBe(-1);
    expect(parseTime("-1:00")).toBe(-1);
    expect(parseTime("12:-5")).toBe(-1);
    expect(parseTime("12")).toBe(-1);
  });

  test("handles single-digit hours and minutes", () => {
    expect(parseTime("1:1")).toBe(61);
    expect(parseTime("9:5")).toBe(545);
  });
});

// ---------------------------------------------------------------------------
// isQuietHours
// ---------------------------------------------------------------------------

describe("isQuietHours", () => {
  test("returns false when disabled", () => {
    const config = qhConfig({ enabled: false, start: "00:00", end: "23:59" });
    expect(isQuietHours(config)).toBe(false);
  });

  test("returns false for invalid time strings", () => {
    const config = qhConfig({ enabled: true, start: "invalid", end: "08:00" });
    expect(isQuietHours(config)).toBe(false);
  });

  test("same-day span — inside window returns true", () => {
    const config = qhConfig({ enabled: true, start: "13:00", end: "14:00" });
    const at1330 = new Date(2026, 0, 15, 13, 30); // 13:30
    expect(isQuietHours(config, at1330)).toBe(true);
  });

  test("same-day span — at start boundary returns true", () => {
    const config = qhConfig({ enabled: true, start: "13:00", end: "14:00" });
    const at1300 = new Date(2026, 0, 15, 13, 0);
    expect(isQuietHours(config, at1300)).toBe(true);
  });

  test("same-day span — at end boundary returns false (exclusive)", () => {
    const config = qhConfig({ enabled: true, start: "13:00", end: "14:00" });
    const at1400 = new Date(2026, 0, 15, 14, 0);
    expect(isQuietHours(config, at1400)).toBe(false);
  });

  test("same-day span — outside window returns false", () => {
    const config = qhConfig({ enabled: true, start: "13:00", end: "14:00" });
    const at0900 = new Date(2026, 0, 15, 9, 0);
    expect(isQuietHours(config, at0900)).toBe(false);
  });

  test("overnight span — late night returns true", () => {
    const config = qhConfig({ enabled: true, start: "22:00", end: "08:00" });
    const at2300 = new Date(2026, 0, 15, 23, 0);
    expect(isQuietHours(config, at2300)).toBe(true);
  });

  test("overnight span — early morning returns true", () => {
    const config = qhConfig({ enabled: true, start: "22:00", end: "08:00" });
    const at0300 = new Date(2026, 0, 15, 3, 0);
    expect(isQuietHours(config, at0300)).toBe(true);
  });

  test("overnight span — at start boundary returns true", () => {
    const config = qhConfig({ enabled: true, start: "22:00", end: "08:00" });
    const at2200 = new Date(2026, 0, 15, 22, 0);
    expect(isQuietHours(config, at2200)).toBe(true);
  });

  test("overnight span — at end boundary returns false (exclusive)", () => {
    const config = qhConfig({ enabled: true, start: "22:00", end: "08:00" });
    const at0800 = new Date(2026, 0, 15, 8, 0);
    expect(isQuietHours(config, at0800)).toBe(false);
  });

  test("overnight span — midday returns false", () => {
    const config = qhConfig({ enabled: true, start: "22:00", end: "08:00" });
    const at1200 = new Date(2026, 0, 15, 12, 0);
    expect(isQuietHours(config, at1200)).toBe(false);
  });

  test("same start and end — zero-width window, never quiet", () => {
    const config = qhConfig({ enabled: true, start: "10:00", end: "10:00" });
    const at1000 = new Date(2026, 0, 15, 10, 0);
    // start === end, same-day path: current >= start && current < end → always false
    expect(isQuietHours(config, at1000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeSounds
// ---------------------------------------------------------------------------

describe("mergeSounds", () => {
  test("returns defaults for non-object input", () => {
    const result = mergeSounds(null);
    expect(result.idle).toBe("/System/Library/Sounds/Tink.aiff");
    expect(result.permission).toBe("/System/Library/Sounds/Glass.aiff");
    expect(result.question).toBe("/System/Library/Sounds/Glass.aiff");
    expect(result.error).toBe("/System/Library/Sounds/Basso.aiff");
  });

  test("returns defaults for undefined", () => {
    const result = mergeSounds(undefined);
    expect(result.idle).toBe("/System/Library/Sounds/Tink.aiff");
  });

  test("returns defaults for string input", () => {
    const result = mergeSounds("not-an-object");
    expect(result.idle).toBe("/System/Library/Sounds/Tink.aiff");
  });

  test("merges valid sound overrides", () => {
    const result = mergeSounds({ idle: "/custom/sound.aiff", error: "" });
    expect(result.idle).toBe("/custom/sound.aiff");
    expect(result.error).toBe("");
    // Non-overridden fields keep defaults
    expect(result.permission).toBe("/System/Library/Sounds/Glass.aiff");
    expect(result.question).toBe("/System/Library/Sounds/Glass.aiff");
  });

  test("ignores non-string values for sound fields", () => {
    const result = mergeSounds({ idle: 42, permission: true, question: null });
    expect(result.idle).toBe("/System/Library/Sounds/Tink.aiff");
    expect(result.permission).toBe("/System/Library/Sounds/Glass.aiff");
    expect(result.question).toBe("/System/Library/Sounds/Glass.aiff");
  });
});

// ---------------------------------------------------------------------------
// mergeQuietHours
// ---------------------------------------------------------------------------

describe("mergeQuietHours", () => {
  test("returns defaults for non-object input", () => {
    const result = mergeQuietHours(null);
    expect(result.enabled).toBe(false);
    expect(result.start).toBe("22:00");
    expect(result.end).toBe("08:00");
  });

  test("merges valid overrides", () => {
    const result = mergeQuietHours({ enabled: true, start: "23:00" });
    expect(result.enabled).toBe(true);
    expect(result.start).toBe("23:00");
    expect(result.end).toBe("08:00"); // default preserved
  });

  test("ignores non-boolean enabled", () => {
    const result = mergeQuietHours({ enabled: "yes" });
    expect(result.enabled).toBe(false);
  });

  test("ignores non-string time values", () => {
    const result = mergeQuietHours({ start: 22, end: 8 });
    expect(result.start).toBe("22:00");
    expect(result.end).toBe("08:00");
  });
});

// ---------------------------------------------------------------------------
// resolveSoundCommand
// ---------------------------------------------------------------------------

describe("resolveSoundCommand", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env["OPENCODE_ALERT_SOUND_CMD"];
    delete process.env["OPENCODE_ALERT_SOUND_CMD"];
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env["OPENCODE_ALERT_SOUND_CMD"] = savedEnv;
    } else {
      delete process.env["OPENCODE_ALERT_SOUND_CMD"];
    }
  });

  test("returns string value from config when valid", () => {
    expect(resolveSoundCommand("play-sound")).toBe("play-sound");
  });

  test("trims whitespace from config value", () => {
    expect(resolveSoundCommand("  play-sound  ")).toBe("play-sound");
  });

  test("returns null for empty string config", () => {
    expect(resolveSoundCommand("")).toBe(null);
  });

  test("returns null for whitespace-only string config", () => {
    expect(resolveSoundCommand("   ")).toBe(null);
  });

  test("returns null for non-string config", () => {
    expect(resolveSoundCommand(42)).toBe(null);
    expect(resolveSoundCommand(null)).toBe(null);
    expect(resolveSoundCommand(undefined)).toBe(null);
  });

  test("falls back to env var when config is not a valid string", () => {
    process.env["OPENCODE_ALERT_SOUND_CMD"] = "env-sound-cmd";
    expect(resolveSoundCommand(null)).toBe("env-sound-cmd");
    expect(resolveSoundCommand(undefined)).toBe("env-sound-cmd");
    expect(resolveSoundCommand(42)).toBe("env-sound-cmd");
  });

  test("config takes precedence over env var", () => {
    process.env["OPENCODE_ALERT_SOUND_CMD"] = "env-sound-cmd";
    expect(resolveSoundCommand("config-sound-cmd")).toBe("config-sound-cmd");
  });

  test("trims env var value", () => {
    process.env["OPENCODE_ALERT_SOUND_CMD"] = "  env-cmd  ";
    expect(resolveSoundCommand(null)).toBe("env-cmd");
  });

  test("returns null when env var is empty", () => {
    process.env["OPENCODE_ALERT_SOUND_CMD"] = "";
    expect(resolveSoundCommand(null)).toBe(null);
  });
});
