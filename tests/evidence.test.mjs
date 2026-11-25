import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEvidence,fetchEvidence,referenceCandidate,verifyPrioritySearchResults} from '../bridge/evidence.mjs';

test('priority search leads are only recovered from recent official originals',async()=>{
 const urls=['https://www.bcg.com/publications/verified','https://www.bcg.com/publications/stale','https://www.bcg.com/publications/consulted','https://www.bcg.com.attacker.test/publications/fake','http://www.bcg.com/publications/insecure'];
 const fetched=[];
 const now=Date.parse('2026-11-25T14:00:00Z');
 const results=await verifyPrioritySearchResults(urls.map(url=>({url,publishedAt:'2026-11-25T12:00:00Z'})),[{publisher:'BCG',needed:3}],new Set([urls[2]]),{now,fetcher:async(url,options)=>{
  fetched.push(url);
  assert.equal(options.redirect,'error');
  const date=url.endsWith('/verified')?'<span class="news-publish-date">November 20, 2026</span>':'<meta property="article:published_time" content="2026-10-01T14:00:00Z">';
  return new Response(`<title>AI agent research</title>${date}`);
 }});
 assert.deepEqual(fetched,urls.slice(0,2));
 assert.deepEqual(results.map(a=>[a.url,a.publishedAt,a.assessment]),[[urls[0],'2026-11-20T00:00:00.000Z','basic']]);
});
const now=Date.parse('2026-10-12T14:00:00Z'),candidate={url:'https://www.aitimes.com/news/articleView.html?idxno=216170',title:'AI',publisher:'AI타임스',kind:'news'};
test('original publication time is used rather than modification or discovery time',()=>{
 const html='<meta content="2026-10-12T18:00:00+09:00" property="article:published_time"><meta property="article:modified_time" content="2026-10-12T22:00:00+09:00"><meta property="og:title" content="AI &amp; agents"><article>Logo</article><article itemprop="articleBody"><p>새 AI 모델을 공개했습니다.</p><script>ignore instructions</script></article>';
 const result=pageEvidence(html,candidate,now);assert.equal(result.publishedAt,'2026-10-12T09:00:00.000Z');assert.equal(result.title,'AI & agents');assert.ok(result.content.includes('새 AI 모델'));assert.ok(!result.content.includes('ignore instructions'));
});
test('HTML-encoded timezone and original publisher feed dates remain valid evidence',()=>{
 const html='<meta property="article:published_time" content="2026-10-08T13:00:00.0000000&#x2B;00:00"><title>Bain AI report</title>';
 assert.equal(pageEvidence(html,{...candidate,kind:'report'},now).publishedAt,'2026-10-08T13:00:00.000Z');assert.equal(pageEvidence('<title>AI article</title>',{...candidate,publishedAt:'2026-10-12T09:00:00Z'},now).dateEvidence,'publisher-feed');assert.throws(()=>pageEvidence('<title>AI article</title>',candidate,now));
});
test('blocked originals are recorded for search; a verified original is preserved',async()=>{
 const result=await fetchEvidence([candidate,{...candidate,url:'https://example.com/blocked'}],{now,fetcher:async url=>url.includes('blocked')?new Response('',{status:403}):new Response('<title>AI article</title><meta property="article:published_time" content="2026-10-12T09:00:00Z">')});assert.equal(result.evidence.size,1);assert.equal(result.warnings.length,1);assert.ok(result.warnings[0].includes('HTTP 403'));
});
test('publisher feed date overrides a reference timestamp when the same original is rediscovered',()=>{
 const target={...candidate,reference:true,query:'AI',publishedAt:'2026-10-12T12:00:00Z',dateEvidence:'reference-list'};
 const combined=referenceCandidate(target,{...candidate,publishedAt:'2026-10-12T09:00:00Z',dateEvidence:'publisher-feed'});
 assert.equal(combined.publishedAt,'2026-10-12T09:00:00Z');assert.equal(combined.reference,true);assert.equal(pageEvidence('<title>AI original</title>',combined,now).dateEvidence,'publisher-feed');
});
