export const DEFAULT_GLOBAL_AGENT_CONCURRENCY = 4;

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Agent operation was aborted.");
}

interface Waiter {
  signal: AbortSignal;
  resolve: (lease: AgentCapacityLease) => void;
  reject: (error: Error) => void;
  onAbort: () => void;
}

export interface AgentCapacityLease {
  release(): void;
}

/** Process-wide capacity shared by standalone subagents and workflow children. */
export class AgentCapacityPool {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(readonly limit = DEFAULT_GLOBAL_AGENT_CONCURRENCY) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Agent concurrency limit must be a positive integer.");
  }

  get activeCount(): number { return this.active; }
  get queuedCount(): number { return this.queue.length; }

  acquire(signal: AbortSignal = new AbortController().signal): Promise<AgentCapacityLease> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.makeLease());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject, onAbort: () => {} };
      waiter.onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(abortError(signal));
      };
      this.queue.push(waiter);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
    });
  }

  private makeLease(): AgentCapacityLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.releaseOne();
      },
    };
  }

  private releaseOne(): void {
    this.active = Math.max(0, this.active - 1);
    while (this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal.aborted) {
        waiter.reject(abortError(waiter.signal));
        continue;
      }
      this.active += 1;
      waiter.resolve(this.makeLease());
      return;
    }
  }
}

export const globalAgentCapacity = new AgentCapacityPool(
  Number.parseInt(process.env.PI_AGENT_MAX_CONCURRENCY ?? "", 10) || DEFAULT_GLOBAL_AGENT_CONCURRENCY,
);
