import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { zstdCompressSync } from 'node:zlib';
import { test } from 'node:test';
import { WebSocket } from 'undici';
import { normalizeContext } from '@earendil-works/pi-ai';
import { stream } from '@earendil-works/pi-ai/api/openai-responses';
import { createOpenAIWebSocketTransport } from '../agent/lib/openai-websocket.ts';

const require = createRequire(import.meta.resolve('openai'));
const { WebSocketServer } = require('ws');
const endpoint = 'https://api.openai.com/v1/responses';
const model = {
  id: 'gpt-6-astra', name: 'test', provider: 'openai', api: 'openai-responses',
  baseUrl: 'https://api.openai.com/v1', reasoning: true, input: ['text','image'],
  cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow:272000,maxTokens:1000,
};
const payload = {model:model.id,service_tier:'ultrafast',stream:true,store:false,input:[{role:'user',content:'test'}]};
const completed = { type:'response.completed',response:{id:'resp_test',status:'completed',output:[],usage:{input_tokens:5,output_tokens:0,input_tokens_details:{cached_tokens:0}}} };
const sse = event => new Response(`data: ${JSON.stringify(event)}\n\n`,{headers:{'content-type':'text/event-stream'}});
const init = (body=payload, token='synthetic-token') => ({method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});

async function lab(t, behavior={}) {
  const server = createServer();
  const wss = new WebSocketServer({noServer:true});
  const requests=[], handshakes=[], http=[];
  server.on('upgrade',(req,socket,head)=>{
    handshakes.push(req.headers);
    if(behavior.reject){socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>ws.on('message',raw=>{
    const body=JSON.parse(raw.toString());requests.push(body);
    if(behavior.message)behavior.message(ws,body,requests.length);
    else ws.send(JSON.stringify(completed));
  }));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url=`ws://127.0.0.1:${server.address().port}/responses`;
  const transport=createOpenAIWebSocketTransport({
    connect(address,headers){
      assert.equal(address,'wss://api.openai.com/v1/responses');
      return {ok:true,value:new WebSocket(url,{headers:Object.fromEntries(headers)})};
    },
    fetch:async(address,request)=>{http.push({address,request});return sse(completed);},
  });
  const options=overrides=>transport.options(model,{sessionId:'test-session',timeoutMs:1000,...overrides});
  const request=(body=payload,overrides={},token='synthetic-token')=>options(overrides).fetch(endpoint,init(body,token));
  t.after(async()=>{
    transport.close();
    for(const ws of wss.clients)ws.terminate();
    await new Promise(resolve=>wss.close(resolve));
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  });
  return {transport,requests,handshakes,http,options,request};
}

async function consume(response){return (await response.text()).split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));}

test('same session reuses its socket, keeps full context and derives the wire hint',async t=>{
  const l=await lab(t);
  for(let i=0;i<2;i++){
    const response=await l.request();
    assert.equal(response.headers.get('x-pi-transport'),'websocket');
    assert.deepEqual(await consume(response),[completed]);
  }
  assert.equal(l.handshakes.length,1);
  assert.equal(l.handshakes[0]['x-codex-routing-hint'],'model=gpt-6-astra;tier=ultrafast');
  assert.equal(l.handshakes[0].authorization,'Bearer synthetic-token');
  assert.equal(l.handshakes[0]['openai-beta'],undefined,'no legacy Codex protocol header');
  assert.deepEqual(l.requests,[{...payload,type:'response.create',stream:undefined},{...payload,type:'response.create',stream:undefined}].map(x=>JSON.parse(JSON.stringify(x))));
  assert.equal(l.http.length,0);
});

test('model, tier, account/token and arbitrary header changes each require a fresh handshake',async t=>{
  const l=await lab(t);
  for(const [body,token] of [
    [payload,'account-a'],[{...payload,service_tier:'priority'},'account-a'],
    [{...payload,model:'gpt-6.1-sol',service_tier:'priority'},'account-a'],
    [{...payload,model:'gpt-6.1-sol',service_tier:'priority'},'account-b'],
    [{...payload,model:'gpt-6.1-sol',service_tier:'priority'},'account-b-refreshed'],
  ])await consume(await l.request(body,{},token));
  assert.equal(l.handshakes.length,5);
  assert.equal(l.handshakes[4].authorization,'Bearer account-b-refreshed');
  assert.equal(l.handshakes[4]['x-codex-routing-hint'],'model=gpt-6.1-sol;tier=priority');
  const body={...payload,service_tier:undefined};
  await consume(await l.request(body));
  assert.equal(l.handshakes.at(-1)['x-codex-routing-hint'],'model=gpt-6-astra');
  const custom=init(body);custom.headers['openai-organization']='synthetic-org';
  await consume(await l.options().fetch(endpoint,custom));
  assert.equal(l.handshakes.at(-1)['openai-organization'],'synthetic-org');
  assert.equal(l.handshakes.length,7);
});

test('different sessions and overlapping same-session requests do not cross streams',async t=>{
  const l=await lab(t,{message(ws){setTimeout(()=>ws.send(JSON.stringify(completed)),30);}});
  await Promise.all([l.request(),l.request(),l.request(payload,{sessionId:'other-session'})].map(async p=>consume(await p)));
  assert.equal(l.handshakes.length,3);
  assert.equal(l.requests.length,3);
});

test('SSE preference keeps the hint, custom HTTP fetch remains caller-owned, other routes are unchanged',async t=>{
  const l=await lab(t);
  await consume(await l.request(payload,{transport:'sse'}));
  assert.equal(l.handshakes.length,0);
  assert.equal(new Headers(l.http[0].request.headers).get('x-codex-routing-hint'),'model=gpt-6-astra;tier=ultrafast');
  let custom=0;
  await consume(await l.options({fetch:async()=>{custom++;return sse(completed);}}).fetch(endpoint,init()));
  assert.equal(custom,1);
  for(const changed of [{...model,provider:'openai-codex'},{...model,provider:'other'},{...model,api:'openai-completions'},{...model,baseUrl:'https://example.com/v1'}]){
    const original={sessionId:'test',fetch:async()=>sse(completed)};
    assert.equal(l.transport.options(changed,original),original);
  }
  await consume(await l.options().fetch('https://api.openai.com/v1/images/generations',init()));
  assert.equal(l.http.at(-1).address,'https://api.openai.com/v1/images/generations');
  assert.equal(new Headers(l.http.at(-1).request.headers).has('x-codex-routing-hint'),false);
});

test('handshake rejection falls back once with the same HTTP body, but explicit WebSocket does not',async t=>{
  const l=await lab(t,{reject:true});
  await consume(await l.request());
  assert.equal(l.http.length,1);
  assert.deepEqual(JSON.parse(l.http[0].request.body),payload);
  assert.equal(new Headers(l.http[0].request.headers).get('x-codex-routing-hint'),'model=gpt-6-astra;tier=ultrafast');
  await assert.rejects(l.request(payload,{transport:'websocket'}),/handshake/);
  assert.equal(l.http.length,1);
});

test('lost connection after send never replays to SSE, even before visible text',async t=>{
  const l=await lab(t,{message(ws){ws.terminate();}});
  const response=await l.request();
  await assert.rejects(response.text(),/not replayed/);
  assert.equal(l.requests.length,1);assert.equal(l.http.length,0);
});

test('malformed data, binary frames, and an early close fail instead of completing silently',async t=>{
  for(const mode of ['malformed','binary','close'])await t.test(mode,async t=>{
    const l=await lab(t,{message(ws){if(mode==='close')ws.close();else if(mode==='binary')ws.send(Buffer.from('not text'));else ws.send('{');}});
    await assert.rejects((await l.request()).text(),/protocol|stream/);
    assert.equal(l.http.length,0);
  });
});

test('server error frames reach Pi without triggering transport fallback',async t=>{
  const l=await lab(t,{message(ws){ws.send(JSON.stringify({type:'error',status:429,error:{code:'quota_exceeded',message:'Synthetic quota failure',type:'invalid_request_error'}}));}});
  assert.deepEqual(await consume(await l.request()),[{type:'error',code:'quota_exceeded',message:'Synthetic quota failure'}]);
  assert.equal(l.http.length,0);
});

test('abort before connect, during streaming, and reader cancellation close only the affected request',async t=>{
  const l=await lab(t,{message(){}});
  const before=new AbortController();before.abort();
  await assert.rejects(l.request(payload,{signal:before.signal}),/aborted/);
  assert.equal(l.handshakes.length,0);
  const during=new AbortController();
  const response=await l.request(payload,{signal:during.signal});
  during.abort();await assert.rejects(response.text(),/aborted/);
  const next=await l.request();await next.body.cancel();
  assert.equal(l.http.length,0);
});

test('idle timeout fails the stream without a replay; shutdown cancels active streams and can reopen',async t=>{
  const l=await lab(t,{message(){}});
  await assert.rejects((await l.request(payload,{timeoutMs:25})).text(),/timeout/);
  const response=await l.request();l.transport.close();l.transport.close();
  await assert.rejects(response.text(),/shutdown/);
  const next=await l.request();l.transport.close();await assert.rejects(next.text(),/shutdown/);
  assert.equal(l.http.length,0);
});

test('real Pi serializer/parser preserves hooks, Unicode, tool outputs, images and usage',async t=>{
  const l=await lab(t,{message(ws){
    for(const e of [
      {type:'response.output_item.added',output_index:0,item:{type:'message',id:'msg_test',role:'assistant',content:[]}},
      {type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
      {type:'response.output_text.delta',output_index:0,content_index:0,delta:'héllo 🌍'},
      {type:'response.output_item.done',output_index:0,item:{type:'message',id:'msg_test',role:'assistant',content:[{type:'output_text',text:'héllo 🌍',annotations:[]}]}},
      {...completed,response:{...completed.response,usage:{input_tokens:9,output_tokens:4,input_tokens_details:{cached_tokens:2},output_tokens_details:{reasoning_tokens:0}}}},
    ])ws.send(JSON.stringify(e));
  }});
  const events=[];let transportHeader;
  const opts=l.transport.options(model,{
    apiKey:'synthetic-oauth',sessionId:'integration',serviceTier:'priority',reasoningEffort:'low',
    onPayload:body=>({...body,service_tier:'ultrafast'}),
    onResponse:r=>{transportHeader=r.headers['x-pi-transport'];},
    onProviderStreamEvent:event=>events.push(event.type),
  });
  const context=normalizeContext({messages:[{role:'user',content:[{type:'text',text:'test'},{type:'image',data:'aGVsbG8=',mimeType:'image/png'}],timestamp:0}]});
  const result=await stream(model,context,opts).result();
  assert.equal(result.stopReason,'stop',result.errorMessage);
  assert.equal(result.content.find(x=>x.type==='text').text,'héllo 🌍');
  assert.equal(result.usage.output,4);assert.equal(result.usage.cacheRead,2);
  assert.equal(transportHeader,'websocket');assert.ok(events.includes('response.completed'));
  assert.equal(l.handshakes[0]['x-codex-routing-hint'],'model=gpt-6-astra;tier=ultrafast');
  assert.ok(JSON.stringify(l.requests[0].input).includes('data:image/png;base64,aGVsbG8='));
  const toolBody={...payload,input:[...payload.input,{type:'function_call',name:'read',call_id:'call_test',arguments:'{}'},{type:'function_call_output',call_id:'call_test',output:'fixture'}],tools:[{type:'function',name:'read',parameters:{type:'object'}}]};
  await consume(await l.request(toolBody));
  assert.deepEqual(l.requests.at(-1).input,toolBody.input);
  assert.deepEqual(l.requests.at(-1).tools,toolBody.tools);
});

test('compressed Pi requests decode for WebSocket without leaking HTTP encoding headers',async t=>{
  const l=await lab(t);
  const request=init({...payload,background:false});
  request.headers['content-encoding']='zstd';
  request.body=zstdCompressSync(Buffer.from(request.body));
  await consume(await l.options().fetch(endpoint,request));
  assert.deepEqual(l.requests[0].input,payload.input);
  assert.equal(l.requests[0].background,undefined);
  assert.equal(l.handshakes[0]['content-encoding'],undefined);
  assert.equal(l.handshakes[0]['content-type'],undefined);
});

test('caller-scoped proxy settings keep HTTP handling instead of bypassing their route',async t=>{
  const l=await lab(t);
  await consume(await l.request(payload,{env:{HTTPS_PROXY:'http://synthetic-proxy.invalid'}}));
  assert.equal(l.handshakes.length,0);assert.equal(l.http.length,1);
});

// A deterministic socket seam allows deadline tests without a ten-minute wait.
class ManualSocket extends EventTarget {
  readyState=0;
  constructor(){super();queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
  send(){}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
}

test('total deadline cannot be extended by heartbeats; timeoutMs=0 disables only the idle timer',async t=>{
  const socket=new ManualSocket();
  t.mock.timers.enable({apis:['setTimeout']});
  const transport=createOpenAIWebSocketTransport({connect:()=>({ok:true,value:socket})});
  const options=transport.options(model,{sessionId:'deadline',timeoutMs:0});
  const response=await options.fetch(endpoint,init());
  const rejected=assert.rejects(response.text(),/timeout/);
  for(let i=0;i<10;i++){
    socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'response.in_progress'})}));
    t.mock.timers.tick(60_000);
  }
  await rejected;assert.equal(socket.readyState,3);transport.close();
});

test('session disposal cancels an opening handshake without an HTTP fallback',async t=>{
  const socket=new ManualSocket();socket.readyState=0;
  // Make the constructor's queued open event occur before the transport attaches.
  await Promise.resolve();socket.readyState=0;
  const transport=createOpenAIWebSocketTransport({connect:()=>({ok:true,value:socket}),fetch:async()=>{assert.fail('must not fall back after disposal');}});
  const pending=transport.options(model,{sessionId:'opening'}).fetch(endpoint,init());
  transport.close();await assert.rejects(pending,/shutdown/);
});

test('a user abort during handshake never falls back to HTTP',async()=>{
  const socket=new ManualSocket();await Promise.resolve();socket.readyState=0;
  const signal=new AbortController();
  const transport=createOpenAIWebSocketTransport({connect:()=>({ok:true,value:socket}),fetch:async()=>assert.fail('no HTTP after abort')});
  const pending=transport.options(model,{sessionId:'opening',signal:signal.signal}).fetch(endpoint,init());
  signal.abort();await assert.rejects(pending,/aborted/);assert.equal(socket.readyState,3);
});

test('idle sockets expire and the next request opens a new connection',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const sockets=[];
  const transport=createOpenAIWebSocketTransport({connect:()=>{
    const socket=new ManualSocket();sockets.push(socket);
    socket.send=()=>queueMicrotask(()=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(completed)})));
    return {ok:true,value:socket};
  }});
  const request=()=>transport.options(model,{sessionId:'idle'}).fetch(endpoint,init());
  await consume(await request());
  assert.equal(sockets.length,1);assert.equal(sockets[0].readyState,1);
  t.mock.timers.tick(120_000);assert.equal(sockets[0].readyState,3);
  await consume(await request());assert.equal(sockets.length,2);
  transport.close();
});
