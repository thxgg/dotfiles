import { estimateTokens, sessionEntryToContextMessages, type ExtensionAPI, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { loadState, persistEnabled, type RuntimeState } from "./config.ts";
import {
  buildDetails,
  EXTENSION_VERSION,
  summarize,
  SUMMARIZER_MODEL,
  SUMMARIZER_PROVIDER,
  SUMMARIZER_THINKING,
} from "./summarize.ts";

const STATUS_KEY = "experimental-compaction";

type LastOutcome = {
  status: "experimental" | "native-fallback";
  reason: "manual" | "threshold" | "overflow";
  at: string;
  durationMs?: number;
  error?: string;
};

function setFooter(ctx: ExtensionContext, enabled: boolean, running = false): void {
  try {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, enabled ? `compact: ${running ? "running" : "experimental"}` : undefined);
  } catch {
    // A session replacement can stale a UI context while an async hook settles.
    // Footer rendering must never affect compaction or native fallback.
  }
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error"): void {
  try {
    if (!ctx.hasUI) return;
    ctx.ui.notify(message, level);
  } catch {
    // Notifications are diagnostics only and must not affect compaction.
  }
}

export function fileLists(fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> }): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modified = new Set([...fileOps.written, ...fileOps.edited]);
  return {
    readFiles: [...fileOps.read].filter((file) => !modified.has(file)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}

export function retainedEntryCount(branchEntries: Array<{ id?: string }>, firstKeptEntryId: string): number {
  const index = branchEntries.findIndex((entry) => entry.id === firstKeptEntryId);
  return index < 0 ? 0 : branchEntries.length - index;
}

export function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
  const sections: string[] = [];
  if (readFiles.length) sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  if (modifiedFiles.length) sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  return sections.length ? `\n\n${sections.join("\n\n")}` : "";
}

function estimateRetainedTokens(branchEntries: SessionEntry[], firstKeptEntryId: string): number {
  const index = branchEntries.findIndex((entry) => entry.id === firstKeptEntryId);
  if (index < 0) return 0;
  return branchEntries
    .slice(index)
    .flatMap(sessionEntryToContextMessages)
    .reduce((tokens, message) => tokens + estimateTokens(message), 0);
}

export default function experimentalCompaction(pi: ExtensionAPI): void {
  let state: RuntimeState = { enabled: false };
  let loaded = false;
  let lastOutcome: LastOutcome | undefined;

  pi.on("session_start", async (_event, ctx) => {
    state = await loadState();
    loaded = true;
    setFooter(ctx, state.enabled);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    setFooter(ctx, false);
  });

  pi.registerCommand("experimental-compaction", {
    description: "Enable, disable, or inspect experimental intent-aware compaction",
    getArgumentCompletions(prefix) {
      return ["on", "off", "status"]
        .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      if (!loaded) {
        state = await loadState();
        loaded = true;
      }
      const action = args.trim().toLowerCase() || "status";
      if (action === "on" || action === "off") {
        state = await persistEnabled(action === "on");
        setFooter(ctx, state.enabled);
        notify(
          ctx,
          state.enabled
            ? `Experimental compaction enabled (${SUMMARIZER_PROVIDER}/${SUMMARIZER_MODEL}, thinking ${SUMMARIZER_THINKING}).`
            : "Experimental compaction disabled; Pi will use native compaction.",
          "info",
        );
        return;
      }
      if (action !== "status") {
        notify(ctx, "Usage: /experimental-compaction on|off|status", "warning");
        return;
      }
      const lines = [
        `Experimental compaction: ${state.enabled ? "enabled" : "disabled"}`,
        `Strategy version: ${EXTENSION_VERSION}`,
        `Summarizer: ${SUMMARIZER_PROVIDER}/${SUMMARIZER_MODEL} (thinking ${SUMMARIZER_THINKING})`,
        lastOutcome
          ? `Last attempt: ${lastOutcome.status}, reason=${lastOutcome.reason}, at=${lastOutcome.at}${lastOutcome.durationMs ? `, ${lastOutcome.durationMs}ms` : ""}${lastOutcome.error ? `, error=${lastOutcome.error}` : ""}`
          : "Last attempt: none",
      ];
      notify(ctx, lines.join("\n"), "info");
    },
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!state.enabled) return;
    const startedAt = Date.now();
    setFooter(ctx, true, true);
    const preparation = event.preparation;
    const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];

    try {
      const result = await summarize({
        ctx,
        messagesToSummarize: preparation.messagesToSummarize,
        turnPrefixMessages: preparation.turnPrefixMessages,
        previousSummary: preparation.previousSummary,
        customInstructions: event.customInstructions,
        signal: event.signal,
      });
      const durationMs = Date.now() - startedAt;
      const files = fileLists(preparation.fileOps);
      const summary = result.summary + formatFileOperations(files.readFiles, files.modifiedFiles);
      lastOutcome = {
        status: "experimental",
        reason: event.reason,
        at: new Date().toISOString(),
        durationMs,
      };
      return {
        compaction: {
          summary,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          estimatedTokensAfter: Math.ceil(summary.length / 4) + estimateRetainedTokens(event.branchEntries, preparation.firstKeptEntryId),
          details: buildDetails({
            reason: event.reason,
            durationMs,
            summarizedMessages: messages.length,
            retainedMessages: retainedEntryCount(event.branchEntries, preparation.firstKeptEntryId),
            retainedTokensTarget: preparation.settings.keepRecentTokens,
            previousSummary: Boolean(preparation.previousSummary),
            retries: result.retries,
            model: result.model,
            thinking: result.thinking,
            usage: result.usage,
            ...files,
          }),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastOutcome = {
        status: "native-fallback",
        reason: event.reason,
        at: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: message,
      };
      if (!event.signal.aborted) {
        notify(ctx, `Experimental compaction failed; using native Pi compaction: ${message}`, "warning");
      }
      return;
    } finally {
      setFooter(ctx, state.enabled);
    }
  });
}
