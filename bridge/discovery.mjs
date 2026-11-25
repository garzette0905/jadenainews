import {agentTopicBonus,canonical,prioritySourceGroup,reserveSourceCandidates,WINDOWS,SOURCES} from '../shared/news.mjs';

export const FEEDS = [
 ['AI타임스','https://www.aitimes.com/rss/allArticle.xml','news'],
 ['인공지능신문','https://www.aitimes.kr/rss/allArticle.xml','news'],
 ['지디넷코리아','https://zdnet.co.kr/feed','news'],
 ['전자신문','https://rss.etnews.com/04046.xml','news'],
 ['TechCrunch','https://techcrunch.com/category/artificial-intelligence/feed/','news'],
 ['The Verge','https://www.theverge.com/rss/ai-artificial-intelligence/index.xml','news'],
 ['MIT Technology Review','https://www.technologyreview.com/topic/artificial-intelligence/feed','news'],
 ['Bloomberg','https://feeds.bloomberg.com/technology/news.rss','news'],
 ['9to5Google','https://9to5google.com/feed/','news'],
 ['WIRED','https://www.wired.com/feed/rss','news'],
 ['Ars Technica','https://feeds.arstechnica.com/arstechnica/technology-lab','news'],
 ['VentureBeat','https://venturebeat.com/category/ai/feed/','news'],
 ['The Decoder','https://the-decoder.com/feed/','news'],
 ['CNBC','https://www.cnbc.com/id/19854910/device/rss/rss.html','news'],
 ['OpenAI','https://openai.com/news/rss.xml','official'],
 ['Google AI · Gemini','https://blog.google/technology/ai/rss/','official'],
 ['Google DeepMind','https://deepmind.google/blog/rss.xml','official'],
 ['NVIDIA','https://blogs.nvidia.com/feed/','official'],
 ['Hugging Face','https://huggingface.co/blog/feed.xml','official'],
 ['McKinsey','https://www.mckinsey.com/insights/rss','report'],
 ['Meta Newsroom','https://about.fb.com/news/category/technologies/feed/','official'],
 ['Simon Willison','https://simonwillison.net/atom/everything/','news'],
 ['Latent Space','https://www.latent.space/feed','news'],
 ['The New Stack','https://thenewstack.io/category/ai/feed/','news']
];
export const LISTINGS = [
 ['Anthropic','https://www.anthropic.com/news','official',/^\/(?:(?:news|research|engineering)\/[^/]+|claude-[^/]+)\/?$/],
 ['Anthropic','https://claude.com/resources/articles','official',/^\/(?:blog|resources\/articles)\/[^/]+\/?$/],
 ['Meta AI','https://ai.meta.com/blog/','official',/^\/blog\/[^/]+\/?$/],
 ['McKinsey','https://www.mckinsey.com/capabilities/tech-and-ai/our-insights','report',/\/our-insights\/[^/]+\/?$/],
 ['BCG','https://www.bcg.com/capabilities/artificial-intelligence/insights','report',/^\/publications\/\d{4}\/[^/]+\/?$/],
 ['Bain','https://www.bain.com/insights/','report',/^\/insights\/[^/]+\/?$/],
 ['Deloitte','https://www.deloitte.com/us/en/services/consulting/collections/ai-engineering-insights.html','report',/^\/(?:us|global)\/en\/(?:insights|services)\/.*\.html$/],
 ['Accenture','https://newsroom.accenture.com/news/','report',/^\/news\/\d{4}\/[^/]+\/?$/],
 ['Section','https://www.sectionai.com/blog','report',/^\/blog\/[^/]+\/?$/],
 ['Gartner','https://www.gartner.com/en/newsroom/press-releases','report',/^\/en\/newsroom\/press-releases\/\d[^/]+\/?$/],
 ['The New Stack','https://thenewstack.io/category/ai/','news',/^\/(?!category\/|page\/|tag\/|author\/)[a-z0-9]+(?:-[a-z0-9]+){2,}\/?$/],
 ['InfoQ','https://www.infoq.com/ai-ml-data-eng/news/','news',/^\/news\/\d{4}\/\d{2}\/[^/]+\/?$/]
];
export const decode=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[n]));
const clean=s=>decode(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const tag=(s,n)=>(s.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`,'i'))||[])[1]||'';
export function parseCandidates(xml,[publisher,feed,kind],now=Date.now()){
 const items=[];for(const block of xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi)||[]){
  try{const url=canonical(decode(tag(block,'link')).trim()||(block.match(/<link\b[^>]*href=["']([^"']+)["']/i)||[])[1]);
   const domain=SOURCES.find(s=>s[0]===publisher)?.[1]||new URL(feed).hostname.replace(/^www\./,'');const host=new URL(url).hostname.replace(/^www\./,'');
   if(host!==domain&&!host.endsWith('.'+domain))continue;
   const raw=clean(tag(block,'pubDate')||tag(block,'published')||tag(block,'dc:date'));
   const dated=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)?raw.replace(' ','T')+'+09:00':raw;
   const at=Date.parse(dated);if(!Number.isFinite(at)||at>now+300000||now-at>WINDOWS[kind]*3600000)continue;
   const title=clean(tag(block,'title'));if(!title)continue;
   items.push({url,title,publisher,kind,publishedAt:new Date(at).toISOString(),summary:clean(tag(block,'description')||tag(block,'summary')).slice(0,700),discoveredFrom:feed});
  }catch{/* Malformed entries cannot suppress other feed items. */}
 }return items;
}
export function parseListing(html,[publisher,listing,kind,path]){
 const articles=new Map(),host=new URL(listing).hostname.replace(/^www\./,'');
 const links=html.replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi,'').matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
 for(const [,href,label] of links){
  try{
   const parsed=new URL(decode(href),listing);
   if(parsed.hostname.replace(/^www\./,'')!==host||!path.test(parsed.pathname)||parsed.pathname===new URL(listing).pathname)continue;
   parsed.search='';parsed.hash='';
   const url=canonical(parsed),title=clean(label).slice(0,500);
   if(!title||articles.has(url))continue;
   articles.set(url,{url,title,publisher,kind,discoveredFrom:listing});
  }catch{/* A malformed link does not affect the rest of the listing. */}
 }
 return [...articles.values()].slice(0,24);
}
export function selectCandidates(articles,limit){
 const sorted=[...articles].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0));
 const consulting=sorted.filter(a=>prioritySourceGroup(a.url)==='consulting');
 const byPublisher=Object.values(Object.groupBy(consulting,a=>a.publisher));
 const diversified=[];
 for(let i=0;i<Math.max(0,...byPublisher.map(rows=>rows.length));i++){
  for(const rows of byPublisher)if(rows[i])diversified.push(rows[i]);
 }
 // Keep recent priority-source items and their undated listing leads for original-page verification.
 const topical=sorted.filter(a=>agentTopicBonus(a)||a.publisher==='Meta AI').slice(0,24);
 const candidates=[...new Set([...diversified.slice(0,45),...topical,...sorted])];
 return reserveSourceCandidates(candidates,limit,45).sort((a,b)=>Number(!!prioritySourceGroup(b.url))-Number(!!prioritySourceGroup(a.url)));
}
export async function discoverCandidates({now=Date.now(),fetcher=fetch}={}){
 const sources=[...FEEDS,...LISTINGS],results=[];let next=0;
 await Promise.all(Array.from({length:6},async()=>{while(next<sources.length){
  const index=next++,source=sources[index],listing=!!source[3];
  try{
   const accept=listing?'text/html,application/xhtml+xml':'application/rss+xml,application/atom+xml,application/xml,text/xml';
   const r=await fetcher(source[1],{headers:{Accept:accept,'User-Agent':'Jaden-AI-News/3.0'},signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw new Error(`HTTP ${r.status}`);const body=await r.text();if(body.length>4000000)throw new Error('출처 목록이 너무 큽니다.');
   results[index]={candidates:listing?parseListing(body,source):parseCandidates(body,source,now)};
  }catch(e){results[index]={candidates:[],error:e.message};}
 }}));
 const articles=new Map(),byPublisher=new Map();
 sources.forEach(([publisher],index)=>{
  const {candidates,error}=results[index];
  const entry=byPublisher.get(publisher)||{publisher,status:'needs-search',urls:new Set(),errors:[]};
  if(error)entry.errors.push(error);
  for(const article of candidates){
   if(!articles.has(article.url))articles.set(article.url,article);
   entry.urls.add(article.url);
   entry.status='discovered';
  }
  byPublisher.set(publisher,entry);
 });
 const coverage=[...byPublisher.values()].map(({publisher,status,urls,errors})=>({publisher,status,count:urls.size,...(errors.length?{error:errors.join(' · ')}:{})}));
 for(const [publisher]of SOURCES)if(!byPublisher.has(publisher))coverage.push({publisher,status:'needs-search',count:0});
 return {candidates:[...articles.values()].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)),coverage};
}

// Missing feeds are actionable search input, including sources learned from liked URLs.
export function sourceSearchBatches(coverage,feedback=[],model,priority=[]){
 if(model==='source-ranking')return [];
 const prioritized=new Set(priority.map(c=>c.publisher));
 const missing=coverage.filter(c=>c.status==='needs-search'&&!prioritized.has(c.publisher)).map(c=>({...c,domain:SOURCES.find(s=>s[0]===c.publisher)?.[1]}));
 for(const f of feedback){if(f.vote!==1)continue;try{const domain=new URL(canonical(f.url)).hostname.replace(/^www\./,'');if(SOURCES.some(s=>domain===s[1]||domain.endsWith('.'+s[1]))||missing.some(s=>s.domain===domain))continue;const source={publisher:domain,domain,status:'needs-search',count:0};missing.push(source);coverage.push(source);}catch{}}
 const likedDomains=new Set(feedback.filter(f=>f.vote===1).map(f=>{try{return new URL(f.url).hostname.replace(/^www\./,'');}catch{return '';}}));
 missing.sort((a,b)=>Number(likedDomains.has(b.domain))-Number(likedDomains.has(a.domain)));
 const sources=[...priority,...missing].slice(0,24);
 const batches=[];
 for(let i=0;i<sources.length;i+=8)batches.push({candidates:[],coverage:sources.slice(i,i+8),targets:[],verifiedUrls:[],sourceSearch:true});
 return batches;
}
