"use strict";
const vm = require("node:vm");
let token;
let nextId = 1;
const pending = new Map();
const calls = new Map();
function send(message) { if (process.send) process.send({ token, ...message }); }
function safe(value) { return JSON.stringify(value === undefined ? null : value); }
function normalizeAgentArgs(first, second) {
  if (first && typeof first === "object" && !Array.isArray(first)) {
    if (second !== undefined) throw new Error("agent() legacy object form does not accept a second argument");
    const prompt = typeof first.prompt === "string" ? first.prompt : first.task;
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("agent() requires a non-empty prompt or task string");
    const options = { ...first };
    delete options.prompt; delete options.task; delete options.agentType;
    if (options.name !== undefined && options.label === undefined) options.label = options.name;
    delete options.name;
    return { prompt, options };
  }
  if (typeof first !== "string" || !first.trim()) throw new Error("agent() requires a non-empty prompt string");
  if (second === undefined) return { prompt: first, options: {} };
  if (!second || typeof second !== "object" || Array.isArray(second)) throw new Error("agent() options must be an object");
  if (Object.hasOwn(second, "agentType") || Object.hasOwn(second, "task")) throw new Error("Use agent(prompt, { label, phase, schema, model, effort }) or legacy agent({ task, name, ... }).");
  return { prompt: first, options: second };
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
