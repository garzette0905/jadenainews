import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {decode} from './discovery.mjs';
import {WINDOWS,SOURCES,basicArticle,canonical} from '../shared/news.mjs';
const plain=s=>decode(String(s||'').replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const meta=(html,key)=>{
 for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const name=(tag.match(/(?:property|name|itemprop)=["']([^"']+)["']/i)||[])[1];if(name===key)return decode((tag.match(/content=["']([^"']*)["']/i)||[])[1]);}return '';
};
export function referenceCandidate(target,feed){return {...target,...feed,url:target.url,reference:true,query:target.query,title:feed?.title||target.title||target.query,dateEvidence:feed?'publisher-feed':'reference-list'};}
export function pageEvidence(html,candidate,now=Date.now()){
 const publishedTime=(html.match(/<time\b(?=[^>]*\bitemprop=["']datePublished["'])[^>]*\bdatetime=["']([^"']+)["']/i)||[])[1];
 const pressDate=()=>plain(html.match(/<span\b[^>]*\bclass=["'][^"']*\bnews-publish-date\b[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1]);
 const visibleDate=()=>plain(html).match(/\b(?:Published on|Date) ([A-Z][a-z]+ \d{1,2}, \d{4})\b/)?.[1];
 const raw=meta(html,'article:published_time')||meta(html,'datePublished')||meta(html,'publication_date')||meta(html,'date-published')||decode((html.match(/"datePublished"\s*:\s*"([^"]+)"/)||[])[1])||publishedTime||pressDate()||candidate.publishedAt||visibleDate();
 const at=Date.parse(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(raw)?`${raw} UTC`:raw);
 if(!Number.isFinite(at)||at>now+300000||now-at>WINDOWS[candidate.kind]*3600000)throw new Error('원문·피드의 발행일을 확인할 수 없거나 조회 기간 밖입니다.');
 const title=plain(meta(html,'og:title')||meta(html,'twitter:title')||(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||candidate.title||candidate.query).slice(0,500);
 const summary=plain(meta(html,'og:description')||meta(html,'description')||candidate.summary).slice(0,1200);
 const cleaned=html.replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi,' ');
 const schemaBody=(cleaned.match(/<([a-z][\w:-]*)\b[^>]*(?:itemprop=["']articleBody["']|id=["']article-view-content-div["'])[^>]*>([\s\S]*?)<\/\1>/i)||[])[2];
 const articleBodies=[...cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m=>m[1]).sort((a,b)=>b.length-a.length);
 const body=schemaBody||articleBodies[0]||(cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)||[])[1]||cleaned;
 if(!title)throw new Error('원문 제목이 없습니다.');
 return {...candidate,url:canonical(candidate.url),title,publishedAt:new Date(at).toISOString(),summary,content:plain(body).slice(0,6000),dateEvidence:raw===candidate.publishedAt?(candidate.dateEvidence||'publisher-feed'):'original-page',verification:'http-original'};
}
export async function fetchEvidence(candidates,{now=Date.now(),fetcher=fetch,progress=()=>{},cache={},redirect='follow'}={}){
 const evidence=new Map(),warnings=[];let next=0,finished=0;
 await Promise.all(Array.from({length:6},async()=>{while(next<candidates.length){const candidate=candidates[next++];try{
  const signature=JSON.stringify([candidate.title,candidate.summary,candidate.publishedAt,candidate.kind,!!candidate.reference]),entry=cache[candidate.url];
  if(entry&&entry.signature===signature&&now>=entry.at&&now-entry.at<6*3600000){evidence.set(candidate.url,entry.row);continue;}
  const r=await fetcher(candidate.url,{redirect,signal:AbortSignal.timeout(15000),headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Jaden-AI-News/3.0'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const html=await r.text();if(html.length>3000000)throw new Error('원문이 너무 큽니다.');const row=pageEvidence(html,candidate,now);evidence.set(candidate.url,row);cache[candidate.url]={at:now,signature,row};
 }catch(e){warnings.push(`${candidate.publisher}: ${candidate.title||candidate.query} — 직접 원문 확인 실패 (${e.message}), 웹 검색으로 보완합니다.`);}finally{finished++;progress(`원문 직접 확인 ${finished}/${candidates.length} · 발행일 확인 ${evidence.size}개`);}}}));return {evidence,warnings};
}

export async function verifyPrioritySearchResults(rows,coverage,consulted,{now=Date.now(),feedback=[],fetcher=fetch}={}){
 const sources=SOURCES.filter(([publisher])=>coverage.some(c=>c.publisher===publisher&&c.needed>0));
 const candidates=new Map();
 for(const article of rows.slice(0,40)){
  try{
   const url=canonical(article.url),parsed=new URL(url);
   if(consulted.has(url)||parsed.protocol!=='https:'||parsed.port)continue;
   const source=sources.find(([publisher,domain])=>parsed.hostname===domain||parsed.hostname.endsWith('.'+domain)||(
     publisher==='Anthropic'&&['claude.com','www.claude.com'].includes(parsed.hostname)));
   if(source)candidates.set(url,{url,title:parsed.pathname,publisher:source[0],kind:source[2]});
  }catch{/* Ignore malformed or untrusted search leads. */}
 }
 // Search-only events may omit page URLs. Verify those leads against the publisher without following redirects.
 const {evidence}=await fetchEvidence([...candidates.values()].slice(0,20),{now,fetcher,redirect:'error'});
 return [...evidence.values()].map(row=>basicArticle(row,feedback,now)).filter(Boolean);
}

// A saved preference may reference an old article; it never becomes a dated news candidate.
export async function readPreferenceArticles(feedback,{now=Date.now(),fetcher=fetch}={}){
 const pending=feedback.filter(f=>f.vote===1&&(!f.title||!f.summary)&&now-Date.parse(f.updatedAt)<=60*86400000&&(!f.checkedAt||now-Date.parse(f.checkedAt)>=86400000))
   .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,10);
 const updates=[];let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<pending.length){const f=pending[next++];try{
   let url=canonical(f.url),r;
   for(let redirects=0;redirects<=3;redirects++){
     const host=new URL(url).hostname.toLowerCase();if(!host.includes('.')||/^[\d.]+$/.test(host)||host.startsWith('[')||/(?:^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host))throw new Error('공개 기사 주소만 확인합니다.');
     r=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Jaden-AI-News/3.0'}});
     if(r.status>=300&&r.status<400){if(redirects===3||!r.headers.get('location'))throw new Error('리다이렉트 확인 실패');url=canonical(new URL(r.headers.get('location'),url).href);continue;}break;
   }
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   // Bound the body before decoding, including servers without Content-Length.
   const reader=r.body.getReader(),chunks=[];let length=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>3000000)throw new Error('원문이 너무 큽니다.');chunks.push(value);}}finally{await reader.cancel();}
   const html=await new Blob(chunks).text();
   const title=plain(meta(html,'og:title')||(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]).slice(0,250);
   const cleaned=html.replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi,' '),article=(cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)||[])[1];
   const summary=plain(meta(html,'og:description')||meta(html,'description')||article||'').slice(0,1500);
   if(!title||summary.length<40)throw new Error('기사 내용을 확인할 수 없습니다.');
   updates.push({url:f.url,updatedAt:f.updatedAt,title,summary,publisher:new URL(url).hostname,contentStatus:'ready',checkedAt:new Date(now).toISOString()});
 }catch{updates.push({url:f.url,updatedAt:f.updatedAt,contentStatus:'failed',checkedAt:new Date(now).toISOString()});}}}));
 return updates;
}

const evidenceFile=new URL('../.runtime/evidence-cache.json',import.meta.url);
export async function readEvidenceCache(){try{return JSON.parse(await readFile(evidenceFile,'utf8'));}catch{return {};}}
export async function writeEvidenceCache(cache,now){
 const entries=Object.entries(cache).filter(([,v])=>now>=v.at&&now-v.at<6*3600000).sort((a,b)=>b[1].at-a[1].at).slice(0,500);
 await mkdir(new URL('../.runtime/',import.meta.url),{recursive:true});await writeFile(evidenceFile,JSON.stringify(Object.fromEntries(entries)));
}
