import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import {
  sanitizeOSC,
  formatOSC777,
  formatOSC9,
  formatOSC99,
  escapePowerShell,
  windowsToastScript,
  wrapForTmux,
} from "../src/notify.js";

// ---------------------------------------------------------------------------
// sanitizeOSC
// ---------------------------------------------------------------------------

describe("sanitizeOSC", () => {
  test("passes through normal text unchanged", () => {
    expect(sanitizeOSC("Hello, World!")).toBe("Hello, World!");
  });

  test("passes through unicode text", () => {
    expect(sanitizeOSC("通知 — Benachrichtigung")).toBe("通知 — Benachrichtigung");
  });

  test("replaces C0 control characters (0x00-0x1F)", () => {
    expect(sanitizeOSC("hello\x00world")).toBe("hello world");
    expect(sanitizeOSC("line\nbreak")).toBe("line break");
    expect(sanitizeOSC("tab\there")).toBe("tab here");
    expect(sanitizeOSC("esc\x1bseq")).toBe("esc seq");
  });

  test("replaces DEL (0x7F)", () => {
    expect(sanitizeOSC("delete\x7fchar")).toBe("delete char");
  });

  test("replaces C1 control characters (0x80-0x9F)", () => {
    // 0x9C is ST (String Terminator) — could break OSC in 8-bit mode
    expect(sanitizeOSC("before\x9Cafter")).toBe("before after");
    // 0x90 is DCS
    expect(sanitizeOSC("before\x90after")).toBe("before after");
  });

  test("handles empty string", () => {
    expect(sanitizeOSC("")).toBe("");
  });

  test("replaces multiple control characters", () => {
    expect(sanitizeOSC("\x01\x02\x03")).toBe("   ");
  });

  test("preserves printable ASCII and high Unicode", () => {
    // Printable ASCII: 0x20-0x7E
    expect(sanitizeOSC(" ~")).toBe(" ~");
    // High Unicode (above 0x9F) should pass through
    expect(sanitizeOSC("\u00A0")).toBe("\u00A0"); // NBSP
    expect(sanitizeOSC("café")).toBe("café");
  });
});

// ---------------------------------------------------------------------------
// formatOSC777
// ---------------------------------------------------------------------------

describe("formatOSC777", () => {
  test("formats title and body into OSC 777 sequence", () => {
    const result = formatOSC777("Title", "Body text");
    expect(result).toBe("\x1b]777;notify;Title;Body text\x07");
  });

  test("handles empty strings", () => {
    const result = formatOSC777("", "");
    expect(result).toBe("\x1b]777;notify;;\x07");
  });
});

// ---------------------------------------------------------------------------
// formatOSC9
// ---------------------------------------------------------------------------

describe("formatOSC9", () => {
  test("formats message into OSC 9 sequence", () => {
    const result = formatOSC9("Title: Body text");
    expect(result).toBe("\x1b]9;Title: Body text\x07");
  });

  test("handles empty string", () => {
    const result = formatOSC9("");
    expect(result).toBe("\x1b]9;\x07");
  });
});

// ---------------------------------------------------------------------------
// formatOSC99
// ---------------------------------------------------------------------------

describe("formatOSC99", () => {
  test("formats title and body into two-part OSC 99 sequence", () => {
    const result = formatOSC99("Title", "Body");
    // Verify structure: two parts with matching ids
    expect(result).toContain(":d=0;Title\x1b\\");
    expect(result).toContain(":p=body;Body\x1b\\");
  });

  test("uses monotonically increasing IDs", () => {
    const result1 = formatOSC99("A", "B");
    const result2 = formatOSC99("C", "D");

    // Extract IDs using regex
    const id1Match = result1.match(/i=(\d+)/);
    const id2Match = result2.match(/i=(\d+)/);
    expect(id1Match).not.toBeNull();
    expect(id2Match).not.toBeNull();

    const id1 = parseInt(id1Match![1]!, 10);
    const id2 = parseInt(id2Match![1]!, 10);
    expect(id2).toBeGreaterThan(id1);
  });

  test("each call uses the same ID for both parts", () => {
    const result = formatOSC99("Title", "Body");
    const ids = [...result.matchAll(/i=(\d+)/g)].map((m) => m[1]);
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(ids[1]);
  });
});

// ---------------------------------------------------------------------------
// escapePowerShell
// ---------------------------------------------------------------------------

describe("escapePowerShell", () => {
  test("doubles single quotes", () => {
    expect(escapePowerShell("it's")).toBe("it''s");
  });

  test("handles multiple single quotes", () => {
    expect(escapePowerShell("it's a 'test'")).toBe("it''s a ''test''");
  });

  test("passes through strings without single quotes", () => {
    expect(escapePowerShell("no quotes here")).toBe("no quotes here");
  });

  test("handles empty string", () => {
    expect(escapePowerShell("")).toBe("");
  });

  test("handles string of only single quotes", () => {
    expect(escapePowerShell("'''")).toBe("''''''");
  });
});

// ---------------------------------------------------------------------------
// windowsToastScript
// ---------------------------------------------------------------------------

describe("windowsToastScript", () => {
  test("produces PowerShell script with escaped title and body", () => {
    const script = windowsToastScript("My App", "Hello World");
    expect(script).toContain("My App");
    expect(script).toContain("Hello World");
    expect(script).toContain("ToastNotificationManager");
    expect(script).toContain("ToastText01");
  });

  test("escapes single quotes in title and body", () => {
    const script = windowsToastScript("It's", "a 'test'");
    expect(script).toContain("It''s");
    expect(script).toContain("a ''test''");
    // Should NOT contain unescaped single quotes within the text values
  });

  test("produces semicolon-separated PowerShell statements", () => {
    const script = windowsToastScript("Title", "Body");
    const parts = script.split("; ");
    expect(parts.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// wrapForTmux
// ---------------------------------------------------------------------------

describe("wrapForTmux", () => {
  let savedTmux: string | undefined;

  beforeEach(() => {
    savedTmux = process.env["TMUX"];
  });

  afterEach(() => {
    if (savedTmux !== undefined) {
      process.env["TMUX"] = savedTmux;
    } else {
      delete process.env["TMUX"];
    }
  });

  test("returns sequence unchanged when not in tmux", () => {
    delete process.env["TMUX"];
    const seq = "\x1b]777;notify;Title;Body\x07";
    expect(wrapForTmux(seq)).toBe(seq);
  });

  test("wraps in DCS passthrough when in tmux", () => {
    process.env["TMUX"] = "/tmp/tmux-1000/default,12345,0";
    const seq = "\x1b]777;notify;Title;Body\x07";
    const wrapped = wrapForTmux(seq);

    // Should start with DCS tmux; prefix
    expect(wrapped.startsWith("\x1bPtmux;")).toBe(true);
    // Should end with ST
    expect(wrapped.endsWith("\x1b\\")).toBe(true);
  });

  test("doubles ESC bytes inside tmux wrapper", () => {
    process.env["TMUX"] = "/tmp/tmux-1000/default,12345,0";
    const seq = "\x1b]777;notify;Title;Body\x07";
    const wrapped = wrapForTmux(seq);

    // The original ESC (\x1b) before ]777 should be doubled to \x1b\x1b
    expect(wrapped).toContain("\x1b\x1b]777");
  });

  test("returns sequence unchanged when TMUX is empty string", () => {
    process.env["TMUX"] = "";
    const seq = "\x1b]777;notify;Title;Body\x07";
    expect(wrapForTmux(seq)).toBe(seq);
  });

  test("handles sequence with no ESC bytes", () => {
    process.env["TMUX"] = "/tmp/tmux-1000/default,12345,0";
    const seq = "no-escape-bytes";
    const wrapped = wrapForTmux(seq);
    expect(wrapped).toBe("\x1bPtmux;no-escape-bytes\x1b\\");
  });
});
