import net from "node:net";

export type FocusListener = (focused: boolean) => void;
export type FocusMonitor = { dispose(): void };

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export function createHerdrFocusMonitor(listener: FocusListener): FocusMonitor | undefined {
  const socketPath = process.env.HERDR_SOCKET_PATH;
  let paneId = process.env.HERDR_PANE_ID;
  if (process.env.HERDR_ENV !== "1" || !socketPath || !paneId) return undefined;

  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let socket: net.Socket | undefined;
  let buffer = "";

  const connect = () => {
    if (disposed) return;
    buffer = "";
    socket = net.createConnection(socketPath);
    socket.setEncoding("utf8");

    socket.on("connect", () => {
      socket?.write(`${JSON.stringify({ id: "recap-snapshot", method: "session.snapshot", params: {} })}\n`);
      socket?.write(`${JSON.stringify({
        id: "recap-focus",
        method: "events.subscribe",
        params: { subscriptions: [{ type: "pane.focused" }, { type: "pane.moved" }, { type: "pane.closed" }] },
      })}\n`);
    });

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        try {
          const message = record(JSON.parse(line));
          const result = record(message?.result);
          const snapshot = record(result?.snapshot);
          if (typeof snapshot?.focused_pane_id === "string") {
            listener(snapshot.focused_pane_id === paneId);
          }

          const data = record(message?.data);
          if (message?.event === "pane_focused" && typeof data?.pane_id === "string") {
            listener(data.pane_id === paneId);
          } else if (message?.event === "pane_moved" && data?.previous_pane_id === paneId) {
            const pane = record(data?.pane);
            if (typeof pane?.pane_id === "string") paneId = pane.pane_id;
          } else if (message?.event === "pane_closed" && data?.pane_id === paneId) {
            listener(false);
          }
        } catch {
          // Ignore malformed or forward-compatible messages.
        }
      }
    });

    const reconnect = () => {
      socket = undefined;
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, 1_000);
      reconnectTimer.unref?.();
    };
    socket.once("error", reconnect);
    socket.once("close", reconnect);
  };

  connect();
  return {
    dispose() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      socket?.removeAllListeners();
      socket?.destroy();
      socket = undefined;
    },
  };
}

const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";

export class TerminalFocusParser {
  private pending = "";

  push(chunk: string): { data: string; focused?: boolean } {
    const input = this.pending + chunk;
    this.pending = "";
    let data = "";
    let focused: boolean | undefined;

    for (let index = 0; index < input.length;) {
      if (input.startsWith("\x1b[I", index) || input.startsWith("\x1b[O", index)) {
        focused = input[index + 2] === "I";
        index += 3;
        continue;
      }
      const remainder = input.slice(index);
      if (remainder === "\x1b[") {
        this.pending = remainder;
        break;
      }
      data += input[index];
      index += 1;
    }

    return { data, focused };
  }
}

export function enableTerminalFocusReporting(): void {
  if (process.stdout.isTTY) process.stdout.write(ENABLE_FOCUS_REPORTING);
}

export function disableTerminalFocusReporting(): void {
  if (process.stdout.isTTY) process.stdout.write(DISABLE_FOCUS_REPORTING);
}
