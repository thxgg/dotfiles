export type Status = "queued" | "running" | "success" | "error" | "cancelled" | "interrupted";
export interface Call {
  id: string;
  name: string;
  label: string;
  status: Status;
  outside: boolean;
  group: string;
}
export interface Group { id: string; calls: Call[]; expanded: boolean }
export interface Content { type: string; text?: string }
export interface Result { content: readonly Content[]; isError?: boolean }
export interface Message {
  role: string;
  content?: string | readonly (Content & { id?: string; name?: string; arguments?: Record<string, unknown> })[];
  toolCallId?: string;
  isError?: boolean;
  display?: boolean;
}

// Labels are bounded, single-line, and cannot inject terminal control sequences.
export function safeLabel(value: unknown): string {
  return String(value ?? "").slice(0, 500).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}
export function callLabel(name: string, args: Record<string, unknown>): string {
  const verb: Record<string, string> = { bash: "Run", edit: "Edit", write: "Write", read: "Read", ls: "List", grep: "Search", find: "Find", websearch: "Search web", webfetch: "Fetch" };
  let target = args.command ?? args.action ?? args.query ?? args.pattern ?? args.path ?? args.url ?? args.agent ?? "";
  if (name === "webfetch") {
    try { const url = new URL(String(target)); url.username = ""; url.password = ""; target = url.toString(); } catch { target = "URL"; }
  }
  return `${verb[name] ?? name} ${safeLabel(target)}`;
}
export function resultStatus(result: Result, cancelled = false): Status {
  if (!result.isError) return "success";
  const text = result.content.filter(p => p.type === "text").map(p => p.text ?? "").join("\n");
  return cancelled || /(?:^|\n)(Operation aborted|Tool execution aborted|Command aborted|Web (fetch|search) cancelled)[.!]?$/i.test(text.trim())
    ? "cancelled" : "error";
}

export class Activity {
  readonly groups: Group[] = [];
  readonly calls = new Map<string, Call>();
  private current?: Group;
  private messages = new WeakSet<object>();
  private unsupported = new Set<string>();
  constructor(readonly supported: Set<string>) {}
  boundary(): void { this.current = undefined; }
  add(id: string, name: string, args: Record<string, unknown>): Call | undefined {
    const existing = this.calls.get(id);
    if (existing) { existing.label = callLabel(name, args); return existing; }
    if (this.unsupported.has(id)) return;
    if (!this.supported.has(name)) { this.unsupported.add(id); this.boundary(); return; }
    if (!this.current) {
      this.current = { id, calls: [], expanded: false };
      this.groups.push(this.current);
    }
    const call: Call = { id, name, label: callLabel(name, args), status: "queued", outside: false, group: this.current.id };
    this.current.calls.push(call);
    this.calls.set(id, call);
    return call;
  }
  message(message: Message): void {
    if (this.messages.has(message)) return;
    this.messages.add(message);
    if (message.role === "toolResult") {
      if (message.toolCallId) this.finish(message.toolCallId, { content: Array.isArray(message.content) ? message.content : [], isError: message.isError });
      return;
    }
    if (message.role !== "assistant") {
      if (message.role !== "custom" || message.display !== false) this.boundary();
      return;
    }
    if (!Array.isArray(message.content)) return;
    for (const part of message.content) {
      if (part.type === "toolCall" && part.id && part.name) this.add(part.id, part.name, part.arguments ?? {});
      else if (part.type === "text" && part.text?.trim()) this.boundary();
    }
  }
  start(id: string, name: string, args: Record<string, unknown>): void {
    const call = this.add(id, name, args);
    if (call?.status === "queued") call.status = "running";
  }
  finish(id: string, result: Result, cancelled = false): void {
    const call = this.calls.get(id);
    if (!call) return;
    // A final message can refine a result, but cannot undo known cancellation.
    const status = resultStatus(result, cancelled);
    call.status = call.status === "cancelled" && status === "error" ? "cancelled" : status;
    if (result.content.some(p => p.type === "image")) this.exclude(id);
  }
  exclude(id: string): void {
    const call = this.calls.get(id);
    if (!call || call.outside) return;
    call.outside = true;
    const group = this.group(call.group)!;
    const index = group.calls.indexOf(call);
    const tail = group.calls.splice(index + 1);
    if (tail.length) {
      const next: Group = { id: tail[0]!.id, calls: tail, expanded: group.expanded };
      for (const item of tail) item.group = next.id;
      this.groups.splice(this.groups.indexOf(group) + 1, 0, next);
      if (this.current === group) this.current = next;
    } else if (this.current === group) this.boundary();
  }
  prompt(): string[] {
    const ids = [...this.calls.values()].filter(c => c.status === "queued" || c.status === "running").map(c => c.id);
    for (const id of ids) this.exclude(id);
    this.boundary();
    return ids;
  }
  settle(): void {
    for (const call of this.calls.values()) {
      if (call.status === "running" || call.status === "queued") call.status = "interrupted";
    }
    this.boundary();
  }
  group(id: string): Group | undefined { return this.groups.find(g => g.id === id); }
  members(group: Group): Call[] { return group.calls.filter(c => !c.outside); }
  host(call: Call): boolean { return this.group(call.group)?.calls.find(c => !c.outside)?.id === call.id; }
}
export function summary(calls: readonly Call[]): string {
  const counts = new Map<string, number>();
  const kinds: Record<string, string> = { read: "read", grep: "search", find: "search", ls: "listing", websearch: "web search", webfetch: "fetch" };
  for (const call of calls) { const kind = kinds[call.name] ?? call.name; counts.set(kind, (counts.get(kind) ?? 0) + 1); }
  const running = calls.filter(c => c.status === "running").length;
  const queued = calls.filter(c => c.status === "queued").length;
  const failed = calls.filter(c => c.status === "error").length;
  const cancelled = calls.filter(c => c.status === "cancelled").length;
  const interrupted = calls.filter(c => c.status === "interrupted").length;
  const onlyShell = calls.every(c => c.name === "bash");
  const exploration = calls.every(c => Object.hasOwn(kinds, c.name));
  const parts = onlyShell
    ? [`${running || queued ? "Running" : "Ran"} ${calls.length} command${calls.length === 1 ? "" : "s"}`]
    : [exploration ? running || queued ? "Exploring" : "Explored" : "Activity", ...[...counts].map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : kind.endsWith("search") ? "es" : "s"}`)];
  if (calls.every(c => c.status === "success")) parts.push("completed");
  for (const [n, label] of [[running, "running"], [queued, "queued"], [failed, "FAILED"], [cancelled, "cancelled"], [interrupted, "interrupted"]] as const) if (n) parts.push(`${n} ${label}`);
  return parts.join(" · ");
}
