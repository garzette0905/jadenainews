import test from 'node:test';
import assert from 'node:assert/strict';
import {startCloudAgent} from '../bridge/cloud-agent.mjs';
test('idle PC never researches news, caches account status, and checks the queue only every ten seconds',async()=>{
  let at=Date.parse('2026-10-13T00:00:00Z'),statuses=0,researches=0;const calls=[];
  const app={async status(){statuses++;return {connected:true,models:[{slug:'test'}]};},async research(){researches++;}};
  const service=await startCloudAgent(app,{loadConfig:async()=>({site:'https://jadenainews.garzette.chatgpt.site',agentSecret:'test',siteToken:'test'}),now:()=>at,fetcher:async(url)=>{calls.push(new URL(url).pathname);return Response.json({job:null});},interval:()=>({unref(){}}),clear:()=>{}});
  // Start-up tick must settle before simulating later elapsed times.
  await new Promise(resolve=>setImmediate(resolve));
  for(let i=0;i<18;i++){at+=10000;await service.tick();}
  assert.equal(researches,0);assert.equal(statuses,1);
  assert.equal(calls.filter(p=>p.endsWith('/claim')).length,19);
  assert.equal(calls.filter(p=>p.endsWith('/heartbeat')).length,4);
  service.stop();at+=30000;await service.tick();assert.equal(researches,0);assert.equal(calls.filter(p=>p.endsWith('/claim')).length,19);
});

const config={site:'https://jadenainews.garzette.chatgpt.site',agentSecret:'test',siteToken:'test'};
const connected={connected:true,models:[{slug:'test'}]};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('an account that was offline reconnects on the next tick instead of waiting five minutes',async()=>{
  let at=1000000,statuses=0;const calls=[];
  const service=await startCloudAgent({status:async()=>++statuses===1?{connected:false}:connected},{loadConfig:async()=>config,now:()=>at,fetcher:async url=>{calls.push(new URL(url).pathname);return Response.json({job:null});},interval:()=>({unref(){}}),clear:()=>{}});
  await settle();at+=10000;await service.tick();
  assert.equal(statuses,2);assert.ok(calls.includes('/api/agent/heartbeat'));assert.ok(calls.includes('/api/agent/claim'));service.stop();
});
test('long research keeps heartbeats and leases alive without refreshing the busy app account',async()=>{
  let at=1000000,statuses=0,resolveResearch;const calls=[];
  const service=await startCloudAgent({status:async()=>{statuses++;if(statuses>1)throw Error('app busy');return connected;},research:()=>new Promise(resolve=>resolveResearch=resolve)},{loadConfig:async()=>config,now:()=>at,fetcher:async(url)=>{const path=new URL(url).pathname;calls.push(path);return Response.json({job:path.endsWith('/claim')?{id:'job',lease:'lease',input:{model:'test'}}:null});},interval:()=>({unref(){}}),clear:()=>{}});
  await settle();for(let i=0;i<36;i++){at+=10000;await service.tick();}
  assert.equal(statuses,1);assert.equal(calls.filter(p=>p.endsWith('/claim')).length,1);assert.equal(calls.filter(p=>p.endsWith('/heartbeat')).length,7);assert.equal(calls.filter(p=>p.endsWith('/progress')).length,18);
  resolveResearch({research:{}});await settle();at+=10000;await service.tick();assert.ok(calls.includes('/api/agent/complete'));assert.equal(service.isBusy(),false);service.stop();
});
test('another local job blocks claims but does not suppress the known PC heartbeat',async()=>{
  let at=1000000,available=true;const calls=[];
  const service=await startCloudAgent({status:async()=>connected},{available:()=>available,loadConfig:async()=>config,now:()=>at,fetcher:async(url)=>{calls.push(new URL(url).pathname);return Response.json({job:null});},interval:()=>({unref(){}}),clear:()=>{}});
  await settle();available=false;at+=60000;await service.tick();assert.equal(calls.filter(p=>p.endsWith('/heartbeat')).length,2);assert.equal(calls.filter(p=>p.endsWith('/claim')).length,1);service.stop();
});
