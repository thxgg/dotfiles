import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  getMarkdownTheme,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, Text, type Component, type TUI } from "@earendil-works/pi-tui";
import { createChildModelRuntime } from "../subagents/model-runtime.ts";
import { buildParentMessages } from "./context.ts";
import { resolveSideModel } from "./model.ts";
import {
  createActivityTool,
  createProcessTool,
  textFromContent,
  type ActiveOperation,
  type ActivitySnapshot,
} from "./observation.ts";

const MAX_RECENT_OPERATIONS = 5;
const MAX_SIDE_TURNS = 6;
const SYSTEM_APPEND = `You are an ephemeral observational side agent answering a question about the current Pi session.

The parent agent continues independently. Do not describe it as interrupted, and do not alter or signal it.
You may read project files, inspect the parent session's tool activity, and inspect operating-system process state.
You cannot edit files, execute arbitrary shell commands, use the network, or change processes or external systems.
Use tools only when they help answer the question. Give one direct answer once you have enough evidence.
If the available conversation and observations do not establish the answer, say what remains unknown.`;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function operationId(event: { toolCallId?: unknown; toolName?: unknown }): string {
  return String(event.toolCallId ?? `${String(event.toolName ?? "tool")}-${Date.now()}`);
}

function finalAssistantResult(session: AgentSession): { text: string; error?: string } {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (message?.role !== "assistant") continue;
    const text = textFromContent(message.content).trim();
    if (text) return { text };
    if (message.errorMessage) return { text: "", error: message.errorMessage };
    if (message.stopReason === "error") return { text: "", error: "The side model request failed." };
  }
  return { text: "" };
}

async function createSideSession(question: string, ctx: ExtensionCommandContext, getActivity: () => ActivitySnapshot) {
  if (!ctx.model) throw new Error("No model selected.");
  const sideModel = resolveSideModel(ctx.model);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });
  const loader = new DefaultResourceLoader({
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: `${ctx.getSystemPrompt()}\n\n${SYSTEM_APPEND}`,
    extensionFactories: [{
      name: "btw-model-alias",
      factory: (pi) => {
        pi.on("before_provider_request", (event) => sideModel.rewritePayload(event.payload));
      },
    }],
  });
  await loader.reload();

  const modelRuntime = await createChildModelRuntime(ctx.modelRegistry);
  const { session } = await createAgentSession({
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
    model: sideModel.model,
    modelRuntime,
    thinkingLevel: "off",
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(ctx.cwd),
    tools: ["read", "get_main_thread_activity", "inspect_processes"],
    customTools: [createActivityTool(getActivity), createProcessTool()],
  });

  session.agent.state.messages = buildParentMessages(ctx.sessionManager.buildContextEntries());
  let turns = 0;
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "turn_end") return;
    turns += 1;
    if (turns >= MAX_SIDE_TURNS) void session.abort();
  });

  return {
    session,
    run: () => session.prompt(question),
    dispose: () => {
      unsubscribe();
      session.dispose();
    },
  };
}

class BtwOverlay implements Component {
  private answer = "";
  private error = "";
  private status = "Answering…";
  private scrollOffset = 0;
  private disposed = false;
  private sideSession?: Awaited<ReturnType<typeof createSideSession>>;

  constructor(
    private readonly question: string,
    private readonly tui: TUI,
    private readonly theme: ExtensionCommandContext["ui"]["theme"],
    private readonly ctx: ExtensionCommandContext,
    private readonly getActivity: () => ActivitySnapshot,
    private readonly done: (value: undefined) => void,
  ) {
    void this.start();
  }

  private async start(): Promise<void> {
    try {
      this.sideSession = await createSideSession(this.question, this.ctx, this.getActivity);
      const unsubscribe = this.sideSession.session.subscribe((event) => {
        if (event.type !== "message_update" || event.message.role !== "assistant") return;
        const text = textFromContent(event.message.content).trim();
        if (text) {
          this.answer = text;
          this.status = "";
          this.tui.requestRender();
        }
      });
      try {
        await this.sideSession.run();
        if (!this.answer) {
          const result = finalAssistantResult(this.sideSession.session);
          this.answer = result.text;
          if (result.error) this.error = result.error;
        }
        if (!this.answer && !this.error) this.error = "No response received.";
      } finally {
        unsubscribe();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.status = "";
      this.sideSession?.dispose();
      this.sideSession = undefined;
      if (!this.disposed) this.tui.requestRender();
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || matchesKey(data, Key.space) || matchesKey(data, Key.ctrl("c"))) {
      this.close();
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl("p"))) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 3);
      this.tui.requestRender();
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl("n"))) {
      this.scrollOffset += 3;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const panelWidth = Math.max(20, width);
    const contentWidth = Math.max(16, panelWidth - 4);
    const border = this.theme.fg("borderAccent", "─".repeat(panelWidth));
    const label = this.theme.fg("accent", this.theme.bold("btw"));
    const title = new Text(`${label} ${this.theme.fg("muted", "·")} ${this.theme.fg("text", this.question)}`, 2, 0);
    const bodyText = this.error ? this.theme.fg("error", this.error) : this.answer || this.theme.fg("warning", this.status);
    const body = this.answer && !this.error
      ? new Markdown(bodyText, 2, 0, getMarkdownTheme())
      : new Text(bodyText, 2, 0);
    const bodyLines = body.render(panelWidth);
    // Keep the panel compact so the parent transcript remains visible. Longer
    // answers scroll inside this editor-replacement region.
    const maxBodyLines = Math.max(4, Math.min(12, this.tui.terminal.rows - 12));
    const maxOffset = Math.max(0, bodyLines.length - maxBodyLines);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    const position = bodyLines.length > maxBodyLines
      ? ` · ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + maxBodyLines, bodyLines.length)}/${bodyLines.length}`
      : "";
    const help = new Text(
      this.theme.fg("dim", `↑/↓ scroll${position}  ·  Space/Enter close  ·  Esc cancel`),
      2,
      0,
    );

    return [
      border,
      ...title.render(panelWidth),
      "",
      ...bodyLines.slice(this.scrollOffset, this.scrollOffset + maxBodyLines),
      "",
      ...help.render(panelWidth),
      border,
    ];
  }

  invalidate(): void {}

  dispose(): void {
    this.disposed = true;
    // Abort the side run, but let its own finally block dispose the session
    // after prompt processing has unwound.
    void this.sideSession?.session.abort();
  }

  private close(): void {
    this.dispose();
    this.done(undefined);
  }
}

export default function btwExtension(pi: ExtensionAPI): void {
  const active = new Map<string, ActiveOperation>();
  const recent: ActiveOperation[] = [];

  const snapshot = (): ActivitySnapshot => ({
    active: [...active.values()].map((operation) => ({ ...operation, args: { ...operation.args } })),
    recent: recent.map((operation) => ({ ...operation, args: { ...operation.args } })),
  });

  pi.on("tool_execution_start", (event) => {
    const id = operationId(event);
    active.set(id, {
      toolCallId: id,
      toolName: String(event.toolName),
      args: asRecord(event.args),
      startedAt: Date.now(),
    });
  });

  pi.on("tool_execution_update", (event) => {
    const operation = active.get(operationId(event));
    if (!operation) return;
    const output = textFromContent(asRecord(event.partialResult).content);
    if (output) operation.latestOutput = output;
  });

  pi.on("tool_execution_end", (event) => {
    const id = operationId(event);
    const operation = active.get(id);
    if (!operation) return;
    const output = textFromContent(asRecord(event.result).content);
    if (output) operation.latestOutput = output;
    active.delete(id);
    recent.unshift(operation);
    recent.splice(MAX_RECENT_OPERATIONS);
  });

  pi.on("session_start", () => {
    active.clear();
    recent.splice(0);
  });

  pi.registerCommand("btw", {
    description: "Ask an observational side question without interrupting the main agent",
    handler: async (args, ctx) => {
      const question = args.trim();
      if (!question) {
        ctx.ui.notify("Usage: /btw <question>", "warning");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/btw requires interactive mode", "error");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      await ctx.ui.custom<undefined>(
        (tui, theme, _keybindings, done) => new BtwOverlay(question, tui, theme, ctx, snapshot, done),
      );
    },
  });
}
