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
  assert.deepEqual(recommendationSections([]),{top:[],more:[],articleCount:0,groupedCount:0});
});
test('unselected events remain individually available in more, preserving the requested Top 6 scope',()=>{
  const rows=Array.from({length:6},(_,i)=>article(i+1,'unique-'+i));rows.push(article(7,'another-release'),article(8,'another-release'));
  assert.equal(recommendationSections(rows).more.length,2);
});
