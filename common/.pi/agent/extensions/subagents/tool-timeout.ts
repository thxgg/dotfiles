import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export const CHILD_TOOL_TIMEOUT_MS = 3 * 60_000;

export class ToolCallTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(`Tool call "${toolName}" timed out after ${timeoutMs} ms.`);
    this.name = "ToolCallTimeoutError";
  }
}

export async function runWithToolTimeout<T>(
  toolName: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutController = new AbortController();
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutController.signal]) : timeoutController.signal;
  const error = new ToolCallTimeoutError(toolName, timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { timeoutController.abort(error); reject(error); }, timeoutMs);
    timer.unref?.();
  });
  try { return await Promise.race([execute(signal), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

interface ToolRegistry {
  getAllTools(): Array<{ name: string }>;
  getToolDefinition(name: string): ToolDefinition | undefined;
}

/** Reapplying is safe and catches tools registered by child extensions later. */
export function createToolTimeoutGuard(timeoutMs = CHILD_TOOL_TIMEOUT_MS) {
  const wrapped = new WeakSet<ToolDefinition>();
  return {
    apply(registry: ToolRegistry): void {
      for (const { name } of registry.getAllTools()) {
        const definition = registry.getToolDefinition(name);
        if (!definition || wrapped.has(definition)) continue;
        wrapped.add(definition);
        const execute = definition.execute;
        definition.execute = async (id, params, signal, onUpdate, ctx) =>
          runWithToolTimeout(definition.name, timeoutMs, signal, (childSignal) =>
            execute.call(definition, id, params, childSignal, onUpdate, ctx));
      }
    },
  };
}
