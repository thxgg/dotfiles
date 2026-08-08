import { CustomEditor, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { matchesKey } from "@earendil-works/pi-tui";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

type Provider = "native" | "openai";
type Config = {
  provider: Provider;
  autoSpeak: boolean;
  rewriteModel: string;
  openaiVoice: string;
  speed: number;
};

type CacheEntry = {
  text: string;
  createdAt: number;
};

type RewriteResult = {
  text: string;
  cached: boolean;
};

const EXTENSION_DIR = join(homedir(), ".pi", "agent", "extensions", "pi-speech");
const CONFIG_PATH = join(EXTENSION_DIR, "config.json");
const CACHE_PATH = join(EXTENSION_DIR, "rewrite-cache.json");
const REWRITE_PROMPT_VERSION = "1";
const MAX_CACHE_ENTRIES = 200;
const OPENAI_VOICES = [
  ["alloy", "Neutral and balanced"],
  ["ash", "Clear and direct"],
  ["ballad", "Warm and expressive"],
  ["coral", "Friendly and conversational"],
  ["echo", "Smooth and measured"],
  ["fable", "Expressive storyteller"],
  ["nova", "Bright and energetic"],
  ["onyx", "Deep and authoritative"],
  ["sage", "Calm and thoughtful"],
  ["shimmer", "Light and polished"],
  ["verse", "Natural and versatile"],
  ["marin", "Natural; OpenAI recommends for quality"],
  ["cedar", "Natural; OpenAI recommends for quality"],
] as const;
const OPENAI_VOICE_NAMES = OPENAI_VOICES.map(([name]) => name);
const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const NATIVE_BASE_RATE = 180;

const DEFAULT_CONFIG: Config = {
  provider: "native",
  autoSpeak: false,
  rewriteModel: "gpt-5.6-luna",
  openaiVoice: "coral",
  speed: 1,
};

const REWRITE_PROMPT = `Rewrite the assistant response as one coherent spoken update for a software developer.

Requirements:
- Preserve the result, important decisions, warnings, verification, blockers, and next action.
- Explain the meaning of important code, commands, paths, tables, and lists instead of reading their syntax.
- Do not concatenate fragments left after removing code or formatting.
- Do not mention Markdown, formatting, citations, or that you rewrote the response.
- Do not invent facts, results, or completed work.
- Use natural transitions and complete sentences.
- Be concise. Target 20 to 45 seconds unless the source requires more detail.
- Return only the words to speak.

Assistant response:
`;

let config: Config = { ...DEFAULT_CONFIG };
let activeProcess: ChildProcess | undefined;
let activeController: AbortController | undefined;
let activeAudioFile: string | undefined;
let rewriteCache: Record<string, CacheEntry> = {};
let speaking = false;
let suppressAutoSpeak = false;

const parseConfig = (value: unknown): Config => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CONFIG };
  const input = value as Partial<Config>;
  return {
    provider: input.provider === "openai" ? "openai" : "native",
    autoSpeak: typeof input.autoSpeak === "boolean" ? input.autoSpeak : false,
    rewriteModel: typeof input.rewriteModel === "string" && input.rewriteModel.trim()
      ? input.rewriteModel.trim()
      : DEFAULT_CONFIG.rewriteModel,
    openaiVoice: typeof input.openaiVoice === "string" && input.openaiVoice.trim()
      ? input.openaiVoice.trim()
      : DEFAULT_CONFIG.openaiVoice,
    speed: typeof input.speed === "number" && input.speed >= 0.25 && input.speed <= 4
      ? input.speed
      : DEFAULT_CONFIG.speed,
  };
};

const loadConfig = async () => {
  config = await readFile(CONFIG_PATH, "utf8")
    .then((text) => parseConfig(JSON.parse(text)))
    .catch(() => ({ ...DEFAULT_CONFIG }));
};

const saveJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
};

const saveConfig = async () => saveJson(CONFIG_PATH, config);

const loadCache = async () => {
  rewriteCache = await readFile(CACHE_PATH, "utf8")
    .then((text) => JSON.parse(text) as Record<string, CacheEntry>)
    .catch(() => ({}));
};

const saveCache = async () => saveJson(CACHE_PATH, rewriteCache);

const cacheKey = (source: string) => createHash("sha256")
  .update(`${REWRITE_PROMPT_VERSION}\0openai/${config.rewriteModel}\0${source}`)
  .digest("hex");

const putCache = async (key: string, text: string) => {
  rewriteCache[key] = { text, createdAt: Date.now() };
  const entries = Object.entries(rewriteCache);
  if (entries.length > MAX_CACHE_ENTRIES) {
    entries
      .sort(([, left], [, right]) => right.createdAt - left.createdAt)
      .slice(MAX_CACHE_ENTRIES)
      .forEach(([oldKey]) => delete rewriteCache[oldKey]);
  }
  await saveCache();
};

const assistantText = (message: AssistantMessage) =>
  message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

const latestAssistantMessage = (ctx: ExtensionContext | ExtensionCommandContext) => {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    if (assistantText(entry.message)) return entry.message;
  }
};

const latestAssistantText = (ctx: ExtensionContext | ExtensionCommandContext) => {
  const message = latestAssistantMessage(ctx);
  return message ? assistantText(message) : "";
};

const notify = (ctx: ExtensionContext | ExtensionCommandContext, message: string, level: "info" | "warning" | "error" = "info") => {
  if (ctx.hasUI) ctx.ui.notify(message, level);
};

const idleStatus = () => `speech: ${config.provider} · ${config.autoSpeak ? "auto" : "manual"} · ${config.speed}x`;

const setStatus = (ctx: ExtensionContext | ExtensionCommandContext, value = idleStatus()) => {
  if (ctx.hasUI) ctx.ui.setStatus("pi-speech", value);
};

const cleanupAudio = async () => {
  const file = activeAudioFile;
  activeAudioFile = undefined;
  if (file) await unlink(file).catch(() => undefined);
};

const stopSpeech = async (
  ctx?: ExtensionContext | ExtensionCommandContext,
  announce = true,
  suppressAutomaticPlayback = true,
) => {
  if (suppressAutomaticPlayback) suppressAutoSpeak = true;
  activeController?.abort();
  activeController = undefined;
  if (activeProcess && !activeProcess.killed) activeProcess.kill("SIGTERM");
  activeProcess = undefined;
  speaking = false;
  await cleanupAudio();
  if (ctx) {
    setStatus(ctx);
    if (announce) notify(ctx, "Speech stopped");
  }
};

const interruptForInput = (ctx: ExtensionContext | ExtensionCommandContext) => {
  if (!speaking && !activeController && !activeProcess) return;
  void stopSpeech(ctx, false, true);
};

const isEditingInput = (data: string) => {
  if (matchesKey(data, "backspace") || matchesKey(data, "delete") || matchesKey(data, "enter")) return true;
  if (matchesKey(data, "ctrl+v") || matchesKey(data, "alt+v") || matchesKey(data, "escape")) return true;
  if (matchesKey(data, "tab")) return false;
  if (data.startsWith("\x1b[200~")) return true;
  return [...data].some((character) => character >= " " && character !== "\x7f");
};

const runProcess = (command: string, args: string[], input?: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "ignore", "pipe"] });
    activeProcess = child;
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (activeProcess === child) activeProcess = undefined;
      if (code === 0 || signal === "SIGTERM") resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    if (input !== undefined) child.stdin?.end(input);
  });

const rewriteForSpeech = async (source: string, ctx: ExtensionContext | ExtensionCommandContext): Promise<RewriteResult> => {
  const key = cacheKey(source);
  const cached = rewriteCache[key]?.text?.trim();
  if (cached) return { text: cached, cached: true };

  const model = ctx.modelRegistry.find("openai", config.rewriteModel);
  if (!model) throw new Error(`Rewrite model openai/${config.rewriteModel} is not available`);
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`No authentication is configured for openai/${config.rewriteModel}`);
  }

  const response = await ctx.modelRegistry.complete(
    model,
    {
      messages: [{
        role: "user",
        content: [{ type: "text", text: `${REWRITE_PROMPT}${source}` }],
        timestamp: Date.now(),
      }],
    },
    {
      signal: activeController?.signal,
      reasoningEffort: "none",
      cacheRetention: "none",
      sessionId: randomUUID(),
    },
  );

  if (response.stopReason === "aborted") throw new Error("Speech rewrite was cancelled");
  if (response.stopReason === "error") throw new Error(response.errorMessage || "Speech rewrite failed");

  const spoken = assistantText(response).trim();
  if (!spoken) throw new Error("The speech rewrite was empty");
  await putCache(key, spoken);
  return { text: spoken, cached: false };
};

const synthesizeOpenAI = async (text: string, ctx: ExtensionContext | ExtensionCommandContext) => {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(
    ctx.modelRegistry.find("openai", config.rewriteModel)!,
  );
  if (!auth.ok || !auth.apiKey) throw new Error(auth.ok ? "No OpenAI API key is configured" : auth.error);

  const baseUrl = (auth.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    signal: activeController?.signal,
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      "Content-Type": "application/json",
      ...(auth.headers || {}),
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: config.openaiVoice,
      input: text,
      response_format: "mp3",
      speed: config.speed,
      instructions: "Speak clearly and naturally as a concise technical collaborator.",
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI speech failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const file = join(tmpdir(), `pi-speech-${randomUUID()}.mp3`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  activeAudioFile = file;
  await runProcess("afplay", [file]);
};

const speakLatest = async (ctx: ExtensionContext | ExtensionCommandContext) => {
  if (speaking) await stopSpeech(ctx, false, false);
  suppressAutoSpeak = false;
  const source = latestAssistantText(ctx);
  if (!source) {
    notify(ctx, "No assistant response is available", "warning");
    return;
  }

  speaking = true;
  const controller = new AbortController();
  activeController = controller;
  setStatus(ctx, `speech: rewriting · ${config.rewriteModel}`);
  try {
    const rewrite = await rewriteForSpeech(source, ctx);
    setStatus(ctx, `speech: playing · ${config.provider} · ${config.speed}x${rewrite.cached ? " · cached" : ""}`);
    if (config.provider === "native") {
      await runProcess("say", ["-r", String(Math.round(NATIVE_BASE_RATE * config.speed))], rewrite.text);
    } else await synthesizeOpenAI(rewrite.text, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!controller.signal.aborted) notify(ctx, message, "error");
  } finally {
    speaking = false;
    if (activeController === controller) activeController = undefined;
    activeProcess = undefined;
    await cleanupAudio();
    setStatus(ctx);
  }
};

const statusText = () => [
  `Provider: ${config.provider}`,
  `Automatic playback: ${config.autoSpeak ? "on" : "off"}`,
  `Rewrite model: openai/${config.rewriteModel}`,
  `OpenAI voice: ${config.openaiVoice}`,
  `Playback speed: ${config.speed}x${config.provider === "native" ? ` (${Math.round(NATIVE_BASE_RATE * config.speed)} words per minute)` : ""}`,
  `Cached rewrites: ${Object.keys(rewriteCache).length}`,
].join("\n");

const showStatus = (ctx: ExtensionContext | ExtensionCommandContext) => notify(ctx, statusText());

const showHelp = (ctx: ExtensionContext | ExtensionCommandContext) => notify(ctx, [
  "/speak — speak the latest response",
  "/speech — open interactive settings",
  "/speech status — show current settings",
  "/speech provider [native|openai] — choose a provider",
  "/speech voice [name] — choose an OpenAI voice",
  "/speech voices — list OpenAI voices",
  "/speech speed [0.25–4] — configure playback speed",
  "/speech auto [on|off] — configure automatic playback",
  "/speech replay — replay the latest response",
  "/speech stop — stop playback",
  "/speech cache clear — clear saved rewrites",
  "Shortcuts: Ctrl+Shift+S speaks; Ctrl+Shift+X stops",
].join("\n"));

const selectProvider = async (ctx: ExtensionCommandContext) => {
  if (!ctx.hasUI) return;
  const choice = await ctx.ui.select("Speech provider", [
    `native${config.provider === "native" ? " (current)" : ""} — free macOS speech`,
    `openai${config.provider === "openai" ? " (current)" : ""} — GPT-4o mini TTS`,
  ]);
  const provider = choice?.startsWith("openai") ? "openai" : choice?.startsWith("native") ? "native" : undefined;
  if (!provider) return;
  config.provider = provider;
  await saveConfig();
  showStatus(ctx);
};

const selectVoice = async (ctx: ExtensionCommandContext) => {
  if (!ctx.hasUI) return;
  const options = OPENAI_VOICES.map(([name, description]) =>
    `${name}${name === config.openaiVoice ? " (current)" : ""} — ${description}`,
  );
  const choice = await ctx.ui.select("OpenAI voice", options);
  if (!choice) return;
  config.openaiVoice = choice.split(/[ (—]/, 1)[0];
  await saveConfig();
  showStatus(ctx);
};

const selectSpeed = async (ctx: ExtensionCommandContext) => {
  if (!ctx.hasUI) return;
  const choice = await ctx.ui.select("Playback speed", SPEED_PRESETS.map((speed) =>
    `${speed}x${speed === config.speed ? " (current)" : ""}${config.provider === "native" ? ` — ${Math.round(NATIVE_BASE_RATE * speed)} words per minute` : ""}`,
  ));
  if (!choice) return;
  config.speed = Number.parseFloat(choice);
  await saveConfig();
  showStatus(ctx);
};

const selectAuto = async (ctx: ExtensionCommandContext) => {
  if (!ctx.hasUI) return;
  const choice = await ctx.ui.select("Automatic playback", [
    `off${!config.autoSpeak ? " (current)" : ""} — speak only on request`,
    `on${config.autoSpeak ? " (current)" : ""} — speak after each settled response`,
  ]);
  if (!choice) return;
  config.autoSpeak = choice.startsWith("on");
  await saveConfig();
  setStatus(ctx);
  showStatus(ctx);
};

const openSettings = async (ctx: ExtensionCommandContext) => {
  if (!ctx.hasUI) return showHelp(ctx);
  const choice = await ctx.ui.select("Pi speech", [
    `Speak latest response`,
    `Provider: ${config.provider}`,
    `OpenAI voice: ${config.openaiVoice}`,
    `Playback speed: ${config.speed}x`,
    `Automatic playback: ${config.autoSpeak ? "on" : "off"}`,
    `Show status`,
    `Show commands`,
    `Clear ${Object.keys(rewriteCache).length} cached rewrite(s)`,
  ]);
  if (choice === "Speak latest response") return speakLatest(ctx);
  if (choice?.startsWith("Provider:")) return selectProvider(ctx);
  if (choice?.startsWith("OpenAI voice:")) return selectVoice(ctx);
  if (choice?.startsWith("Playback speed:")) return selectSpeed(ctx);
  if (choice?.startsWith("Automatic playback:")) return selectAuto(ctx);
  if (choice === "Show status") return showStatus(ctx);
  if (choice === "Show commands") return showHelp(ctx);
  if (choice?.startsWith("Clear ")) {
    rewriteCache = {};
    await saveCache();
    notify(ctx, "Speech rewrite cache cleared");
  }
};

const completionItems = (prefix: string) => {
  const values = [
    ["status", "Show speech settings and cache size"],
    ["help", "Show commands and shortcuts"],
    ["replay", "Speak the latest response"],
    ["stop", "Stop playback"],
    ["provider", "Choose native or OpenAI speech"],
    ["provider native", "Use free macOS speech"],
    ["provider openai", "Use OpenAI GPT-4o mini TTS"],
    ["voice", "Choose an OpenAI voice"],
    ...OPENAI_VOICES.map(([voice, description]) => [`voice ${voice}`, description]),
    ["voices", "List all OpenAI voices"],
    ["speed", "Choose playback speed"],
    ...SPEED_PRESETS.map((speed) => [`speed ${speed}`, `${speed} times normal speed`] as [string, string]),
    ["auto", "Configure automatic playback"],
    ["auto on", "Speak each settled response"],
    ["auto off", "Speak only on request"],
    ["cache clear", "Clear persistent speech rewrites"],
  ] as Array<[string, string]>;
  const normalized = prefix.toLowerCase();
  const matches = values.filter(([value]) => value.startsWith(normalized));
  return matches.length ? matches.map(([value, description]) => ({ value, label: value, description })) : null;
};

export default async function (pi: ExtensionAPI) {
  await Promise.all([loadConfig(), loadCache()]);

  pi.registerCommand("speak", {
    description: "Rewrite and speak the latest assistant response",
    handler: async (_args, ctx) => speakLatest(ctx),
  });

  pi.registerCommand("speech-stop", {
    description: "Stop speech playback",
    handler: async (_args, ctx) => stopSpeech(ctx),
  });

  pi.registerCommand("speech", {
    description: "Open speech settings or configure provider, voice, auto playback, and cache",
    getArgumentCompletions: completionItems,
    handler: async (args, ctx) => {
      const input = args.trim();
      if (!input) return openSettings(ctx);
      const [action, value] = input.split(/\s+/, 2);
      if (action === "status") return showStatus(ctx);
      if (action === "help") return showHelp(ctx);
      if (action === "replay" || action === "speak") return speakLatest(ctx);
      if (action === "stop") return stopSpeech(ctx);
      if (action === "voices") {
        notify(ctx, OPENAI_VOICES.map(([name, description]) => `${name}${name === config.openaiVoice ? " (current)" : ""} — ${description}`).join("\n"));
        return;
      }
      if (action === "provider") {
        if (!value) return selectProvider(ctx);
        if (value !== "native" && value !== "openai") {
          notify(ctx, "Choose native or openai. Type /speech provider and press Tab.", "warning");
          return;
        }
        config.provider = value;
      } else if (action === "speed") {
        if (!value) return selectSpeed(ctx);
        const speed = Number.parseFloat(value);
        if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
          notify(ctx, "Choose a speed from 0.25 to 4. For example: /speech speed 1.25", "warning");
          return;
        }
        config.speed = speed;
      } else if (action === "auto") {
        if (!value) return selectAuto(ctx);
        if (value !== "on" && value !== "off") {
          notify(ctx, "Choose on or off. Type /speech auto and press Tab.", "warning");
          return;
        }
        config.autoSpeak = value === "on";
      } else if (action === "voice") {
        if (!value) return selectVoice(ctx);
        if (!OPENAI_VOICE_NAMES.includes(value as typeof OPENAI_VOICE_NAMES[number])) {
          notify(ctx, `Unknown voice: ${value}. Use /speech voices or type /speech voice and press Tab.`, "warning");
          return;
        }
        config.openaiVoice = value;
      } else if (action === "cache" && value === "clear") {
        rewriteCache = {};
        await saveCache();
        notify(ctx, "Speech rewrite cache cleared");
        return;
      } else {
        notify(ctx, "Unknown speech command. Use /speech help or type /speech and press Tab.", "warning");
        return;
      }
      await saveConfig();
      setStatus(ctx);
      showStatus(ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+s", {
    description: "Speak the latest assistant response",
    handler: async (ctx) => speakLatest(ctx),
  });

  pi.registerShortcut("ctrl+shift+x", {
    description: "Stop speech playback",
    handler: async (ctx) => stopSpeech(ctx),
  });

  pi.on("session_start", (_event, ctx) => {
    suppressAutoSpeak = false;
    setStatus(ctx);

    if (ctx.mode !== "tui") return;
    const previousFactory = ctx.ui.getEditorComponent();
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = previousFactory?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
      if (!editor.handleInput) return editor;
      const originalHandleInput = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        if (isEditingInput(data)) interruptForInput(ctx);
        originalHandleInput(data);
      };
      return editor;
    });
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    suppressAutoSpeak = true;
    interruptForInput(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    interruptForInput(ctx);
    suppressAutoSpeak = false;
  });

  pi.on("message_end", async (event) => {
    if (event.message.role !== "assistant") return;
    if (event.message.stopReason === "aborted" || event.message.stopReason === "error") {
      suppressAutoSpeak = true;
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const message = latestAssistantMessage(ctx);
    const completed = message?.stopReason === "stop" || message?.stopReason === "length";
    if (config.autoSpeak && completed && !suppressAutoSpeak && !ctx.hasPendingMessages()) {
      await speakLatest(ctx);
    }
    suppressAutoSpeak = false;
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    await stopSpeech(ctx, false, true);
  });

  pi.on("session_before_fork", async (_event, ctx) => {
    await stopSpeech(ctx, false, true);
  });

  pi.on("session_shutdown", async () => {
    await stopSpeech(undefined, false, true);
  });
}
