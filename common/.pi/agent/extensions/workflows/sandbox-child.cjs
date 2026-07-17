"use strict";
const vm = require("node:vm");
let token;
let nextId = 1;
const pending = new Map();
function send(message) { if (process.send) process.send({ token, ...message }); }
function safe(value) { return JSON.stringify(value === undefined ? null : value); }
process.on("message", async (message) => {
  if (!message || typeof message !== "object") return;
  if (message.kind === "agentResult" && message.token === token) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    try { request.resolve(JSON.parse(message.resultJson)); } catch (error) { request.reject(error); }
    return;
  }
  if (message.kind !== "init" || typeof message.token !== "string") return;
  token = message.token;
  try {
    const argsEnvelope = JSON.parse(message.argsJson);
    const context = Object.create(null);
    context.args = argsEnvelope.defined ? argsEnvelope.value : undefined;
    context.phase = (title) => send({ kind: "phase", payloadJson: safe({ title: String(title).slice(0, 160) }) });
    context.agent = (prompt, options = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ kind: "agent", payloadJson: safe({ id, prompt: String(prompt), options }) });
    });
    context.parallel = async (thunks, options = {}) => {
      if (!Array.isArray(thunks) || !thunks.every((item) => typeof item === "function")) throw new Error("parallel() requires an array of zero-argument functions");
      const limit = Math.max(1, Math.min(4, Number.isInteger(options.concurrency) ? options.concurrency : 4));
      const results = new Array(thunks.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(limit, thunks.length) }, async () => {
        while (next < thunks.length) { const index = next++; results[index] = await thunks[index](); }
      }));
      return results;
    };
    const script = new vm.Script(`(async () => {\n${message.source}\n})()`, { filename: "workflow.js" });
    const sandbox = vm.createContext(context, { codeGeneration: { strings: false, wasm: false } });
    const result = await script.runInContext(sandbox, { timeout: 60_000 });
    if (pending.size > 0) throw new Error(`Workflow returned with ${pending.size} unawaited agent call(s). Await every agent() or parallel() call before returning.`);
    send({ kind: "result", resultJson: safe(result) });
  } catch (error) { send({ kind: "error", error: error instanceof Error ? error.stack || error.message : String(error) }); }
});
