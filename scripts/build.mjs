import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const headlines=(await read('shared/headlines.mjs')).replace("import edits from './headline-edits.json' with {type:'json'};",'const edits='+await read('shared/headline-edits.json')+';');
const shared=(await read('shared/news.mjs')).replace("import {editorialHeadline,headlineInstructions} from './headlines.mjs';",headlines);
const version=createHash('sha256').update(shared+await read('web/app.js')+await read('web/extra.css')+await read('web/base.css')+await read('web/index.html')).digest('hex').slice(0,12);
const broker=(await read('worker/broker.mjs')).replace(/import \{[^}]+\} from '\.\.\/shared\/news\.mjs';/,'').replace(/^export /gm,'');
const auth=(await read('worker/auth.mjs')).replace(/^export /gm,'');
const users=(await read('worker/users.mjs')).replace("import {validLoginId,initializeLoginIds,validPassword,passwordRecord,setPassword} from './auth.mjs';",'').replace(/^export /gm,'');
const assets={'/':['text/html; charset=utf-8',(await read('web/index.html')).replace('/app.js','/app.js?v='+version).replace('/style.css','/style.css?v='+version)],'/style.css':['text/css; charset=utf-8',(await read('web/base.css'))+'\n'+await read('web/extra.css')],'/app.js':['text/javascript; charset=utf-8',(await read('web/app.js')).replace("from '/news.mjs'","from '/news.mjs?v="+version+"'")],'/news.mjs':['text/javascript; charset=utf-8',shared]};
const worker=(await read('worker/index.js')).replace(/import \{[^}]+\} from '\.\.\/shared\/news\.mjs';/,shared.replace(/^export /gm,''))
 .replace("import {handleAgent,agentStatus,enqueueCollection,collectionStatus} from './broker.mjs';",broker)
 .replace("import {member,manageUsers} from './users.mjs';",users)
 .replace("import {sessionMember,login,logout} from './auth.mjs';",auth)
 .replace('/* ASSETS */ {}',JSON.stringify(assets));
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),worker);await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
console.log('Built Jaden AI News Worker with embedded UI assets.');
