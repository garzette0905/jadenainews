import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreArticle,scoreExplanation} from '../shared/news.mjs';
const now=Date.parse('2026-11-08T00:00:00Z');
const article={url:'https://example.com/ai-glasses',title:'삼성·Google AI 안경 예약 판매 발표',summary:'Gemini 번역과 길 안내',category:'launch',kind:'news',publishedAt:new Date(now-12.9*3600000).toISOString(),scores:{importance:21,preference:14,category:8,evidence:3,dislike:8},reasons:[
 'importance 21: 주요 플랫폼 기업의 AI 안경 진입과 구체적인 예약 일정이 확인된다.',
 'preference 14: Gemini 제품 확장에는 관심이 있으나 업무용 소프트웨어 중심 취향과는 거리가 있다.',
 'category 8: 예약 판매 일정 발표이며 실제 배송·출시는 앞으로의 계획이다.',
 'evidence 3: 가격·실사용 검증은 없다.',
 'dislike 8: 웨어러블·소비자 기기에 대한 부정 취향을 시간 감쇠해 반영했다.'
]};
test('AI glasses example uses final scores in both the formula and all explanation rows',()=>{
 const scored=scoreArticle(article,now),copy=structuredClone(scored),view=scoreExplanation(scored);
 assert.deepEqual(scored,copy);assert.deepEqual(article.scores,{importance:21,preference:14,category:8,evidence:3,dislike:8});
 assert.equal(view.items.find(i=>i.key==='preference').display,'취향 7.0/15');
 assert.equal(view.items.find(i=>i.key==='category').display,'선정 유형 20.0/20');
 assert.equal(view.items.find(i=>i.key==='dislike').display,'부정 취향 3.4');
 for(const item of view.items)assert.ok(view.formula.includes(item.display));
 assert.ok(view.items.find(i=>i.key==='category').description.includes('고정 가점'));
 assert.ok(view.items.find(i=>i.key==='category').description.includes('예약 판매 일정'));
 const text=JSON.stringify(view);assert.ok(!/preference 14|category 8|dislike 8/.test(text));assert.equal(view.notes.length,0);
});
test('English and Korean reason prefixes with ratios are stripped without losing facts',()=>{
 const scored=scoreArticle({...article,reasons:['취향(14/30점): Gemini 확장 관심','Category: 8/10: 11월 12일 예약 판매','근거 3점: 2개 브랜드 발표','일반 선정 설명은 그대로 유지']},now);
 const view=scoreExplanation(scored);
 assert.equal(view.items.find(i=>i.key==='preference').description,'Gemini 확장 관심');
 assert.ok(view.items.find(i=>i.key==='category').description.includes('11월 12일 예약 판매'));
 assert.equal(view.items.find(i=>i.key==='evidence').description,'2개 브랜드 발표');
 assert.deepEqual(view.notes,['일반 선정 설명은 그대로 유지']);
});
test('live votes, zero penalties and incomplete legacy snapshots are displayed safely',()=>{
 for(const vote of [-1,0,1]){
  const a=scoreArticle({...article,scores:{...article.scores,dislike:0},reasons:[]},now,vote),view=scoreExplanation(a);
  assert.ok(view.formula.includes(`내 평가 (${(vote*5).toFixed(1)})`));assert.equal(view.items.find(i=>i.key==='dislike').value,0);assert.equal(view.items.length,8);
 }
 assert.deepEqual(scoreExplanation({score:57,reasons:['기존 설명']}).notes,['기존 설명']);
 assert.equal(scoreExplanation({score:57}).items.length,0);
});
