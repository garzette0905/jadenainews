import {loadAgentConfig} from '../bridge/agent-config.mjs';
const config=await loadAgentConfig();if(!config)throw new Error('PC 연결 설정이 없습니다.');
async function api(path,body){const r=await fetch(config.site+path,{method:body?'POST':'GET',headers:{'OAI-Sites-Authorization':'Bearer '+config.siteToken,...(body?{'Content-Type':'application/json',Origin:config.site}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const result=await r.json();if(!r.ok)throw new Error(result.error||`HTTP ${r.status}`);return result;}
const me=await api('/api/me');if(me.role!=='owner')throw new Error('사이트 관리자 로그인이 필요합니다.');
const runtime=await api('/api/runtime');if(!runtime.connected)throw new Error('PC 프로그램이 오프라인입니다.');
const model=runtime.models.find(m=>m.isDefault)?.slug||runtime.models[0]?.slug;
const job=await api('/api/collect',{model});console.log(JSON.stringify({jobId:job.id,model}));
let last='';for(;;){const result=await api('/api/jobs/'+job.id);if(result.message!==last){console.log(result.message);last=result.message;}if(result.status==='failed')throw new Error(result.error);if(result.status==='completed'){const news=await api('/api/news');console.log(JSON.stringify({completed:true,count:news.ranked.length,top:news.ranked.slice(0,6).map(a=>({rank:a.rank,title:a.titleKo,score:a.score})),warnings:news.warnings.length}));break;}await new Promise(r=>setTimeout(r,10000));}
