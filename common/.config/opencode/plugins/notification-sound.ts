import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { homedir } from "os";
import { join } from "path";

export const NotificationSound: Plugin = async ({ $, client }) => {
  const soundPath = join(
    homedir(),
    ".config/opencode/sounds/gow_active_reload.mp3",
  );

  const isMainSession = async (sessionID: string): Promise<boolean> => {
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      const session = (result as any).data ?? result;
      return !session.parentID;
    } catch {
      return true;
    }
  };

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const sessionID = (event.properties as any)?.sessionID;
        if (sessionID && (await isMainSession(sessionID))) {
          await $`afplay ${soundPath}`;
        }
      }

      if (event.type === "permission.asked") {
        await $`afplay ${soundPath}`;
      }
    },
  };
};
