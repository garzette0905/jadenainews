import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCandidates,discoverCandidates,selectCandidates,sourceSearchBatches,FEEDS} from '../bridge/discovery.mjs';
import {fetchEvidence} from '../bridge/evidence.mjs';
const now=Date.parse('2026-10-12T14:00:00Z');
test('Korean feed times use Seoul and article IDs survive canonicalization',()=>{
 const xml='<rss><item><title>AI 새 모델</title><link>https://www.aitimes.com/news/articleView.html?idxno=10&amp;utm_source=feed</link><pubDate>2026-10-12 21:00:00</pubDate></item><item><title>no date</title><link>https://www.aitimes.com/2</link></item></rss>';
 const result=parseCandidates(xml,FEEDS[0],now);assert.equal(result.length,1);assert.equal(result[0].publishedAt,'2026-10-12T12:00:00.000Z');assert.ok(result[0].url.endsWith('?idxno=10'));
});
test('feeds do not promote modification times or foreign-domain links to verified candidates',()=>{
 const xml='<feed><entry><title>changed</title><link href="https://openai.com/changed"/><updated>2026-10-12T10:00:00Z</updated></entry><entry><title>foreign</title><link href="https://evil.test/a"/><published>2026-10-12T10:00:00Z</published></entry></feed>';
 assert.equal(parseCandidates(xml,FEEDS.find(s=>s[0]==='OpenAI'),now).length,0);
});
test('failed feeds request supplementary search without suppressing other sources',async()=>{
 const result=await discoverCandidates({now,fetcher:async url=>url.includes('aitimes.com')?new Response('<rss><item><title>AI</title><link>https://www.aitimes.com/a</link><pubDate>2026-10-12T10:00:00Z</pubDate></item></rss>'):new Response('',{status:503})});
 assert.equal(result.candidates.length,1);assert.ok(result.coverage.some(c=>c.publisher==='9to5Google'&&c.status==='needs-search'));assert.ok(result.coverage.some(c=>c.publisher==='Anthropic'&&c.status==='needs-search'));
});
test('new AI feeds accept original-domain articles and report discovery coverage',async()=>{
 const sources=[
  ['전자신문','https://rss.etnews.com/04046.xml','https://www.etnews.com/20261012000001'],
  ['The Decoder','https://the-decoder.com/feed/','https://the-decoder.com/new-ai-model/']
 ];
 const result=await discoverCandidates({now,fetcher:async url=>{
  const source=sources.find(([,feed])=>feed===url);
  return source?new Response(`<rss><item><title>AI model</title><link>${source[2]}</link><pubDate>2026-10-12T10:00:00Z</pubDate></item></rss>`):new Response('',{status:503});
 }});
 assert.deepEqual(result.candidates.map(a=>a.url).sort(),sources.map(([, ,url])=>url).sort());
 for(const [publisher]of sources)assert.deepEqual(result.coverage.find(c=>c.publisher===publisher),{publisher,status:'discovered',count:1});
});
test('official listings supply priority candidates, and only the publication date on the original qualifies them',async()=>{
 const links='<a href="/resources/articles/launch">New Claude capability</a><a href="https://example.com/resources/articles/alien">External</a><a href="/resources/articles/old">Old Claude article</a>';
 const found=await discoverCandidates({now,fetcher:async url=>url==='https://claude.com/resources/articles'?new Response(links):new Response('',{status:503})});
 assert.equal(found.coverage.find(x=>x.publisher==='Anthropic').count,2);
 assert.equal(found.candidates[0].publishedAt,undefined);
 const ordinary=Array.from({length:20},(_,i)=>({url:`https://example.com/${i}`,publishedAt:new Date(now).toISOString()}));
 const selected=selectCandidates([...ordinary,...found.candidates],2);
 assert.ok(selected.every(a=>a.publisher==='Anthropic'));
 const {evidence}=await fetchEvidence(selected,{now,fetcher:async url=>new Response(url.endsWith('/launch')?'<main><h1>Claude update</h1><p>Date</p><p>October 11, 2026</p></main>':'<meta property="article:modified_time" content="2026-10-12T12:00:00Z">')});
 assert.equal(evidence.size,1);
 assert.equal(evidence.get('https://claude.com/resources/articles/launch').publishedAt,'2026-10-11T00:00:00.000Z');
});
test('underrepresented official sources precede missing feeds within the existing web search budget',()=>{
 const coverage=Array.from({length:30},(_,i)=>({publisher:`Missing ${i}`,status:'needs-search'}));
 const priority=[{publisher:'Anthropic',domain:'anthropic.com',domains:['anthropic.com','claude.com'],status:'discovered',needed:3}];
 coverage.push(priority[0]);
 const batches=sourceSearchBatches(coverage,[],'model',priority);
 assert.equal(batches.length,3);
 assert.equal(batches[0].coverage[0],priority[0]);
 assert.equal(batches.flatMap(batch=>batch.coverage).length,24);
 assert.deepEqual(sourceSearchBatches(coverage,[],'source-ranking',priority),[]);
});
