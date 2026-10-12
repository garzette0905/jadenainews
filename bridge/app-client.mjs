import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {researchInstructions,researchInput,validateResearch,canonical,MAX_ARTICLES,basicArticle} from '../shared/news.mjs';
import {discoverCandidates} from './discovery.mjs';
import {referenceTargets} from './reference-targets.mjs';
import {runBatches} from './batches.mjs';
import {fetchEvidence,referenceCandidate} from './evidence.mjs';

export class AppClient extends EventEmitter {
  constructor(){super();this.nextId=1;this.pending=new Map();this.process=null;this.ready=null;}
  async start(){if(this.ready)return this.ready;this.ready=this.boot().catch(e=>{this.ready=null;throw e;});return this.ready;}
  async boot(){
    const args=['app-server','--stdio','-c','web_search="live"'];
    for(const f of ['shell_tool','unified_exec','code_mode','multi_agent','apps','remote_plugin','hooks','memories'])args.push('-c',`features.${f}=false`);
    this.process=spawn(process.env.JADEN_CODEX_BIN||'codex',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let buffer='';this.process.stdout.setEncoding('utf8');this.process.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line.trim())continue;try{this.receive(JSON.parse(line));}catch{/* Non-JSON diagnostics are not user data. */}}});
    this.process.stderr.resume();this.process.on('error',()=>this.fail(new Error('PC의 공식 Codex 실행 도구를 시작하지 못했습니다.')));this.process.on('exit',()=>this.fail(new Error('앱 연결이 종료되었습니다. 다시 연결하세요.')));
    await this.request('initialize',{clientInfo:{name:'jaden_ai_news',title:'Jaden AI News',version:'0.2.0'},capabilities:{experimentalApi:true}});this.send({method:'initialized',params:{}});
  }
  send(v){this.process?.stdin.write(JSON.stringify(v)+'\n');}
  receive(message){if(message.id!==undefined&&this.pending.has(message.id)){const p=this.pending.get(message.id);this.pending.delete(message.id);clearTimeout(p.timer);if(message.error)p.reject(new Error(message.error.message||'앱 요청 실패'));else p.resolve(message.result);return;}
    if(message.id!==undefined&&message.method){this.send({id:message.id,error:{code:-32601,message:'뉴스 조사에서는 외부 도구·파일·명령 실행 요청을 허용하지 않습니다.'}});return;}
    if(message.method)this.emit(message.method,message.params);}
  request(method,params,timeout=30000){return new Promise((resolve,reject)=>{const id=this.nextId++;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('앱 응답을 기다리는 시간이 초과되었습니다.'));},timeout);this.pending.set(id,{resolve,reject,timer});this.send({id,method,params});});}
  fail(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.ready=null;this.emit('disconnected',error);}
  async status(){await this.start();const {account}=await this.request('account/read',{refreshToken:false});if(!account)return {connected:false,mode:'app',email:'',models:[]};if(account.type!=='chatgpt')throw new Error('앱이 API 키 방식으로 로그인되어 있습니다. ChatGPT 계정 로그인으로 바꿔주세요.');
    const models=[];let cursor;do{const r=await this.request('model/list',{limit:50,includeHidden:false,...(cursor?{cursor}:{})});models.push(...r.data.map(m=>({slug:m.model,display_name:m.displayName,isDefault:m.isDefault})));cursor=r.nextCursor;}while(cursor);models.push({slug:'source-ranking',display_name:'원문 기반 빠른 수집 (AI 평가 대기)',isDefault:false});return {connected:true,mode:'app',email:account.email||'',planType:account.planType,models};}
  async research(input,progress=()=>{}){
    progress('참고 매체의 최신 기사 후보를 수집하고 있습니다…');
    const {candidates,coverage}=await discoverCandidates({now:Date.parse(input.now)});
    const limit=Math.min(MAX_ARTICLES,Math.max(1,Number(input.maxArticles)||MAX_ARTICLES));
    const targets=input.maxArticles?[]:referenceTargets(Date.parse(input.now));
    const targetURLs=new Set(targets.map(t=>canonical(t.url)));
    const selected=candidates.filter(a=>!targetURLs.has(a.url)).slice(0,limit),batches=[];
    const targetCandidates=targets.map(t=>referenceCandidate(t,candidates.find(a=>a.url===t.url)));
    const {evidence,warnings:evidenceWarnings}=await fetchEvidence([...targetCandidates,...selected],{now:Date.parse(input.now),progress});
    const enrich=rows=>rows.map(a=>evidence.get(a.url)||a);
    const verified=rows=>rows.filter(a=>evidence.has(a.url)).map(a=>a.url);
    for(let i=0;i<targets.length;i+=10){const rows=targetCandidates.slice(i,i+10);batches.push({candidates:enrich(rows),coverage:[],targets:rows.filter(a=>!evidence.has(a.url)),verifiedUrls:verified(rows)});}
    for(let i=0;i<selected.length;i+=20){const rows=selected.slice(i,i+20);batches.push({candidates:enrich(rows),coverage:[],verifiedUrls:verified(rows)});}
    // Sources without usable feeds receive their own investigation, rather than competing with feed articles for 30 slots.
    const missing=coverage.filter(c=>c.status==='needs-search');
    for(let i=0;i<missing.length;i+=4)batches.push({candidates:[],coverage:missing.slice(i,i+4)});
    const articles=new Map(),consulted=new Set(),warnings=[...evidenceWarnings],profiles=[];let searched=false,sourceAccessed=evidence.size>0,quotaError=null;
    for(const row of [...targetCandidates,...selected]){const source=evidence.get(row.url)|| (row.reference?row:null);if(!source)continue;const a=basicArticle(source,input.feedback,Date.parse(input.now));if(a){articles.set(a.url,a);consulted.add(a.url);}}
    await mkdir(new URL('../.runtime/',import.meta.url),{recursive:true});let checkpoint=Promise.resolve();
    if(candidates.length>limit)warnings.push(`후보 ${candidates.length}개 중 최신 ${limit}개를 원문 검토했습니다. 나머지 ${candidates.length-limit}개는 이번 조사에서 검토하지 못했습니다.`);
    // Every eligible original remains visible even when the selected AI cannot complete an assessment.
    // Bound AI enrichment to reference articles and the newest candidate batch; collecting does not require 16 expensive model turns.
    const aiBatches=input.model==='source-ranking'?[]:batches.slice(0,targets.length?4:1);
    if(aiBatches.length<batches.length)warnings.push(`원문 기반 기본 순위는 전체 기사에 적용했습니다. AI 의미 평가는 우선 ${aiBatches.length}개 묶음에 적용하며 나머지는 기본 평가로 표시합니다.`);
    await runBatches(aiBatches,async(batch,i,completed)=>{
      if(quotaError)return;
      progress(`${completed()}/${aiBatches.length} 완료 · 조사 ${i+1} · 검증 기사 ${articles.size}개`);
      try{const result=await this.researchBatch({...input,...batch,maxArticles:Math.min(40,limit)},message=>progress(`${completed()}/${aiBatches.length} 완료 · 조사 ${i+1} · 검증 ${articles.size}개 · ${message}`));
        searched ||= result.searchExecuted;sourceAccessed ||= result.sourceAccessExecuted;for(const url of result.consulted)consulted.add(url);
        for(const a of result.research.articles){const prior=articles.get(a.url);articles.set(a.url,{...a,reference:!!prior?.reference,assessment:'ai'});}
        for(const candidate of batch.candidates)if(!result.research.articles.some(a=>a.url===candidate.url))warnings.push(`${candidate.publisher}: ${candidate.title} — AI 평가를 완료하지 못해 확인된 기본 순위를 유지했습니다.`);
        warnings.push(...result.research.warnings);profiles.push(result.research.profile);
        if(batch.coverage.length)for(const c of batch.coverage)c.status='searched';
      }catch(e){if(/usage limit|rate.?limit|사용량 한도/i.test(e.message))quotaError=e.message;warnings.push(`조사 묶음 ${i+1} 실패: ${e.message}`);for(const c of batch.coverage)c.status='failed';}
      checkpoint=checkpoint.then(()=>writeFile(new URL('../.runtime/collection-progress.json',import.meta.url),JSON.stringify({requestedAt:input.now,totalBatches:batches.length,coverage,articles:[...articles.values()],consulted:[...consulted],warnings},null,2))).catch(()=>{});
    },3);
    await checkpoint;
    if(!articles.size)throw new Error('새 원문 검증에 성공한 기사가 없습니다. 이전 결과를 유지합니다.');
    const all=[...articles.values()];const reserved=all.filter(a=>a.reference);const stored=[...reserved,...all.filter(a=>!a.reference).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))].slice(0,limit);
    const result={research:{articles:stored,warnings:warnings.slice(0,250),profile:[...new Set(profiles)].join('\n').slice(0,1500)||'원문과 발행일, 기사 성격, 기본 취향 유사도로 순위를 계산했습니다. 기본 평가·원문 미확인 표시는 AI 의미 평가가 완료되지 않은 기사입니다.'},coverage,consulted:[...consulted],searchExecuted:searched,sourceAccessExecuted:sourceAccessed,model:input.model,mode:'app'};
    await writeFile(new URL('../.runtime/collection-result.json',import.meta.url),JSON.stringify(result,null,2));return result;
  }
  async researchBatch(input,progress=()=>{}){
    await this.start();const cwd=fileURLToPath(new URL('../.runtime/app-research/',import.meta.url));await mkdir(cwd,{recursive:true});
    // Disable configured MCP servers for this isolated research thread, without changing user settings.
    const config={web_search:'live'};const settings=await this.request('config/read',{includeLayers:false});for(const name of Object.keys(settings.config?.mcp_servers||{}))config[`mcp_servers.${name}.enabled`]=false;
    const {thread}=await this.request('thread/start',{model:input.model,cwd,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',config,
      baseInstructions:'당신은 웹 검색만 수행하는 뉴스 조사 편집장입니다. 파일 읽기·수정, 명령 실행, MCP, 다른 에이전트 호출을 하지 않습니다.',
      developerInstructions:researchInstructions()+` 이번 묶음은 최대 ${Math.min(40,Math.max(1,Number(input.maxArticles)||40))}개 기사를 조사합니다. candidates가 있으면 모든 후보를 확인하십시오. coverage에 지정된 출처가 있으면 각 출처에서 최근 기사를 조사하십시오. targets가 있으면 사용자가 제시한 각 기사 주제를 개별 검색하고 원문을 확인하십시오. 찾지 못한 주제는 warnings에 남기십시오. 참고 검색 주제는 검증된 사실이 아니므로 그대로 기사로 만들지 마십시오. 관련 없는 다른 매체를 무작정 조사하지 마십시오.`+' verifiedUrls의 원문은 PC가 실제 HTTP 접근과 발행일을 확인했으므로 제공한 content를 읽고 평가하십시오. 이 원문을 반복 검색·openPage 하지 마십시오. verifiedUrls에 없는 선택 원문·관련 URL은 실제 https URL로 openPage 웹 도구를 호출해서 확인하십시오. 검색 결과 ID 대신 실제 원문 URL로 여십시오. 전문 접근을 못 하면 공개 근거만 사용하고 warnings에 명시하십시오.'});
    const items=new Map(),consulted=new Set(input.verifiedUrls||[]);let search=false;
    let settle;const done=new Promise((resolve,reject)=>{settle={resolve,reject};});
    const onItem=p=>{if(p.threadId!==thread.id)return;const item=p.item;items.set(item.id,item);if(item.type==='webSearch'){search=true;progress('앱에서 웹 검색과 원문 확인을 진행하고 있습니다…');if(item.action?.url){try{consulted.add(canonical(item.action.url));}catch{}}}};
    const onDone=p=>{if(p.threadId===thread.id)settle.resolve(p.turn);};
    const onDisconnect=e=>settle.reject(e);this.on('item/completed',onItem);this.on('turn/completed',onDone);this.on('disconnected',onDisconnect);
    let timer;try{const {turn}=await this.request('turn/start',{threadId:thread.id,input:[{type:'text',text:JSON.stringify(researchInput(input))}]});timer=setTimeout(()=>{this.request('turn/interrupt',{threadId:thread.id,turnId:turn.id}).catch(()=>{});settle.reject(new Error('뉴스 조사 시간이 초과되었습니다. 기존 결과를 유지합니다.'));},12*60000);
      const final=await done;if(final.status!=='completed')throw new Error(final.error?.message||'앱의 뉴스 조사가 완료되지 않았습니다.');if(!search&&!input.verifiedUrls?.length)throw new Error('실제 웹 검색 또는 원문 확인이 수행되지 않았습니다.');
      const messages=[...items.values()].filter(i=>i.type==='agentMessage');const last=messages.filter(i=>i.phase==='final_answer').at(-1)||messages.at(-1);if(!last?.text)throw new Error('기사 결과가 없습니다.');let parsed;try{parsed=JSON.parse(last.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new Error('AI 기사 결과 형식이 올바르지 않습니다.');}
      this.lastResearch={parsed,consulted:[...consulted],actions:[...items.values()].filter(i=>i.type==='webSearch').map(i=>i.action)};
      progress('기사 근거와 배점을 확인하고 있습니다…');return {research:validateResearch(parsed,[...consulted],Date.parse(input.now)),consulted:[...consulted],searchExecuted:search,sourceAccessExecuted:!!input.verifiedUrls?.length,model:input.model,mode:'app'};
    }finally{clearTimeout(timer);this.off('item/completed',onItem);this.off('turn/completed',onDone);this.off('disconnected',onDisconnect);this.request('thread/archive',{threadId:thread.id}).catch(()=>{});}
  }
  close(){this.process?.kill();this.process=null;this.ready=null;}
}
