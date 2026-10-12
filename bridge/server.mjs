import {createServer} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {AppClient} from './app-client.mjs';
const SITE='https://jadenainews.garzette.chatgpt.site',ORIGINS=new Set([SITE,'http://localhost:8788']);
const pair=randomBytes(32).toString('base64url'),app=new AppClient();let attached=true,active=false;const jobs=new Map();
const status=()=>attached?app.status():Promise.resolve({connected:false,mode:'app',email:'',models:[]});
function json(res,data,status=200,origin){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>250000)throw new Error('요청이 너무 큽니다.');}return JSON.parse(text||'{}');}
const html=(res,text)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(text);};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=(title,text)=>`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px/1.8 Arial,'Malgun Gothic',sans-serif;max-width:640px;margin:80px auto;padding:24px}h1{font-size:28px}a{display:inline-block;border:1px solid #ccc;border-radius:24px;padding:8px 20px;color:#111;text-decoration:none}p{color:#555}</style><h1>${title}</h1>${text}</html>`;
const server=createServer(async(req,res)=>{let origin=req.headers.origin;try{
  if(req.headers.host!=='127.0.0.1:1455')return json(res,{error:'허용되지 않은 호스트입니다.'},403);
  const url=new URL(req.url,'http://127.0.0.1:1455');
  if(url.pathname==='/'&&req.method==='GET'){return html(res,page('Jaden AI News 앱 연결','<p>PC 실행 프로그램이 켜져 있습니다. 현재 ChatGPT/Codex 앱에 로그인된 계정을 공식 App Server로 연결합니다. 별도의 요금제 OAuth 팝업은 필요하지 않습니다.</p><a href="'+SITE+'/#bridge='+pair+'">Sites 뉴스 화면 연결</a><p>Sites에 처음 로그인한 경우, 로그인 완료 후 이 페이지로 돌아와 위 연결 버튼을 다시 누르세요.</p><p>개발 미리보기: <a href="http://localhost:8788/#bridge='+pair+'">로컬 화면 연결</a></p>'));}
  if(!ORIGINS.has(origin))return json(res,{error:'허용된 뉴스 화면에서 요청하세요.'},403);
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Jaden-Pair','Access-Control-Allow-Private-Network':'true',Vary:'Origin'});res.end();return;}
  // Only the exact, owner-private Sites origin (or local preview) can pair. Never accept arbitrary origins.
  if(url.pathname==='/pair'&&req.method==='GET')return json(res,{key:pair},200,origin);
  const supplied=Buffer.from(String(req.headers['x-jaden-pair']||'')),expected=Buffer.from(pair);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json(res,{error:'실행 프로그램 화면에서 Sites 연결 버튼을 누르세요.'},401,origin);
  if(url.pathname==='/status'&&req.method==='GET')return json(res,await status(),200,origin);
  if(url.pathname.startsWith('/jobs/')&&req.method==='GET'){const j=jobs.get(url.pathname.slice(6));return json(res,j||{error:'조사 작업을 찾을 수 없습니다.'},j?200:404,origin);}
  if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))return json(res,{error:'JSON POST 요청이 필요합니다.'},405,origin);
  const input=await body(req);
  if(url.pathname==='/auth/start'){if(active)throw new Error('조사 중에는 계정을 변경할 수 없습니다.');attached=true;const s=await status();if(!s.connected)throw new Error('먼저 ChatGPT/Codex 앱에 로그인한 뒤 앱 계정 연결을 누르세요.');return json(res,s,200,origin);}
  if(url.pathname==='/app/open'){spawn(process.env.JADEN_CODEX_BIN||'codex',['app'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});return json(res,{ok:true},200,origin);}
  if(url.pathname==='/auth/logout'){if(active)throw new Error('조사 중에는 연결을 해제할 수 없습니다.');attached=false;app.close();jobs.clear();return json(res,{ok:true},200,origin);}
  if(url.pathname==='/collect'){if(active)return json(res,{error:'이미 조사 중입니다. 완료 후 다시 요청하세요.'},409,origin);if(!Array.isArray(input.feedback)||input.feedback.length>400||!Array.isArray(input.previous)||input.previous.length>40||!Number.isFinite(Date.parse(input.now)))throw new Error('조사 입력을 확인하세요.');const s=await status();if(!s.connected)throw new Error('앱 계정을 연결하세요.');if(!s.models.some(m=>m.slug===input.model))throw new Error('현재 계정에 허용된 모델을 선택하세요.');const id=randomUUID();active=true;const job={id,status:'running',message:'ChatGPT 앱에서 웹 조사를 시작합니다.'};jobs.set(id,job);for(const [key,value]of jobs)if(value.finishedAt&&value.finishedAt<Date.now()-30*60000)jobs.delete(key);json(res,{id},202,origin);
    app.research(input,message=>job.message=message).then(result=>Object.assign(job,{status:'completed',result,message:'조사 완료'})).catch(e=>Object.assign(job,{status:'failed',error:e.message||'조사 실패'})).finally(()=>{active=false;job.finishedAt=Date.now();});return;}
  return json(res,{error:'경로를 찾을 수 없습니다.'},404,origin);
}catch(e){json(res,{error:e.message||'실행 프로그램 오류'},400,ORIGINS.has(origin)?origin:null);}});
server.listen(1455,'127.0.0.1',()=>console.log('Jaden AI News 실행 프로그램: http://127.0.0.1:1455/'));
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'1455 포트가 사용 중입니다. 기존 실행 프로그램을 종료한 뒤 다시 실행하세요.':'실행 프로그램을 시작하지 못했습니다.');process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.close();server.close(()=>process.exit(0));});
