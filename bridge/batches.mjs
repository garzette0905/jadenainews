// Bound simultaneous App Server research turns; one failed source must not cancel the others.
export async function runBatches(batches,run,concurrency=3){
 const results=new Array(batches.length);let next=0,completed=0;
 await Promise.all(Array.from({length:Math.min(concurrency,batches.length)},async()=>{
  while(next<batches.length){const index=next++;try{results[index]={status:'fulfilled',value:await run(batches[index],index,()=>completed)};}catch(reason){results[index]={status:'rejected',reason};}finally{completed++;}}
 }));return results;
}
