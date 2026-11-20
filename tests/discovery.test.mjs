import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCandidates,discoverCandidates,FEEDS} from '../bridge/discovery.mjs';
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
