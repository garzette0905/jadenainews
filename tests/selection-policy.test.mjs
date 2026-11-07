import test from 'node:test';
import assert from 'node:assert/strict';
import {basicArticle,scoreArticle,selectionTypes,typeAward,savedRanking,SOURCES} from '../shared/news.mjs';
import {parseCandidates,FEEDS,sourceSearchBatches} from '../bridge/discovery.mjs';
const at='2026-11-08T00:00:00Z',now=Date.parse(at);
const row={url:'https://example.com/a',title:'AI industry update',summary:'',kind:'news',publishedAt:at,category:'other',scores:{importance:18,preference:15,category:2,evidence:3,dislike:0}};
test('product releases, acquisitions, productivity and ROI outrank a general story with equal evidence',()=>{
 const cases=[['Fable 5.5 발표','launch',20],['AI startup acquisition announced','deal',19],['AI productivity gains measured','productivity',18],['AI ROI and cost savings','roi',20]];
 for(const [title,type,points] of cases){const a={...row,title};assert.ok(selectionTypes(a).includes(type));assert.equal(typeAward(a),points);assert.ok(scoreArticle(a,now).score>scoreArticle(row,now).score);assert.ok(basicArticle(a,[],now));}
});
test('overlapping ROI, productivity and launch labels get one maximum award and ignore legacy category points',()=>{
 const a={...row,title:'AI model launch boosts productivity and ROI',category:'launch'};
 assert.deepEqual(selectionTypes(a),['roi','productivity','launch']);assert.equal(typeAward(a),20);
 assert.equal(scoreArticle(a,now).score,scoreArticle({...a,scores:{...a.scores,category:10}},now).score);
 assert.equal(scoreArticle(a,now).score-scoreArticle(row,now).score,16);
});
test('historical votes decay, expire, and avoid self or same-event double counting',()=>{
 const candidate={...row,title:'Claude AI model coding assistant launch',verification:'http-original',eventId:'story'};
 const feedback={url:'https://example.com/old',title:'Claude AI coding assistant enterprise adoption',vote:1,updatedAt:at};
 const base=basicArticle(candidate,[],now),fresh=basicArticle(candidate,[feedback],now),half=basicArticle(candidate,[{...feedback,updatedAt:new Date(now-14*86400000).toISOString()}],now);
 assert.ok(fresh.scores.preference>base.scores.preference);
 assert.ok(Math.abs((fresh.scores.preference-15)/2-(half.scores.preference-15))<1e-10);
 for(const f of [{...feedback,url:candidate.url},{...feedback,eventId:'story'},{...feedback,title:candidate.title},{...feedback,updatedAt:new Date(now-61*86400000).toISOString()}])assert.equal(basicArticle(candidate,[f],now).scores.preference,15);
 const down=scoreArticle({...row,scores:{...row.scores,dislike:35}},now);assert.equal(scoreArticle(row,now).score-down.score,15);
});
test('legacy snapshots replace the old direct vote exactly once and never accumulate',()=>{
 const state={ranked:[{url:row.url,title:row.title,score:70,feedbackScore:10,publishedAt:at}],feedback:[{url:row.url,vote:1}]};
 assert.equal(savedRanking(state)[0].score,65);assert.equal(savedRanking(state)[0].feedbackScore,5);assert.equal(savedRanking(state)[0].score,65);
 assert.equal(savedRanking({...state,feedback:[{url:row.url,vote:-1}]})[0].score,55);
});
test('cross-host RSS retains Bloomberg and Ars originals while rejecting foreign links',()=>{
 for(const publisher of ['Bloomberg','Ars Technica']){const feed=FEEDS.find(f=>f[0]===publisher),domain=SOURCES.find(s=>s[0]===publisher)[1];
 const xml=`<rss><item><title>AI product launch</title><link>https://www.${domain}/a</link><pubDate>${at}</pubDate></item><item><title>AI injected</title><link>https://foreign.test/a</link><pubDate>${at}</pubDate></item></rss>`;
 assert.equal(parseCandidates(xml,feed,now).length,1);}
});
test('missing news outlets and new liked publishers reach real search batches; fast mode never calls AI',()=>{
 const coverage=[{publisher:'Reuters',status:'needs-search',count:0},{publisher:'TechCrunch',status:'discovered',count:1}];
 const votes=[{url:'https://newpublisher.example/ai',vote:1},{url:'https://disliked.example/ai',vote:-1}];
 assert.deepEqual(sourceSearchBatches(coverage,votes,'source-ranking'),[]);
 const batches=sourceSearchBatches(coverage,votes,'test');assert.ok(batches.every(b=>b.coverage.length<=8&&b.sourceSearch));
 const sources=batches.flatMap(b=>b.coverage);assert.ok(sources.some(s=>s.domain==='reuters.com'));assert.ok(sources.some(s=>s.domain==='newpublisher.example'));assert.ok(!sources.some(s=>s.domain==='disliked.example'));assert.ok(!sources.some(s=>s.publisher==='TechCrunch'));
});
