"use strict";
const vm = require("node:vm");
let token;
let nextId = 1;
const pending = new Map();
const calls = new Map();
function send(message) { if (process.send) process.send({ token, ...message }); }
function safe(value) { return JSON.stringify(value === undefined ? null : value); }
function normalizeAgentArgs(prompt, options) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("agent() requires a non-empty prompt string");
  if (options === undefined) return { prompt, options: {} };
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("agent() options must be an object");
  if (Object.hasOwn(options, "agentType") || Object.hasOwn(options, "task")) throw new Error("Workflow agent types are not supported. Use agent(prompt, { label, phase, schema, model, effort }).");
  return { prompt, options };
}
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
    context.phase = (title, work) => {
      send({ kind: "phase", payloadJson: safe({ title: String(title).slice(0, 160) }) });
      if (work === undefined) return undefined;
      if (typeof work !== "function") throw new Error("phase() callback must be a function");
      return work();
    };
    context.agent = (first, second) => {
      const { prompt, options } = normalizeAgentArgs(first, second);
      const id = nextId++;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      const call = { observed: false };
      calls.set(id, call);
      send({ kind: "agent", payloadJson: safe({ id, prompt, options }) });
      return Object.freeze({
        then(onFulfilled, onRejected) {
          call.observed = true;
          return promise.then(onFulfilled, onRejected);
        },
      });
    };
    context.parallel = async (items, options = {}) => {
      if (!Array.isArray(items)) throw new Error("parallel() requires an array of promises or zero-argument functions");
      const limit = Math.max(1, Math.min(4, Number.isInteger(options.concurrency) ? options.concurrency : 4));
      const results = new Array(items.length);
      const functionIndexes = [];
      const started = [];
      for (let index = 0; index < items.length; index++) {
        if (typeof items[index] === "function") functionIndexes.push(index);
        else started.push(Promise.resolve(items[index]).then((value) => { results[index] = value; }));
      }
      let next = 0;
      const workers = Array.from({ length: Math.min(limit, functionIndexes.length) }, async () => {
        while (next < functionIndexes.length) {
          const index = functionIndexes[next++];
          results[index] = await items[index]();
        }
      });
      await Promise.all([...started, ...workers]);
      return results;
    };
    const script = new vm.Script(`(async () => {\n${message.source}\n})()`, { filename: "workflow.js" });
    const sandbox = vm.createContext(context, { codeGeneration: { strings: false, wasm: false } });
    const result = await script.runInContext(sandbox, { timeout: 60_000 });
    const unobserved = [...calls.values()].filter((call) => !call.observed).length;
    if (unobserved > 0) throw new Error(`Workflow returned with ${unobserved} unawaited agent call(s). Await every agent() or parallel() call before returning.`);
    send({ kind: "result", resultJson: safe(result) });
  } catch (error) { send({ kind: "error", error: error instanceof Error ? error.stack || error.message : String(error) }); }
});
