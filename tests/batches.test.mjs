import test from 'node:test';
import assert from 'node:assert/strict';
import {runBatches} from '../bridge/batches.mjs';
import {referenceTargets} from '../bridge/reference-targets.mjs';
test('research runs at most three turns and a failed batch does not cancel the rest',async()=>{
 let active=0,peak=0;const visited=[];
 const result=await runBatches(Array.from({length:16},(_,i)=>i),async batch=>{active++;peak=Math.max(peak,active);visited.push(batch);try{await new Promise(r=>setTimeout(r,5));if(batch===3)throw new Error('one source failed');return batch;}finally{active--;}});
 assert.equal(peak,3);assert.equal(visited.length,16);assert.equal(new Set(visited).size,16);assert.equal(result[3].status,'rejected');assert.equal(result[15].value,15);
});
test('all 30 owner reference URLs enter discovery but expire rather than remaining permanent news',()=>{
 const targets=referenceTargets(Date.parse('2026-10-12T14:00:00Z'));assert.equal(targets.length,30);assert.equal(new Set(targets.map(t=>t.url)).size,30);assert.ok(targets.every(t=>new URL(t.url).protocol==='https:'));assert.equal(referenceTargets(Date.parse('2026-11-12T14:00:00Z')).length,0);
});
