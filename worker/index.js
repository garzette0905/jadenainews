import {canonical,rankArticles,validateResearch} from '../shared/news.mjs';
import {handleAgent,agentStatus,enqueueCollection,collectionStatus} from './broker.mjs';
const ASSETS = /* ASSETS */ {};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const empty=()=>({revision:0,articles:[],feedback:[],warnings:[],profile:'',collectedAt:null});
async function keyFor(user){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user));return 'news/'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0'))+'.json';}
async function read(bucket,key){const obj=await bucket.get(key);return {state:obj?await obj.json():empty(),etag:obj?.etag};}
async function change(bucket,key,fn){for(let i=0;i<4;i++){const {state,etag}=await read(bucket,key);const next=await fn(state);const put=await bucket.put(key,JSON.stringify(next),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(put)return next;}throw Object.assign(new Error('다른 변경과 겹쳤습니다. 화면을 다시 불러오세요.'),{status:409});}
async function body(request){if(Number(request.headers.get('content-length'))>250000)throw new Error('요청이 너무 큽니다.');const text=await request.text();if(text.length>250000)throw new Error('요청이 너무 큽니다.');return JSON.parse(text);}
function updateVote(s,row){const list=s.feedback.filter(f=>f.url!==row.url);if(row.vote)list.push(row);return {...s,feedback:list.slice(-400),revision:s.revision+1};}
export default {async fetch(request,env){const url=new URL(request.url),path=url.pathname;
  if(ASSETS[path]&&request.method==='GET'){const [type,content]=ASSETS[path];return new Response(content,{headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'"}});}
  if(!path.startsWith('/api/'))return json({error:'경로를 찾을 수 없습니다.'},404);
  if(path.startsWith('/api/agent/'))return handleAgent(request,env);
  const user=request.headers.get('oai-authenticated-user-id')||(env.LOCAL_PREVIEW==='1'?'preview-owner':null);
  if(!user)return json({error:'ChatGPT로 사이트에 로그인해야 합니다.'},401);
  if(!env.BUCKET)return json({error:'사이트 저장소가 연결되지 않았습니다.'},503);
  try{const key=await keyFor(user);
    if(request.method==='GET'&&path==='/api/runtime')return json(await agentStatus(env));
    if(request.method==='GET'&&path.startsWith('/api/jobs/'))return json(await collectionStatus(env,key,path.slice(10)));
    if(request.method==='GET'&&['/api/state','/api/news'].includes(path)){const {state}=await read(env.BUCKET,key);return json(path==='/api/news'?{...state,ranked:rankArticles(state.articles,state.feedback),scoredAt:new Date().toISOString()}:state);}
    if(request.method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405);
    if(request.headers.get('origin')!==url.origin)return json({error:'같은 사이트에서 요청해야 합니다.'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON 요청이 필요합니다.'},415);
    const data=await body(request),now=new Date().toISOString();
    if(path==='/api/collect')return json(await enqueueCollection(env,key,data),202);
    if(path==='/api/feedback'){const u=canonical(data.url),vote=data.vote;if(![-1,0,1].includes(vote))throw new Error('평가는 -1, 0, 1만 가능합니다.');return json(await change(env.BUCKET,key,s=>updateVote(s,{url:u,vote,title:String(data.title||'').slice(0,250),summary:String(data.summary||'').slice(0,1500),updatedAt:now})));}
    if(path==='/api/likes'){if(!Array.isArray(data.urls)||!data.urls.length||data.urls.length>10)throw new Error('한 번에 1~10개까지 등록할 수 있습니다.');const urls=[...new Set(data.urls.map(canonical))];return json(await change(env.BUCKET,key,s=>{let next=s;for(const u of urls){const a=s.articles.find(a=>a.url===u);next=updateVote(next,{url:u,vote:1,title:a?.title||'',summary:a?.summary||'',updatedAt:now,origin:'submit'});}return next;}));}
    if(path==='/api/collection'){if(data.searchExecuted!==true)throw new Error('실제 웹 검색을 수행한 결과만 저장할 수 있습니다.');if(!Number.isFinite(Date.parse(data.requestedAt))||Date.parse(data.requestedAt)>Date.now()+300000)throw new Error('수집 요청 시각이 올바르지 않습니다.');const result=validateResearch(data.research,data.consulted,Date.parse(data.requestedAt));return json(await change(env.BUCKET,key,s=>{if(data.revision!==s.revision)throw Object.assign(new Error('조사 중 취향이 변경되었습니다. 새 취향으로 다시 수집하세요.'),{status:409});if(s.requestedAt&&Date.parse(s.requestedAt)>=Date.parse(data.requestedAt))throw Object.assign(new Error('더 최신 조사 결과가 이미 저장되어 있습니다.'),{status:409});return {...s,...result,collectedAt:now,requestedAt:data.requestedAt,model:String(data.model||'ChatGPT').slice(0,100),consulted:data.consulted.slice(0,300),revision:s.revision+1};}));}
    return json({error:'경로를 찾을 수 없습니다.'},404);
  }catch(e){return json({error:e.message||'요청 처리 실패'},e.status||400);}
}};
