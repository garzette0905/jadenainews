import test from 'node:test';
import assert from 'node:assert/strict';
import {basicArticle,rankArticles,validateResearch,mergeResearch} from '../shared/news.mjs';
import {referenceTargets} from '../bridge/reference-targets.mjs';
const now=Date.parse('2026-10-13T00:00:00Z');
test('all 30 references remain visible and receive ranks even without AI access',()=>{
 const refs=referenceTargets(now);const articles=refs.map(a=>basicArticle(a,[],now));assert.equal(articles.length,30);assert.ok(articles.every(Boolean));const checked=validateResearch({articles},refs.map(a=>a.url),now);const ranked=rankArticles(checked.articles,[],now);assert.equal(ranked.length,30);assert.equal(ranked[29].rank,30);assert.ok(ranked.every(a=>a.assessment==='reference'));assert.ok(ranked.every((a,i)=>i===0||ranked[i-1].score>=a.score));
});
test('unrelated feed stories are excluded, and context tokens do not imply free credits',()=>{
 const row={url:'https://example.com/a',title:'오르카라우터 100만 tokens 사이버 보안 AI 모델 공개',summary:'새 모델을 공개했다.',publisher:'AI타임스',publishedAt:new Date(now).toISOString(),kind:'news',verification:'http-original'};assert.equal(basicArticle(row,[],now).category,'launch');assert.equal(basicArticle({...row,title:'일반 주가 시황',summary:'주식시장 마감'},[],now),null);
});
test('publisher report remains a report even when its title mentions CEOs',()=>{
 const row={url:'https://mckinsey.com/ai',title:'Why AI easiest wins are misleading CEOs',publisher:'McKinsey',publishedAt:new Date(now).toISOString(),kind:'report',verification:'http-original'};assert.equal(basicArticle(row,[],now).category,'report');assert.equal(basicArticle(row,[],now).assessment,'basic');
});
test('feedback affects similar other stories, excludes self-feedback and expires',()=>{
 const row={url:'https://example.com/new',title:'Claude AI new model launch',publisher:'P',publishedAt:new Date(now).toISOString(),kind:'news',verification:'http-original'};const vote={url:'https://example.com/liked',title:row.title,vote:1,updatedAt:new Date(now).toISOString()};assert.ok(basicArticle(row,[vote],now).scores.preference>15);assert.equal(basicArticle(row,[{...vote,url:row.url}],now).scores.preference,15);assert.equal(basicArticle(row,[{...vote,updatedAt:new Date(now-61*86400000).toISOString()}],now).scores.preference,15);
});
test('saving a full pool does not push references out of storage',()=>{
 const refs=referenceTargets(now).map(a=>basicArticle(a,[],now));const recent=Array.from({length:250},(_,i)=>({...refs[0],url:`https://example.com/${i}`,reference:false,publishedAt:new Date(now).toISOString()}));const merged=mergeResearch([], {articles:[...refs,...recent],warnings:[]},now);assert.equal(merged.articles.length,250);assert.equal(merged.articles.filter(a=>a.reference).length,30);
});
