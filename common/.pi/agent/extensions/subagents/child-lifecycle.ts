import type { AgentSession, SessionShutdownEvent } from "@earendil-works/pi-coding-agent";

const CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;

export async function bindChildSessionExtensions(session: Pick<AgentSession, "bindExtensions">): Promise<void> {
  await session.bindExtensions({ mode: "print" });
}

interface ChildExtensionRunner {
  hasHandlers(eventType: string): boolean;
  emit(event: SessionShutdownEvent): Promise<unknown>;
}

export interface DisposableChildSession {
  readonly extensionRunner: ChildExtensionRunner;
  dispose(): void;
}

const shutdowns = new WeakMap<object, Promise<void>>();

async function bounded(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    operation.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); timer.unref?.(); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

/** Emit child session_shutdown once, then dispose once even when hooks fail or hang. */
export function shutdownAndDisposeChildSession(
  session: DisposableChildSession,
  timeoutMs = CHILD_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const existing = shutdowns.get(session);
  if (existing) return existing;
  const operation = (async () => {
    try {
      if (session.extensionRunner.hasHandlers("session_shutdown")) {
        await bounded(session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }), timeoutMs);
      }
    } catch { /* teardown is best effort */ }
    finally {
      try { session.dispose(); } catch { /* idempotent terminal cleanup */ }
    }
  })();
  shutdowns.set(session, operation);
  return operation;
}
