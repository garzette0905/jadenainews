import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionSnapshot,savedRanking} from '../shared/news.mjs';
import {compactFeedback,assessmentKey,planAssessments} from '../bridge/assessment-cache.mjs';
const now='2026-10-13T00:00:00Z';
const row={url:'https://example.com/ai',title:'Claude AI model launch',summary:'새 AI 모델',publisher:'Example',publishedAt:now,kind:'news',verification:'http-original',content:'Verified original text'};
const article={...row,titleKo:row.title,scores:{importance:25,preference:15,category:8,evidence:3,dislike:0},reasons:[],related:[]};
test('votes immediately change scores and cancellation restores them; next collection excludes dislikes',()=>{
  const collected=collectionSnapshot({articles:[]},{articles:[article],warnings:[]},[],now);
  const changed={...collected,feedback:[{url:article.url,vote:-1,updatedAt:now}]};
  assert.equal(savedRanking(changed).length,1);assert.equal(savedRanking(changed)[0].vote,-1);
  assert.equal(savedRanking(changed)[0].score,collected.ranked[0].score-10);
  assert.equal(savedRanking({...changed,feedback:[{url:article.url,vote:1}]})[0].score,collected.ranked[0].score+10);
  assert.equal(savedRanking({...changed,feedback:[]})[0].score,collected.ranked[0].score);
  const next=collectionSnapshot(changed,{articles:[article],warnings:[]},changed.feedback,'2026-10-13T01:00:00Z');
  assert.deepEqual(next.ranked,[]);
  assert.equal(savedRanking({...next,feedback:[]}).length,0);
});
test('legacy snapshots keep collection freshness while applying current votes',()=>{
  const state={articles:[article],ranked:[{...article,freshness:40,score:90}],collectedAt:now,feedback:[{url:row.url,vote:-1}]};
  assert.equal(savedRanking(state).length,1);assert.equal(savedRanking(state)[0].freshness,30);
});

test('live votes reorder articles without mutating originals or accumulating on reload',()=>{
  const other={...article,url:'https://example.com/other',scores:{...article.scores,importance:30}};
  const state={...collectionSnapshot({articles:[]},{articles:[other,article],warnings:[]},[],now),feedback:[]};
  const original=structuredClone(state.articles),base=savedRanking(state).find(a=>a.url===article.url).score;
  state.feedback=[{url:article.url,vote:1,updatedAt:now}];
  assert.equal(savedRanking(state)[0].url,article.url);
  assert.equal(savedRanking(state)[0].score,base+10);
  assert.deepEqual(savedRanking(JSON.parse(JSON.stringify(state))),savedRanking(state));
  state.feedback=[{url:article.url,vote:-1,updatedAt:now}];
  assert.equal(savedRanking(state).find(a=>a.url===article.url).score,base-10);
  state.feedback=[];
  assert.equal(savedRanking(state).find(a=>a.url===article.url).score,base);
  assert.deepEqual(state.articles,original);
});

test('collected likes receive one direct bonus and current votes can cancel it',()=>{
  const feedback=[{url:article.url,vote:1,updatedAt:now}];
  const state={...collectionSnapshot({articles:[]},{articles:[article],warnings:[]},feedback,now),feedback};
  assert.equal(savedRanking(state)[0].score,state.ranked[0].score);
  assert.equal(savedRanking({...state,feedback:[]})[0].score,state.ranked[0].score-10);
  const high={...article,scores:{importance:30,preference:30,category:10,evidence:5,dislike:0}};
  assert.equal(savedRanking({...state,articles:[high]})[0].score,100);
});
test('completed assessments are reused but changed originals, votes, models and day invalidate cache',()=>{
  const input={now,feedback:[],model:'test'},key=assessmentKey(row,input),cache={[key]:{at:Date.parse(now),article}};
  assert.equal(planAssessments([row],cache,input).batches.length,0);
  for(const changed of [{...input,model:'other'},{...input,now:'2026-10-14T00:00:00Z'},{...input,feedback:[{url:row.url,vote:1,updatedAt:now}]}])assert.equal(planAssessments([row],cache,changed).batches.length,1);
  assert.equal(planAssessments([{...row,content:'Updated original'}],cache,input).batches.length,1);
});
test('AI budget is bounded to forty newest candidates and basic collection has no AI turns',()=>{
  const rows=Array.from({length:83},(_,i)=>({...row,url:`https://example.com/${i}`,publishedAt:new Date(Date.parse(now)-i*3600000).toISOString()}));
  const plan=planAssessments(rows.reverse(),{},{now,model:'test',feedback:[]});
  assert.equal(plan.batches.length,2);assert.equal(plan.batches.flatMap(b=>b.candidates).length,40);assert.equal(plan.batches[0].candidates[0].url,'https://example.com/0');
  assert.equal(planAssessments(rows,{},{now,model:'source-ranking',feedback:[]}).batches.length,0);
});
test('expired or future votes are removed from AI input and long summaries are bounded',()=>{
  const vote={url:row.url,vote:1,updatedAt:now,summary:'x'.repeat(1500)};
  const compact=compactFeedback([vote,{...vote,updatedAt:'2026-07-01T00:00:00Z'},{...vote,updatedAt:'2026-10-14T00:00:00Z'}],Date.parse(now));
  assert.equal(compact.length,1);assert.equal(compact[0].summary.length,400);
});
