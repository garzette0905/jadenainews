import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendationSections} from '../shared/news.mjs';
const article=(rank,eventId,extra={})=>({rank,eventId,url:`https://example.com/${rank}`,title:`Story ${rank}`,titleKo:`기사 ${rank}`,publisher:`매체 ${rank}`,category:'launch',publishedAt:'2026-10-13T00:00:00Z',score:100-rank,related:[],...extra});
test('four release reports occupy one Top 6 slot with all originals in related coverage',()=>{
  const rows=[article(1,'model-launch'),article(2,'model-launch'),article(3,'model-launch'),article(4,'chips'),article(5,'model-launch'),article(6,'regulation'),article(7,'tools'),article(8,'security'),article(9,'research'),article(10,'other')];
  rows[0].related=[{url:rows[1].url+'?utm_source=feed',title:'tracked duplicate',publisher:'P'},{url:rows[0].url,title:'self'}];
  const original=JSON.stringify(rows),result=recommendationSections(rows);
  assert.equal(result.top.length,6);assert.deepEqual(result.top.map(a=>a.articleRank),[1,4,6,7,8,9]);
  assert.deepEqual(result.top.map(a=>a.rank),[1,2,3,4,5,6]);assert.equal(result.top[0].score,99);
  assert.equal(result.groupedCount,3);assert.equal(result.top[0].related.length,3);
  assert.deepEqual(new Set(result.top[0].related.map(r=>r.url)),new Set([rows[1].url,rows[2].url,rows[4].url]));
  assert.deepEqual(result.more.map(a=>a.articleRank),[10]);assert.equal(result.more[0].rank,7);
  assert.equal(JSON.stringify(rows),original);
});
test('reciprocal related links group reports with different or URL-only IDs across publishers',()=>{
  const a=article(1,'url:https://example.com/1'),b=article(2,'other-model-release');
  a.related=[{url:b.url+'?utm_medium=rss',title:b.title,publisher:b.publisher}];b.related=[{url:a.url,title:a.title,publisher:a.publisher}];
  const r=recommendationSections([a,b,article(3,'unique')]);assert.equal(r.top.length,2);assert.equal(r.top[0].related.length,1);assert.equal(r.top[0].mergedCount,1);
});
test('same publisher, category or shared reference alone do not hide distinct events',()=>{
  const reference={url:'https://example.com/shared',title:'Background'};
  const rows=[article(1,'model-release',{related:[reference]}),article(2,'model-security',{related:[reference],publisher:'매체 1'})];
  assert.equal(recommendationSections(rows).top.length,2);
});
test('old recurring reports are separate and URL-based IDs do not create false event groups',()=>{
  const rows=[article(1,'weekly',{publishedAt:'2026-10-13T00:00:00Z'}),article(2,'weekly',{publishedAt:'2026-10-08T00:00:00Z'}),article(3,'url:placeholder'),article(4,'url:placeholder')];
  assert.equal(recommendationSections(rows).top.length,4);
});
test('fewer than six distinct events yields only available representatives; pending votes cannot alter grouping',()=>{
  const rows=[article(1,'release'),article(2,'release')];const a=recommendationSections(rows),b=recommendationSections(rows.map(a=>({...a,vote:-1})));
  assert.equal(a.top.length,1);assert.equal(a.more.length,0);assert.deepEqual(a.top.map(a=>a.url),b.top.map(a=>a.url));
  const empty=recommendationSections([]);
  assert.deepEqual(empty,{top:[],more:[],sourceCoverage:{consulting:{target:0,count:0},openai:{target:0,count:0},anthropic:{target:0,count:0}},articleCount:0,groupedCount:0});
});
test('similar reports are merged throughout the 50-story list, including below Top 6',()=>{
  const rows=Array.from({length:6},(_,i)=>article(i+1,'unique-'+i));rows.push(article(7,'another-release'),article(8,'another-release'));
  const result=recommendationSections(rows);assert.equal(result.more.length,1);assert.equal(result.more[0].mergedCount,1);assert.equal(result.more[0].related.length,1);
});
test('highly overlapping headlines collapse into one story and retain both sources',()=>{
  const a=article(1,'url:a',{titleKo:'Meta Muse Wonder 출시, 개인 비서 AI 공개'}),b=article(2,'url:b',{titleKo:'Meta, Muse Wonder 개인 비서 AI 정식 출시',publisher:'다른 매체'});
  const result=recommendationSections([a,b,article(3,'different',{titleKo:'Meta AI 데이터센터 투자 분석'})]);
  assert.deepEqual(result.top.map(x=>x.articleRank),[1,3]);assert.equal(result.top[0].mergedCount,1);assert.equal(result.top[0].related[0].url,b.url);
});
test('a shared company and named product collapse a paraphrased release, not unrelated company coverage',()=>{
  const museA=article(1,'meta-a',{titleKo:'Meta, 더 오래 기억하는 Muse Wonder 공개'}),museB=article(2,'meta-b',{titleKo:'Meta, 안전 우려 속 Muse 출시했다는 보도'});
  const chip=article(3,'microsoft-chip',{titleKo:'Microsoft 자체 AI 칩 Maia 300 공개'}),policy=article(4,'microsoft-policy',{titleKo:'Microsoft, UK AI 출시 전 외부 안전 평가 제안'});
  const r=recommendationSections([museA,museB,chip,policy]);
  assert.deepEqual(r.top.map(a=>a.articleRank),[1,3,4]);assert.equal(r.top[0].mergedCount,1);
});
test('fifty recommendations reserve five distinct verified events for each requested source group',()=>{
  const rows=Array.from({length:65},(_,i)=>article(i+1,`event-${i+1}`));
  const sources=[['https://www.bcg.com/publications/2026/','BCG','report'],['https://openai.com/index/','OpenAI','official'],['https://claude.com/resources/articles/','Anthropic','official']];
  for(const [url,publisher,kind] of sources){
    for(let i=0;i<6;i++){
      const rank=rows.length+1;
      const eventId=publisher==='OpenAI'&&i===0?'event-1':`priority-${rank}`;
      rows.push(article(rank,eventId,{url:url+rank,publisher,kind}));
    }
  }
  const result=recommendationSections(rows),displayed=[...result.top,...result.more];
  assert.equal(displayed.length,50);
  assert.deepEqual(Object.values(result.sourceCoverage),Array.from({length:3},()=>({target:5,count:5})));
  assert.deepEqual(result.top.map(a=>a.articleRank),[1,2,3,4,5,6]);
  assert.equal(displayed[49].rank,50);
  assert.equal(result.groupedCount,1);
});
test('an official alternate can fill a quota while one event keeps one slot',()=>{
  const general=article(1,'shared');
  const release=article(2,'shared',{url:'https://openai.com/index/release',kind:'official'});
  const lookalike=article(3,'lookalike',{url:'https://openai.com.example.com/index/release',publisher:'OpenAI',kind:'official'});
  const unverified=article(4,'reference',{url:'https://anthropic.com/news/unverified',kind:'official',assessment:'reference'});
  const disliked=article(5,'disliked',{url:'https://claude.com/resources/articles/disliked',kind:'official',vote:-1});
  const result=recommendationSections([general,release,lookalike,unverified,disliked]);
  assert.equal(result.sourceCoverage.openai.count,1);
  assert.equal(result.sourceCoverage.anthropic.count,0);
  assert.equal(result.top.find(a=>a.url===release.url).related[0].url,general.url);
  assert.equal(result.top.length,4);
});
