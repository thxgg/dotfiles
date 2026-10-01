import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("reset selector renders identical unnumbered labels but returns the selected value", () => {
  const script = `
    import assert from "node:assert/strict";
    import {initTheme} from "@earendil-works/pi-coding-agent";
    import {getKeybindings,visibleWidth} from "@earendil-works/pi-tui";
    import {selectLabeled} from ${JSON.stringify(new URL("../index.ts", import.meta.url).href)};
    initTheme("dark",false);
    let component, renders=0, dialogs=0;
    const ctx={mode:"tui",ui:{
      custom:factory=>{dialogs++;return new Promise(resolve=>{component=factory({requestRender:()=>renders++},{fg:(_color,text)=>text,bold:text=>text},getKeybindings(),resolve);});},
      select:()=>{throw new Error("TUI must not select duplicate labels by text.");},
      notify:()=>{}
    }};
    const values=["reset:0","reset:1","Back"], labels=["Reset","Reset","Back"];
    for(const down of ["\\x1b[B","j"]){
      const pending=selectLabeled(ctx,"Anthropic Resets",values,labels,new AbortController().signal);
      for(const width of [24,80]){
        const lines=component.render(width);
        assert.ok(lines.every(line=>visibleWidth(line)<=width));
        assert.doesNotMatch(lines.join("\\n"),/reset:|Reset [0-9]/);
        assert.equal(lines.filter(line=>line.trim()==="Reset" || line.trim()==="→ Reset").length,2);
      }
      component.handleInput(down);
      component.handleInput("\\r");
      assert.equal(await pending,"reset:1");
      component.dispose();
    }
    assert.ok(renders>0);
    for(const cancel of ["\\x1b","\\x03"]){
      const pending=selectLabeled(ctx,"OpenAI Resets",values,labels,new AbortController().signal);
      component.handleInput(cancel);
      assert.equal(await pending,undefined);
      component.dispose();
    }
    const lifetime=new AbortController();
    const pending=selectLabeled(ctx,"OpenAI Resets",values,labels,lifetime.signal);
    lifetime.abort();
    component.handleInput("\\r");
    assert.equal(await pending,undefined);
    component.dispose();
    const count=dialogs;
    assert.equal(await selectLabeled(ctx,"OpenAI Resets",values,labels,lifetime.signal),undefined);
    assert.equal(dialogs,count);
    const warnings=[];
    const rpc={mode:"rpc",ui:{notify:message=>warnings.push(message),select:async()=>"Back"}};
    assert.equal(await selectLabeled(rpc,"Resets",values,labels,new AbortController().signal),undefined);
    assert.equal(warnings.length,1);
    assert.equal(await selectLabeled(rpc,"Resets",["reset:0","back"],["Reset","Back"],new AbortController().signal),"back");
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    env: { ...process.env, PI_OFFLINE: "1" }, encoding: "utf8", timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
