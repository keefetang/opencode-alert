import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import { detectTerminal } from "../src/terminal.js";

// ---------------------------------------------------------------------------
// Env var save/restore helper
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "TERM_PROGRAM",
  "LC_TERMINAL",
  "KITTY_WINDOW_ID",
  "TERM",
  "WT_SESSION",
] as const;

type EnvSnapshot = Record<string, string | undefined>;

let savedEnv: EnvSnapshot;

function saveEnv(): void {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
}

function clearTerminalEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

// ---------------------------------------------------------------------------
// detectTerminal
// ---------------------------------------------------------------------------

describe("detectTerminal", () => {
  beforeEach(() => {
    saveEnv();
    clearTerminalEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  // -- Config override ---------------------------------------------------

  describe("config override", () => {
    test("returns matching terminal for valid override", () => {
      const result = detectTerminal("ghostty");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Ghostty");
    });

    test("normalizes override to lowercase kebab-case", () => {
      const result = detectTerminal("Apple Terminal");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Terminal");
    });

    test("returns null for unknown override", () => {
      const result = detectTerminal("unknown-terminal");
      expect(result).toBeNull();
    });

    test("override takes precedence over env vars", () => {
      process.env["TERM_PROGRAM"] = "iTerm.app";
      const result = detectTerminal("ghostty");
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Ghostty");
    });
  });

  // -- TERM_PROGRAM detection --------------------------------------------

  describe("TERM_PROGRAM detection", () => {
    test("detects Ghostty", () => {
      process.env["TERM_PROGRAM"] = "ghostty";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Ghostty");
      expect(result!.bundleId).toBe("com.mitchellh.ghostty");
    });

    test("detects iTerm2", () => {
      process.env["TERM_PROGRAM"] = "iTerm.app";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("iTerm2");
    });

    test("detects WezTerm", () => {
      process.env["TERM_PROGRAM"] = "WezTerm";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("WezTerm");
    });

    test("detects Apple Terminal", () => {
      process.env["TERM_PROGRAM"] = "Apple_Terminal";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Terminal");
      expect(result!.protocol).toBeNull(); // Apple Terminal has no OSC support
    });

    test("detects Hyper", () => {
      process.env["TERM_PROGRAM"] = "Hyper";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Hyper");
    });
  });

  // -- LC_TERMINAL detection ---------------------------------------------

  describe("LC_TERMINAL detection", () => {
    test("detects iTerm2 via LC_TERMINAL", () => {
      process.env["LC_TERMINAL"] = "iTerm2";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("iTerm2");
    });
  });

  // -- Special env var detection -----------------------------------------

  describe("special env var detection", () => {
    test("detects Kitty via KITTY_WINDOW_ID", () => {
      process.env["KITTY_WINDOW_ID"] = "12345";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Kitty");
      expect(result!.protocol).toBe("osc99");
    });

    test("detects Alacritty via TERM", () => {
      process.env["TERM"] = "alacritty";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Alacritty");
    });

    test("detects Windows Terminal via WT_SESSION", () => {
      process.env["WT_SESSION"] = "some-session-id";
      const result = detectTerminal();
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Windows Terminal");
      expect(result!.protocol).toBe("windows-toast");
    });
  });

  // -- No detection ------------------------------------------------------

  describe("no detection", () => {
    test("returns null when no terminal env vars are set", () => {
      const result = detectTerminal();
      expect(result).toBeNull();
    });

    test("returns null for unrecognized TERM_PROGRAM", () => {
      process.env["TERM_PROGRAM"] = "MyCustomTerminal";
      const result = detectTerminal();
      expect(result).toBeNull();
    });
  });

  // -- Priority ----------------------------------------------------------

  describe("detection priority", () => {
    test("TERM_PROGRAM takes precedence over KITTY_WINDOW_ID", () => {
      process.env["TERM_PROGRAM"] = "ghostty";
      process.env["KITTY_WINDOW_ID"] = "12345";
      const result = detectTerminal();
      expect(result!.name).toBe("Ghostty");
    });

    test("KITTY_WINDOW_ID takes precedence over TERM", () => {
      process.env["KITTY_WINDOW_ID"] = "12345";
      process.env["TERM"] = "alacritty";
      const result = detectTerminal();
      expect(result!.name).toBe("Kitty");
    });
  });

  // -- TerminalInfo shape ------------------------------------------------

  describe("TerminalInfo shape", () => {
    test("all known terminals have required fields", () => {
      const terminals = [
        "ghostty", "iterm2", "wezterm", "apple-terminal",
        "kitty", "alacritty", "hyper", "windows-terminal",
      ];
      for (const key of terminals) {
        const info = detectTerminal(key);
        expect(info).not.toBeNull();
        expect(typeof info!.name).toBe("string");
        expect(info!.name.length).toBeGreaterThan(0);
        // bundleId and processName can be null
        expect(info!.bundleId === null || typeof info!.bundleId === "string").toBe(true);
        expect(info!.processName === null || typeof info!.processName === "string").toBe(true);
      }
    });
  });
});
