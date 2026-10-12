import test from 'node:test';
import assert from 'node:assert/strict';
import {startCloudAgent} from '../bridge/cloud-agent.mjs';
test('idle PC never researches news, caches account status, and checks the queue only every thirty seconds',async()=>{
  let at=Date.parse('2026-10-13T00:00:00Z'),statuses=0,researches=0;const calls=[];
  const app={async status(){statuses++;return {connected:true,models:[{slug:'test'}]};},async research(){researches++;}};
  const service=await startCloudAgent(app,{loadConfig:async()=>({site:'https://jadenainews.garzette.chatgpt.site',agentSecret:'test',siteToken:'test'}),now:()=>at,fetcher:async(url)=>{calls.push(new URL(url).pathname);return Response.json({job:null});},interval:()=>({unref(){}}),clear:()=>{}});
  // Start-up tick must settle before simulating later elapsed times.
  await new Promise(resolve=>setImmediate(resolve));
  for(let i=0;i<18;i++){at+=10000;await service.tick();}
  assert.equal(researches,0);assert.equal(statuses,1);
  assert.equal(calls.filter(p=>p.endsWith('/claim')).length,7);
  assert.equal(calls.filter(p=>p.endsWith('/heartbeat')).length,3);
  service.stop();at+=30000;await service.tick();assert.equal(researches,0);assert.equal(calls.filter(p=>p.endsWith('/claim')).length,7);
});
