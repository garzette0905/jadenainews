import {decode} from './discovery.mjs';
import {WINDOWS,canonical} from '../shared/news.mjs';
const plain=s=>decode(String(s||'').replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const meta=(html,key)=>{
 for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const name=(tag.match(/(?:property|name|itemprop)=["']([^"']+)["']/i)||[])[1];if(name===key)return decode((tag.match(/content=["']([^"']*)["']/i)||[])[1]);}return '';
};
export function pageEvidence(html,candidate,now=Date.now()){
 const raw=meta(html,'article:published_time')||meta(html,'datePublished')||decode((html.match(/"datePublished"\s*:\s*"([^"]+)"/)||[])[1])||candidate.publishedAt;
 const at=Date.parse(raw);if(!Number.isFinite(at)||at>now+300000||now-at>WINDOWS[candidate.kind]*3600000)throw new Error('원문·피드의 발행일을 확인할 수 없거나 조회 기간 밖입니다.');
 const title=plain(meta(html,'og:title')||meta(html,'twitter:title')||(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||candidate.title||candidate.query).slice(0,500);
 const summary=plain(meta(html,'og:description')||meta(html,'description')||candidate.summary).slice(0,1200);
 const cleaned=html.replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi,' ');
 const schemaBody=(cleaned.match(/<([a-z][\w:-]*)\b[^>]*(?:itemprop=["']articleBody["']|id=["']article-view-content-div["'])[^>]*>([\s\S]*?)<\/\1>/i)||[])[2];
 const articleBodies=[...cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m=>m[1]).sort((a,b)=>b.length-a.length);
 const body=schemaBody||articleBodies[0]||(cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)||[])[1]||cleaned;
 if(!title)throw new Error('원문 제목이 없습니다.');
 return {...candidate,url:canonical(candidate.url),title,publishedAt:new Date(at).toISOString(),summary,content:plain(body).slice(0,16000),dateEvidence:raw===candidate.publishedAt?'publisher-feed':'original-page',verification:'http-original'};
}
export async function fetchEvidence(candidates,{now=Date.now(),fetcher=fetch,progress=()=>{}}={}){
 const evidence=new Map(),warnings=[];let next=0,finished=0;
 await Promise.all(Array.from({length:6},async()=>{while(next<candidates.length){const candidate=candidates[next++];try{
  const r=await fetcher(candidate.url,{signal:AbortSignal.timeout(15000),headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Jaden-AI-News/3.0'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const html=await r.text();if(html.length>3000000)throw new Error('원문이 너무 큽니다.');evidence.set(candidate.url,pageEvidence(html,candidate,now));
 }catch(e){warnings.push(`${candidate.publisher}: ${candidate.title||candidate.query} — 직접 원문 확인 실패 (${e.message}), 웹 검색으로 보완합니다.`);}finally{finished++;progress(`원문 직접 확인 ${finished}/${candidates.length} · 발행일 확인 ${evidence.size}개`);}}}));return {evidence,warnings};
}
