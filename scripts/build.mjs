import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const shared=await read('shared/news.mjs');
const assets={'/':['text/html; charset=utf-8',await read('web/index.html')],'/style.css':['text/css; charset=utf-8',(await read('web/base.css'))+'\n'+await read('web/extra.css')],'/app.js':['text/javascript; charset=utf-8',await read('web/app.js')],'/news.mjs':['text/javascript; charset=utf-8',shared]};
const worker=(await read('worker/index.js')).replace("import {canonical,rankArticles,validateResearch} from '../shared/news.mjs';",shared.replace(/^export /gm,''))
 .replace('/* ASSETS */ {}',JSON.stringify(assets));
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),worker);await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
console.log('Built Jaden AI News Worker with embedded UI assets.');
