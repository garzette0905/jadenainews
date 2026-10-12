import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const file=new URL('../.runtime/assessment-cache.json',import.meta.url);
export function compactFeedback(feedback,now){
  return feedback.filter(f=>[-1,1].includes(f.vote)&&Date.parse(f.updatedAt)<=now&&now-Date.parse(f.updatedAt)<=60*86400000)
    .map(f=>({url:f.url,vote:f.vote,title:f.title||'',summary:(f.summary||'').slice(0,400),updatedAt:f.updatedAt}));
}
export function assessmentKey(row,input){
  // Daily invalidation preserves preference decay; changed originals or votes invalidate immediately.
  return createHash('sha256').update(JSON.stringify({model:input.model,day:input.now.slice(0,10),feedback:compactFeedback(input.feedback||[],Date.parse(input.now)),url:row.url,title:row.title,publishedAt:row.publishedAt,summary:row.summary,content:row.content,verification:row.verification})).digest('hex');
}
export async function readAssessments(){try{return JSON.parse(await readFile(file,'utf8'));}catch{return {};}}
export async function writeAssessments(cache,now){
  const entries=Object.entries(cache).filter(([,v])=>now-v.at<86400000).sort((a,b)=>b[1].at-a[1].at).slice(0,500);
  await mkdir(new URL('../.runtime/',import.meta.url),{recursive:true});await writeFile(file,JSON.stringify(Object.fromEntries(entries)));
}
export function planAssessments(rows,cache,input){
  const reused=[],pending=[];
  for(const row of rows){const key=assessmentKey(row,input),entry=cache[key];if(entry&&Date.parse(input.now)-entry.at<86400000)reused.push(entry.article);else pending.push(row);}
  // Preserve the whole basic pool while limiting AI to the newest 40 pending articles per request.
  pending.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  const batches=[];if(input.model!=='source-ranking')for(let i=0;i<Math.min(40,pending.length);i+=20){const candidates=pending.slice(i,i+20);batches.push({candidates,coverage:[],targets:candidates.filter(a=>a.reference&&a.verification!=='http-original'),verifiedUrls:candidates.filter(a=>a.verification==='http-original').map(a=>a.url)});}
  return {reused,pending,batches};
}
