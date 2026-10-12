import {loadAgentConfig} from './agent-config.mjs';
const SITE='https://jadenainews.garzette.chatgpt.site';
export async function startCloudAgent(app,{available=()=>true}={}){const config=await loadAgentConfig();if(!config)return {stop(){},configured:false};if(config.site!==SITE)throw new Error('PC 연결 대상 사이트가 일치하지 않습니다.');
  let running=false,stopped=false,lastHeartbeat=0,account=null,pendingResult=null,currentJob=null,lastMessage='조사 준비 중';
  async function send(path,data){const r=await fetch(SITE+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.agentSecret,'OAI-Sites-Authorization':'Bearer '+config.siteToken},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});const result=await r.json();if(!r.ok)throw new Error(result.error||'사이트 PC 연결 실패');return result;}
  async function pulse(){if(stopped)return;if(!available())return;try{if(Date.now()-lastHeartbeat>10000){account=await app.status();if(!account.connected)return;await send('/api/agent/heartbeat',{models:account.models,planType:account.planType});lastHeartbeat=Date.now();}
      if(pendingResult){await send('/api/agent/complete',pendingResult);pendingResult=null;currentJob=null;running=false;return;}
      if(currentJob){await send('/api/agent/progress',{id:currentJob.id,lease:currentJob.lease,message:lastMessage});}
      if(running)return;const {job}=await send('/api/agent/claim',{});if(!job)return;running=true;currentJob=job;if(!account.models.some(m=>m.slug===job.input.model)){pendingResult={id:job.id,lease:job.lease,error:'요청한 모델이 현재 앱 계정에서 지원되지 않습니다.'};return;}
      app.research(job.input,message=>lastMessage=message).then(result=>{pendingResult={id:job.id,lease:job.lease,result};}).catch(e=>{pendingResult={id:job.id,lease:job.lease,error:e.message||'앱 조사 실패'};});
    }catch(e){console.error('모바일 연결:',e.message);}}
  let pulsing=false;const tick=()=>{if(pulsing||stopped)return;pulsing=true;pulse().finally(()=>pulsing=false);};const timer=setInterval(tick,5000);timer.unref();tick();return {configured:true,stop(){stopped=true;clearInterval(timer);},isBusy:()=>running};}
