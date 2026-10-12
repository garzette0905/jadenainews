import {canonical,WINDOWS,SOURCES} from '../shared/news.mjs';

export const FEEDS = [
 ['AI타임스','https://www.aitimes.com/rss/allArticle.xml','news'],
 ['인공지능신문','https://www.aitimes.kr/rss/allArticle.xml','news'],
 ['지디넷코리아','https://zdnet.co.kr/feed','news'],
 ['TechCrunch','https://techcrunch.com/category/artificial-intelligence/feed/','news'],
 ['The Verge','https://www.theverge.com/rss/ai-artificial-intelligence/index.xml','news'],
 ['MIT Technology Review','https://www.technologyreview.com/topic/artificial-intelligence/feed','news'],
 ['Bloomberg','https://feeds.bloomberg.com/technology/news.rss','news'],
 ['9to5Google','https://9to5google.com/feed/','news'],
 ['OpenAI','https://openai.com/news/rss.xml','official'],
 ['Google AI · Gemini','https://blog.google/technology/ai/rss/','official'],
 ['Google DeepMind','https://deepmind.google/blog/rss.xml','official'],
 ['NVIDIA','https://blogs.nvidia.com/feed/','official'],
 ['Hugging Face','https://huggingface.co/blog/feed.xml','official'],
 ['McKinsey','https://www.mckinsey.com/insights/rss','report']
];
const decode=s=>String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[n]));
const clean=s=>decode(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const tag=(s,n)=>(s.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`,'i'))||[])[1]||'';
export function parseCandidates(xml,[publisher,feed,kind],now=Date.now()){
 const items=[];for(const block of xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi)||[]){
  try{const url=canonical(decode(tag(block,'link')).trim()||(block.match(/<link\b[^>]*href=["']([^"']+)["']/i)||[])[1]);
   const domain=new URL(feed).hostname.replace(/^www\./,'');const host=new URL(url).hostname.replace(/^www\./,'');
   if(host!==domain&&!host.endsWith('.'+domain))continue;
   const raw=clean(tag(block,'pubDate')||tag(block,'published')||tag(block,'dc:date'));
   const dated=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)?raw.replace(' ','T')+'+09:00':raw;
   const at=Date.parse(dated);if(!Number.isFinite(at)||at>now+300000||now-at>WINDOWS[kind]*3600000)continue;
   const title=clean(tag(block,'title'));if(!title)continue;
   items.push({url,title,publisher,kind,publishedAt:new Date(at).toISOString(),summary:clean(tag(block,'description')||tag(block,'summary')).slice(0,700),discoveredFrom:feed});
  }catch{/* Malformed entries cannot suppress other feed items. */}
 }return items;
}
export async function discoverCandidates({now=Date.now(),fetcher=fetch}={}){
 const articles=new Map(),coverage=[];let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<FEEDS.length){const source=FEEDS[next++];try{
  const r=await fetcher(source[1],{headers:{Accept:'application/rss+xml,application/atom+xml,application/xml,text/xml', 'User-Agent':'Jaden-AI-News/3.0'},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);const xml=await r.text();if(xml.length>4000000)throw new Error('피드가 너무 큽니다.');
  const candidates=parseCandidates(xml,source,now);for(const a of candidates)articles.set(a.url,a);
  coverage.push({publisher:source[0],status:candidates.length?'discovered':'needs-search',count:candidates.length});
 }catch(e){coverage.push({publisher:source[0],status:'needs-search',count:0,error:e.message});}}}));
 for(const [publisher]of SOURCES)if(!coverage.some(c=>c.publisher===publisher))coverage.push({publisher,status:'needs-search',count:0});
 return {candidates:[...articles.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)),coverage};
}
