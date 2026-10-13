import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialHeadline,headlineFingerprint,headlineInstructions} from '../shared/headlines.mjs';
import edits from '../shared/headline-edits.json' with {type:'json'};
import {recommendationSections} from '../shared/news.mjs';
test('company and person names use English while Korean company names remain Korean',()=>{
 assert.equal(editorialHeadline({titleKo:'마이크로소프트, 나델라가 보안 원칙 제안'}),'Microsoft, Satya Nadella가 보안 원칙 제안');
 assert.equal(editorialHeadline({titleKo:'네이버·미호요, AI 개발 확대 - AI타임스'}),'네이버·미호요, AI 개발 확대');
 assert.equal(editorialHeadline({titleKo:'메타데이터 활용'}),'메타데이터 활용');
});
test('current editorial overrides are guarded against changed article facts',()=>{
 const [url,edit]=Object.entries(edits)[0];assert.notEqual(headlineFingerprint('Different title','Changed facts'),edit.fingerprint);
 assert.equal(editorialHeadline({url,title:'Different title',titleKo:'새 사실',summary:'Changed facts'}),'새 사실');
 assert.equal(Object.keys(edits).length,50);
 assert.match(headlineInstructions(),/IT 기획자/);assert.match(headlineInstructions(),/비영어권/);
});
test('display has at most fifty consecutive ranks after Top 6 event merging without truncating raw data',()=>{
 const rows=Array.from({length:100},(_,i)=>({rank:i+1,url:`https://example.com/${i}`,eventId:i<4?'one-release':`event-${i}`,category:'launch',publishedAt:'2026-10-13T00:00:00Z',score:100-i,related:[]}));
 const r=recommendationSections(rows);assert.equal(r.top.length,6);assert.equal(r.more.length,44);assert.equal(r.more.at(-1).rank,50);assert.equal(r.groupedCount,3);assert.equal(r.articleCount,100);assert.equal(rows.length,100);
});
