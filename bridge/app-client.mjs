import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {researchInstructions,researchInput,validateResearch,canonical} from '../shared/news.mjs';

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
    const models=[];let cursor;do{const r=await this.request('model/list',{limit:50,includeHidden:false,...(cursor?{cursor}:{})});models.push(...r.data.map(m=>({slug:m.model,display_name:m.displayName,isDefault:m.isDefault})));cursor=r.nextCursor;}while(cursor);return {connected:true,mode:'app',email:account.email||'',planType:account.planType,models};}
  async research(input,progress=()=>{}){
    await this.start();const cwd=fileURLToPath(new URL('../.runtime/app-research/',import.meta.url));await mkdir(cwd,{recursive:true});
    // Disable configured MCP servers for this isolated research thread, without changing user settings.
    const config={web_search:'live'};const settings=await this.request('config/read',{includeLayers:false});for(const name of Object.keys(settings.config?.mcp_servers||{}))config[`mcp_servers.${name}.enabled`]=false;
    const {thread}=await this.request('thread/start',{model:input.model,cwd,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',config,
      baseInstructions:'당신은 웹 검색만 수행하는 뉴스 조사 편집장입니다. 파일 읽기·수정, 명령 실행, MCP, 다른 에이전트 호출을 하지 않습니다.',
      developerInstructions:researchInstructions()+` 이번 요청은 최대 ${Math.min(30,Math.max(1,Number(input.maxArticles)||30))}개 사건을 조사합니다.`+' 선택한 대표·관련 원문 URL은 반드시 실제 https URL로 openPage 웹 도구를 호출해서 확인하십시오. 검색 결과 ID 대신 실제 원문 URL로 여십시오. 전문 접근을 못 하면 공개 근거만 사용하고 warnings에 명시하십시오.'});
    const items=new Map(),consulted=new Set();let search=false;
    let settle;const done=new Promise((resolve,reject)=>{settle={resolve,reject};});
    const onItem=p=>{if(p.threadId!==thread.id)return;const item=p.item;items.set(item.id,item);if(item.type==='webSearch'){search=true;progress('앱에서 웹 검색과 원문 확인을 진행하고 있습니다…');if(item.action?.url){try{consulted.add(canonical(item.action.url));}catch{}}}};
    const onDone=p=>{if(p.threadId===thread.id)settle.resolve(p.turn);};
    const onDisconnect=e=>settle.reject(e);this.on('item/completed',onItem);this.on('turn/completed',onDone);this.on('disconnected',onDisconnect);
    let timer;try{const {turn}=await this.request('turn/start',{threadId:thread.id,input:[{type:'text',text:JSON.stringify(researchInput(input))}]});timer=setTimeout(()=>{this.request('turn/interrupt',{threadId:thread.id,turnId:turn.id}).catch(()=>{});settle.reject(new Error('뉴스 조사 시간이 초과되었습니다. 기존 결과를 유지합니다.'));},12*60000);
      const final=await done;if(final.status!=='completed')throw new Error(final.error?.message||'앱의 뉴스 조사가 완료되지 않았습니다.');if(!search)throw new Error('실제 웹 검색이 수행되지 않았습니다.');
      const messages=[...items.values()].filter(i=>i.type==='agentMessage');const last=messages.filter(i=>i.phase==='final_answer').at(-1)||messages.at(-1);if(!last?.text)throw new Error('기사 결과가 없습니다.');let parsed;try{parsed=JSON.parse(last.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new Error('AI 기사 결과 형식이 올바르지 않습니다.');}
      this.lastResearch={parsed,consulted:[...consulted],actions:[...items.values()].filter(i=>i.type==='webSearch').map(i=>i.action)};
      progress('기사 근거와 배점을 확인하고 있습니다…');return {research:validateResearch(parsed,[...consulted],Date.parse(input.now)),consulted:[...consulted],searchExecuted:true,model:input.model,mode:'app'};
    }finally{clearTimeout(timer);this.off('item/completed',onItem);this.off('turn/completed',onDone);this.off('disconnected',onDisconnect);this.request('thread/archive',{threadId:thread.id}).catch(()=>{});}
  }
  close(){this.process?.kill();this.process=null;this.ready=null;}
}
