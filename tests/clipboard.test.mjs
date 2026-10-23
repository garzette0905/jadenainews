import test from 'node:test';
import assert from 'node:assert/strict';
import {copyText} from '../web/clipboard.mjs';
const text='편집된 기사 제목\nhttps://example.com/original';
function page(result=true){
 const calls=[],field={style:{},focus(){calls.push('focus');},select(){calls.push('select');},setSelectionRange(start,end){assert.equal(this.value,text);assert.deepEqual([start,end],[0,text.length]);},remove(){calls.push('remove');}};
 return {calls,document:{activeElement:{focus(){calls.push('restore');}},createElement(){return field;},body:{append(){}},execCommand(command){assert.equal(command,'copy');return result;}}};
}
test('successful async copy preserves the exact title and URL without a fallback',async()=>{
 let copied;assert.equal(await copyText(text,{navigator:{clipboard:{async writeText(value){copied=value;}}},document:{}}),true);assert.equal(copied,text);
});
test('a denied clipboard API falls back to selection copy and restores focus',async()=>{
 const p=page();assert.equal(await copyText(text,{...p,navigator:{clipboard:{async writeText(){throw new Error('Permissions policy');}}}}),true);
 assert.deepEqual(p.calls,['focus','select','remove','restore']);
});
test('an unavailable async API still copies through the user selection',async()=>{
 const p=page();assert.equal(await copyText(text,{...p,navigator:{}}),true);assert.ok(p.calls.includes('remove'));
});
test('denied or unavailable fallback never reports a false success',async()=>{
 const p=page(false);assert.equal(await copyText(text,{...p,navigator:{}}),false);assert.deepEqual(p.calls,['focus','select','remove','restore']);
 assert.equal(await copyText(text,{navigator:{},document:{}}),false);
});
