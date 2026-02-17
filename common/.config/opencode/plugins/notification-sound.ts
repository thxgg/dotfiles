import type { Plugin } from "@opencode-ai/plugin";
import { homedir } from "os";
import { join } from "path";

export const NotificationSound: Plugin = async ({ $, client }) => {
  if (process.platform !== "darwin") {
    return {};
  }

  const soundPath = join(
    homedir(),
    ".config/opencode/sounds/gow_active_reload.mp3",
  );
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearIdleTimer = (sessionID: string): void => {
    const timer = idleTimers.get(sessionID);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(sessionID);
    }
  };

  const playSound = async (): Promise<void> => {
    await $`afplay ${soundPath}`.quiet().nothrow();
  };

  const isMainSession = async (sessionID: string): Promise<boolean> => {
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      const session = (result as any).data ?? result;
      return !session.parentID;
    } catch {
      return true;
    }
  };

  process.on("exit", () => {
    for (const timer of idleTimers.values()) {
      clearTimeout(timer);
    }
    idleTimers.clear();
  });

  return {
    event: async ({ event }) => {
      const eventType = (event as { type: string }).type;
      const properties = (event as any).properties ?? {};

      if (eventType === "session.busy") {
        clearIdleTimer(properties.sessionID);
        return;
      }

      if (eventType === "session.idle") {
        const sessionID = properties.sessionID;
        if (!sessionID) return;

        clearIdleTimer(sessionID);

        if (!(await isMainSession(sessionID))) return;

        idleTimers.set(
          sessionID,
          setTimeout(async () => {
            idleTimers.delete(sessionID);
            await playSound();
          }, 3000),
        );
        return;
      }

      if (eventType === "permission.asked") {
        await playSound();
      }
    },
  };
};
