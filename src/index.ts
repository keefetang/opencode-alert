import type { Hooks, Plugin } from "@opencode-ai/plugin";

import { loadConfig, isQuietHours } from "./config.js";
import type { NotifyConfig } from "./config.js";
import { detectTerminal, isTerminalFocused } from "./terminal.js";
import type { TerminalInfo } from "./terminal.js";
import { notify } from "./notify.js";
import type { NotifyOptions } from "./notify.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Client = Parameters<Plugin>[0]["client"];
type EventHandler = NonNullable<Hooks["event"]>;

// ---------------------------------------------------------------------------
// Debounce — suppress idle notifications when a specific event just fired
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 3_000;
const MAX_CACHE_SIZE = 200;
const recentSpecific = new Map<string, number>();

function markSpecific(sessionID: string): void {
  recentSpecific.set(sessionID, Date.now());
  // Sweep stale entries when map grows large
  if (recentSpecific.size > MAX_CACHE_SIZE) {
    const cutoff = Date.now() - DEBOUNCE_MS;
    for (const [key, ts] of recentSpecific) {
      if (ts < cutoff) recentSpecific.delete(key);
    }
  }
}

function hadRecentSpecific(sessionID: string): boolean {
  const ts = recentSpecific.get(sessionID);
  if (!ts) return false;
  if (Date.now() - ts < DEBOUNCE_MS) return true;
  recentSpecific.delete(sessionID);
  return false;
}

// ---------------------------------------------------------------------------
// Session title cache
// ---------------------------------------------------------------------------

interface SessionInfo {
  title: string;
  isChild: boolean;
}

const titleCache = new Map<string, SessionInfo>();

async function sessionTitle(
  client: Client,
  directory: string,
  sessionID: string | undefined,
): Promise<SessionInfo> {
  if (!sessionID) return { title: "Unknown", isChild: false };
  const cached = titleCache.get(sessionID);
  if (cached) return cached;

  try {
    const res = await client.session.get({ path: { id: sessionID }, query: { directory } });
    // SDK client return type is generic — cast to access session fields
    const data = res.data as { title?: string; parentID?: string } | undefined;
    const info: SessionInfo = {
      title: data?.title || sessionID.slice(0, 8),
      isChild: !!data?.parentID,
    };
    titleCache.set(sessionID, info);
    // Evict oldest entries when cache grows too large
    if (titleCache.size > MAX_CACHE_SIZE) {
      const first = titleCache.keys().next().value;
      if (first !== undefined) titleCache.delete(first);
    }
    return info;
  } catch {
    return { title: sessionID.slice(0, 8), isChild: false };
  }
}

// ---------------------------------------------------------------------------
// Guard — should we send a notification?
// Focus state is cached briefly to avoid repeated execSync calls on rapid events.
// ---------------------------------------------------------------------------

const FOCUS_CACHE_TTL_MS = 1_500;
let focusCacheResult = false;
let focusCacheTime = 0;

function shouldNotify(config: NotifyConfig, terminal: TerminalInfo | null): boolean {
  if (isQuietHours(config)) return false;
  if (!config.suppressWhenFocused) return true;

  const now = Date.now();
  if (now - focusCacheTime < FOCUS_CACHE_TTL_MS) {
    if (focusCacheResult) return false;
    return true;
  }

  focusCacheResult = isTerminalFocused(terminal);
  focusCacheTime = now;
  if (focusCacheResult) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Persistent alert stacking guard
// ---------------------------------------------------------------------------

let isShowingPersistentAlert = false;

/**
 * Send a notification, guarding against stacked persistent dialogs.
 * Banner notifications (persistent: false) are always sent — they queue naturally.
 * Persistent alerts are gated: only one at a time, with a short cooldown.
 */
function guardedNotify(opts: NotifyOptions): void {
  if (opts.persistent && isShowingPersistentAlert) return;

  notify(opts);

  if (opts.persistent) {
    isShowingPersistentAlert = true;
    setTimeout(() => { isShowingPersistentAlert = false; }, 500);
  }
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

function createEventHandler(client: Client, directory: string, config: NotifyConfig, terminal: TerminalInfo | null): EventHandler {
  return async ({ event }) => {
    // ---- session.idle ----
    if (event.type === "session.idle") {
      if (!config.notifyOnIdle) return;
      const { sessionID } = event.properties;
      if (hadRecentSpecific(sessionID)) return;
      if (!shouldNotify(config, terminal)) return;

      const info = await sessionTitle(client, directory, sessionID);
      if (!config.notifyChildSessions && info.isChild) return;
      guardedNotify({
        title: "OpenCode — Completed",
        subtitle: `Session: ${info.title}`,
        message: "Ready for your input",
        persistent: config.persistentAlerts,
      });
      return;
    }

    // ---- permission.updated ----
    if (event.type === "permission.updated") {
      const props = event.properties;
      const sessionID = props.sessionID;
      markSpecific(sessionID);
      if (!shouldNotify(config, terminal)) return;

      const info = await sessionTitle(client, directory, sessionID);
      guardedNotify({
        title: "OpenCode — Permission Needed",
        subtitle: `Session: ${info.title}`,
        message: props.title || "Action requires your approval",
        sound: config.sounds.permission,
        persistent: config.persistentAlerts,
      });
      return;
    }

    // ---- session.error ----
    if (event.type === "session.error") {
      const { sessionID, error } = event.properties;
      if (!sessionID) return;
      markSpecific(sessionID);
      if (!shouldNotify(config, terminal)) return;

      const info = await sessionTitle(client, directory, sessionID);
      const rawMsg = error?.data && "message" in error.data ? error.data.message : undefined;
      const errorMsg = typeof rawMsg === "string" ? rawMsg : (error?.name ?? "An error occurred");
      guardedNotify({
        title: "OpenCode — Error",
        subtitle: `Session: ${info.title}`,
        message: errorMsg,
        sound: config.sounds.error,
        persistent: config.persistentAlerts,
      });
      return;
    }

    // ---- message.updated (detect aborted) ----
    if (event.type === "message.updated") {
      const msg = event.properties.info;
      if (msg.role === "assistant" && msg.error) {
        if (msg.error.name === "MessageAbortedError") {
          markSpecific(msg.sessionID);
          if (!shouldNotify(config, terminal)) return;

          const info = await sessionTitle(client, directory, msg.sessionID);
          guardedNotify({
            title: "OpenCode — Cancelled",
            subtitle: `Session: ${info.title}`,
            message: msg.error.data?.message ?? "Session was interrupted",
            persistent: config.persistentAlerts,
          });
        }
      }
      return;
    }

    // ---- message.part.updated (question tool + subagent completion) ----
    if (event.type === "message.part.updated") {
      const { part } = event.properties;
      if (part.type !== "tool") return;

      // Only act on completed tool calls
      if (part.state.status !== "completed") return;

      if (part.tool === "question") {
        markSpecific(part.sessionID);
        if (!shouldNotify(config, terminal)) return;

        const info = await sessionTitle(client, directory, part.sessionID);
        guardedNotify({
          title: "OpenCode — Question",
          subtitle: `Session: ${info.title}`,
          message: "Needs your answer",
          persistent: config.persistentAlerts,
        });
        return;
      }

      if (part.tool === "task") {
        if (!config.notifyChildSessions) return;
        if (!shouldNotify(config, terminal)) return;

        const info = await sessionTitle(client, directory, part.sessionID);
        const desc =
          (part.state as { input?: { description?: string } }).input?.description ??
          "Subagent task finished";
        guardedNotify({
          title: "OpenCode — Subagent Done",
          subtitle: `Session: ${info.title}`,
          message: desc,
          persistent: config.persistentAlerts,
        });
        return;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export const OpenCodeAlertPlugin: Plugin = async (ctx) => {
  const { client, directory } = ctx;
  const config = loadConfig();

  // Detect terminal once at init — it doesn't change during a session
  const terminal = detectTerminal(config.terminal);

  void client.app.log({
    body: {
      service: "opencode-alert",
      level: "info",
      message: `opencode-alert loaded (dir: ${directory}, terminal: ${terminal?.name ?? "unknown"}, quietHours: ${config.quietHours.enabled}, notifyOnIdle: ${config.notifyOnIdle}, suppressWhenFocused: ${config.suppressWhenFocused}, persistentAlerts: ${config.persistentAlerts})`,
    },
  });

  return {
    event: createEventHandler(client, directory, config, terminal),
  };
};

export default OpenCodeAlertPlugin;
