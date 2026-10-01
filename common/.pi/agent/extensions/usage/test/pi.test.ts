import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { PiSubscriptionAuth } from "../pi-auth.ts";

const signal = () => new AbortController().signal;

test("Pi auth uses its resolver, accepts refreshed OAuth, and refuses API/environment keys", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-auth-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "auth.json");
  const stored = (access: string, type = "oauth") => writeFile(path, JSON.stringify({ anthropic: type === "oauth" ? { type, access, refresh: "synthetic-refresh", expires: Date.now() + 3600_000 } : { type, key: access } }));
  await stored("old-synthetic-token");
  const auth = new PiSubscriptionAuth(() => ({ modelRegistry: { getProviderAuth: async provider => {
    assert.equal(provider, "anthropic");
    await stored("refreshed-synthetic-token");
    return { source: "OAuth", auth: { apiKey: "refreshed-synthetic-token" } };
  } } }), path);
  const resolved = await auth.resolve("anthropic", signal());
  assert.ok(resolved.ok);
  assert.equal(resolved.value.reveal(), "refreshed-synthetic-token");
  await stored("api-key", "api_key");
  assert.equal((await auth.resolve("anthropic", signal())).ok, false);
  const missingCodex = await auth.resolve("openai-codex", signal());
  assert.ok(!missingCodex.ok && missingCodex.error.kind === "unsupported");
  await stored("synthetic-oauth");
  const environment = new PiSubscriptionAuth(() => ({ modelRegistry: { getProviderAuth: async () => ({ source: "ANTHROPIC_API_KEY", auth: { apiKey: "environment-key" } }) } }), path);
  assert.equal((await environment.resolve("anthropic", signal())).ok, false);
  const changed = new PiSubscriptionAuth(() => ({ modelRegistry: { getProviderAuth: async () => ({ source: "OAuth", auth: { apiKey: "different-oauth" } }) } }), path);
  assert.equal((await changed.resolve("anthropic", signal())).ok, false);
});

test("Pi status uses extmgr's dim color and clears immediately on provider switches", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-status-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = `
    import assert from "node:assert/strict";
    import {mkdir,writeFile} from "node:fs/promises";
    import {join} from "node:path";
    import {createHash} from "node:crypto";
    import extension from ${JSON.stringify(new URL("../index.ts", import.meta.url).href)};
    import {FileUsageStore} from ${JSON.stringify(new URL("../store.ts", import.meta.url).href)};
    import {accountKey} from ${JSON.stringify(new URL("../providers.ts", import.meta.url).href)};
    const agent=process.env.PI_CODING_AGENT_DIR;
    const now=Date.now();
    const token="synthetic."+Buffer.from(JSON.stringify({sub:"synthetic-user","https://api.openai.com/auth":{chatgpt_account_id:"synthetic-account"}})).toString("base64url")+".signature";
    await mkdir(agent,{recursive:true});
    await writeFile(join(agent,"auth.json"),JSON.stringify({"openai-codex":{type:"oauth",access:token,refresh:"synthetic",expires:now+3600000}}));
    const account={provider:"codex",key:accountKey("codex","synthetic-user:synthetic-account"),label:"Synthetic Codex"};
    const namespace=createHash("sha256").update(agent).digest("hex");
    const store=new FileUsageStore(join(process.env.HOME,".local","state","pi-subscription-usage",namespace));
    const saved=await store.withAccount(account,new AbortController().signal,async(_state,save)=>save({nextPollAt:now+300000,snapshot:{account,checkedAt:now,windows:[{id:"primary",label:"7d",usedPercent:25}],inventory:{kind:"known",credits:[]}}}));
    assert.ok(saved.ok);
    const handlers=new Map(), commands=new Map(), statuses=[], colors=[];
    const ctx={mode:"tui",hasUI:true,model:{provider:"openai"},modelRegistry:{getProviderAuth:async()=>({source:"OAuth",auth:{apiKey:token}})},ui:{theme:{fg:(color,text)=>{colors.push(color);return "grey:"+text}},setStatus:(key,text)=>statuses.push({key,text}),notify:()=>{}}};
    let requests=0;
    globalThis.fetch=async()=>{requests++;throw new Error("No HTTP is permitted in the status test.");};
    extension({on:(event,handler)=>handlers.set(event,handler),registerCommand:(name,command)=>commands.set(name,command)});
    assert.deepEqual([...commands.keys()],["usage"]);
    const command=commands.get("usage");
    assert.equal(command.getArgumentCompletions,undefined);
    const notices=[], menus=[];
    ctx.ui.notify=message=>notices.push(message);
    ctx.ui.select=async(title,choices)=>{menus.push({title,choices});return "Close";};
    for(const argument of ["refresh","resets","reset"]){
      await command.handler(argument,ctx);
      assert.equal(notices.at(-1),"Use /usage without arguments.");
    }
    assert.equal(menus.length,0);
    assert.equal(requests,0);
    await handlers.get("session_start")({},ctx);
    assert.equal(statuses.at(-1).text,"grey:| OpenAI • ░░░█░░░░ …%");
    for(let n=0;n<100 && !statuses.at(-1).text?.includes("75%");n++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(statuses.at(-1).text,"grey:| OpenAI • ██████░░ 75%");
    assert.equal(colors.at(-1),"dim");
    await command.handler("",ctx);
    assert.deepEqual(menus,[{title:"Subscription usage",choices:["OpenAI • ██████░░ 75%","Anthropic • unavailable","Close"]}]);
    const before=statuses.length;
    const switched=handlers.get("model_select")({model:{provider:"anthropic"}},ctx);
    assert.ok(statuses[before].text === undefined || statuses[before].text.startsWith("grey:| Anthropic • "));
    await switched;
    await handlers.get("model_select")({model:{provider:"openai-codex"}},ctx);
    assert.match(statuses.at(-1).text,/OpenAI/);
    await handlers.get("model_select")({model:{provider:"google"}},ctx);
    assert.equal(statuses.at(-1).text,undefined);
    handlers.get("session_shutdown")();
    assert.equal(requests,0);
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: join(dir, "agent"), PI_OFFLINE: "1", PI_USAGE_REDUCED_MOTION: "1" },
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("lifecycle refresh returns immediately, animates only missing data, and stops on shutdown", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-background-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = `
    import assert from "node:assert/strict";
    import {mkdir,writeFile} from "node:fs/promises";
    import {join} from "node:path";
    import extension from ${JSON.stringify(new URL("../index.ts", import.meta.url).href)};
    const agent=process.env.PI_CODING_AGENT_DIR;
    const token="synthetic."+Buffer.from(JSON.stringify({sub:"user","https://api.openai.com/auth":{chatgpt_account_id:"account"}})).toString("base64url")+".signature";
    await mkdir(agent,{recursive:true});
    await writeFile(join(agent,"auth.json"),JSON.stringify({
      "openai-codex":{type:"oauth",access:token,refresh:"synthetic",expires:Date.now()+3600000},
      anthropic:{type:"oauth",access:"synthetic-claude",refresh:"synthetic",expires:Date.now()+3600000}
    }));
    const handlers=new Map(), statuses=[], notices=[], requests=[];
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitFor=async predicate=>{for(let n=0;n<200;n++){if(predicate())return;await delay(10);}throw new Error("Timed out waiting for status.");};
    const ctx={mode:"tui",hasUI:true,model:{provider:"openai"},modelRegistry:{getProviderAuth:async provider=>({source:"OAuth",auth:{apiKey:provider==="anthropic"?"synthetic-claude":token}})},ui:{theme:{fg:(color,text)=>{assert.equal(color,"dim");return text}},setStatus:(key,text)=>statuses.push(text),notify:message=>notices.push(message)}};
    globalThis.fetch=(input,init)=>new Promise((resolve,reject)=>{
      const request={url:String(input),signal:init.signal,resolve:value=>resolve(new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}}))};
      requests.push(request);
      init.signal.addEventListener("abort",()=>reject(new Error("Synthetic abort")),{once:true});
    });
    extension({on:(event,handler)=>handlers.set(event,handler),registerCommand:()=>{}});
    assert.equal(handlers.get("session_start")({},ctx),undefined);
    assert.equal(statuses.at(-1),"| OpenAI • █░░░░░░░ ⠋%");
    await waitFor(()=>requests.some(r=>r.url.endsWith("/usage")) && requests.some(r=>r.url.endsWith("/profile")));
    await waitFor(()=>statuses.includes("| OpenAI • ░█░░░░░░ ⠹%"));
    const before=statuses.length;
    assert.equal(handlers.get("model_select")({model:{provider:"anthropic"}},ctx),undefined);
    assert.ok(statuses.slice(before).every(text=>text===undefined || text.startsWith("| Anthropic")));
    assert.equal(handlers.get("model_select")({model:{provider:"openai-codex"}},ctx),undefined);
    requests.find(r=>r.url.endsWith("/usage")).resolve({rate_limit:{primary_window:{used_percent:25,limit_window_seconds:604800}}});
    await waitFor(()=>requests.some(r=>r.url.endsWith("/rate-limit-reset-credits")));
    requests.find(r=>r.url.endsWith("/rate-limit-reset-credits")).resolve({credits:[]});
    // Anthropic's request is still pending, but OpenAI must already show its report.
    await waitFor(()=>statuses.at(-1)==="| OpenAI • ██████░░ 75%");
    const settled=statuses.length;
    await delay(200);
    assert.equal(statuses.length,settled,"The animation must stop when quota data arrives.");
    handlers.get("model_select")({model:{provider:"openai"}},ctx);
    assert.equal(statuses.at(-1),"| OpenAI • ██████░░ 75%","Refresh must retain existing bars.");
    handlers.get("model_select")({model:{provider:"anthropic"}},ctx);
    assert.match(statuses.at(-1),/^\\| Anthropic • [█░]{8} [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]%$/);
    handlers.get("model_select")({model:{provider:"google"}},ctx);
    assert.equal(statuses.at(-1),undefined);
    await delay(100); // Allow already-completed cached reads to publish.
    const hidden=statuses.length;
    await delay(200);
    assert.equal(statuses.length,hidden,"Unsupported providers must stop the animation.");
    handlers.get("model_select")({model:{provider:"anthropic"}},ctx);
    handlers.get("session_shutdown")();
    assert.ok(requests.find(r=>r.url.endsWith("/profile")).signal.aborted);
    assert.equal(statuses.at(-1),undefined);
    const stopped=statuses.length;
    await delay(200);
    assert.equal(statuses.length,stopped,"Late completions must not publish after shutdown.");
    assert.deepEqual(notices,[]);
    // A replacement session must not reuse the aborted provider refresh.
    ctx.model={provider:"anthropic"};
    assert.equal(handlers.get("session_start")({},ctx),undefined);
    await waitFor(()=>requests.filter(r=>r.url.endsWith("/profile")).length===2);
    requests.filter(r=>r.url.endsWith("/profile")).at(-1).resolve({account:{uuid:"claude-user"},organization:{uuid:"claude-org"}});
    await waitFor(()=>requests.some(r=>r.url.includes("/api/oauth/usage")));
    requests.find(r=>r.url.includes("/api/oauth/usage")).resolve({five_hour:{utilization:20}});
    await waitFor(()=>statuses.at(-1)?.includes("80%"));
    assert.equal(statuses.at(-1),"| Anthropic • 5h ██████░░ 80%");
    handlers.get("session_shutdown")();
    // A failed first query must clear its placeholder, not animate forever.
    await writeFile(join(agent,"auth.json"),"{}");
    ctx.model={provider:"openai"};
    handlers.get("session_start")({},ctx);
    await delay(100);
    assert.equal(statuses.at(-1),undefined);
    const failed=statuses.length;
    await delay(200);
    assert.equal(statuses.length,failed);
    handlers.get("session_shutdown")();
    const nonInteractive=requests.length;
    handlers.get("session_start")({},{...ctx,mode:"print",hasUI:false});
    await delay(100);
    assert.equal(requests.length,nonInteractive);
    handlers.get("session_shutdown")();
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: join(dir, "agent"), PI_OFFLINE: "1", PI_USAGE_REDUCED_MOTION: "0" },
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("the actual Pi CLI loads the extension and its /usage command offline", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-usage-cli-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const agent = join(dir, "agent");
  await mkdir(agent);
  await writeFile(join(agent, "auth.json"), "{}");
  await writeFile(join(agent, "settings.json"), JSON.stringify({ packages: [], extensions: [] }));
  const cli = fileURLToPath(new URL("../../../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js", import.meta.url));
  const extension = fileURLToPath(new URL("../index.ts", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "-ne", "-e", extension, "-ns", "-np", "-nc", "--no-session", "--no-approve", "--offline", "--no-tools", "-p", "/usage"], {
    cwd: dir,
    env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1" },
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.doesNotMatch(result.stderr + result.stdout, /Failed to load extension|Unknown command|Cannot find module/);
  assert.match(result.stderr + result.stdout, /Legacy Codex quotas need|Claude subscription quotas need|No subscription quota monitor is available/);
});
