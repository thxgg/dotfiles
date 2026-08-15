import { globalAgentCapacity } from "../subagents/concurrency.ts";

export const MAX_WORKFLOW_AGENT_CALLS = 32;

function abortError(signal: AbortSignal): Error { return signal.reason instanceof Error ? signal.reason : new Error("Workflow aborted."); }

export class WorkflowController {
  private readonly controller = new AbortController();
  private readonly tasks = new Set<Promise<unknown>>();
  private calls = 0;
  private sealed = false;
  private readonly parentAbort?: () => void;

  constructor(private readonly parentSignal?: AbortSignal) {
    if (parentSignal) {
      this.parentAbort = () => this.abort("Parent operation was aborted.");
      if (parentSignal.aborted) this.parentAbort();
      else parentSignal.addEventListener("abort", this.parentAbort, { once: true });
    }
  }
  get signal(): AbortSignal { return this.controller.signal; }
  get callCount(): number { return this.calls; }

  schedule<T>(operation: (signal: AbortSignal) => Promise<T>, invocationSignal?: AbortSignal): Promise<T> {
    if (this.sealed) return Promise.reject(new Error("Workflow is settling."));
    if (this.signal.aborted) return Promise.reject(abortError(this.signal));
    if (this.calls >= MAX_WORKFLOW_AGENT_CALLS) return Promise.reject(new Error(`Workflow exceeded ${MAX_WORKFLOW_AGENT_CALLS} agent calls.`));
    this.calls += 1;
    const task = (async () => {
      const childController = new AbortController();
      const onRunAbort = () => childController.abort(this.signal.reason);
      const onInvocationAbort = () => childController.abort(invocationSignal?.reason);
      this.signal.addEventListener("abort", onRunAbort, { once: true });
      invocationSignal?.addEventListener("abort", onInvocationAbort, { once: true });
      if (this.signal.aborted) onRunAbort();
      else if (invocationSignal?.aborted) onInvocationAbort();
      const lease = await globalAgentCapacity.acquire(childController.signal);
      try {
        if (childController.signal.aborted) throw abortError(childController.signal);
        return await operation(childController.signal);
      }
      finally {
        lease.release();
        this.signal.removeEventListener("abort", onRunAbort);
        invocationSignal?.removeEventListener("abort", onInvocationAbort);
      }
    })();
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task)).catch(() => undefined);
    return task;
  }
  abort(reason = "Workflow aborted."): void { if (!this.signal.aborted) this.controller.abort(new Error(reason)); }
  async settle(abort = false, timeoutMs = 8000): Promise<boolean> {
    this.sealed = true;
    if (abort) this.abort();
    const tasks = [...this.tasks];
    if (!tasks.length) { this.detach(); return true; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); timer.unref?.(); });
    const result = await Promise.race([Promise.allSettled(tasks).then(() => true as const), timeout]);
    if (timer) clearTimeout(timer);
    this.detach();
    return result;
  }
  private detach(): void { if (this.parentAbort) this.parentSignal?.removeEventListener("abort", this.parentAbort); }
}
