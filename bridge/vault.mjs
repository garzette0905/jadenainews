import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
const folder=new URL('../.runtime/',import.meta.url),file=new URL('oauth.dpapi',folder);
function dpapi(value,decrypt=false){return new Promise((resolve,reject)=>{if(process.platform!=='win32')return reject(new Error('이 실행 프로그램은 Windows 자격 증명 암호화를 사용합니다.'));
  const script="Add-Type -AssemblyName System.Security; $jadenText=[Console]::In.ReadToEnd(); $jadenBytes=[Convert]::FromBase64String($jadenText); $jadenResult=[System.Security.Cryptography.ProtectedData]::"+(decrypt?'Unprotect':'Protect')+"($jadenBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($jadenResult))";
  const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';p.stdout.on('data',c=>output+=c);p.stderr.resume();p.on('error',()=>reject(new Error('Windows 자격 증명 암호화를 실행하지 못했습니다.')));p.on('close',code=>code===0?resolve(output.trim()):reject(new Error('Windows 자격 증명 암호화에 실패했습니다.')));p.stdin.end(value);});}
export async function saveCredentials(data){await mkdir(folder,{recursive:true});const encrypted=await dpapi(Buffer.from(JSON.stringify(data)).toString('base64'));const temp=new URL('oauth.dpapi.tmp',folder);await writeFile(temp,encrypted);await rename(temp,file);}
export async function loadCredentials(){try{return JSON.parse(Buffer.from(await dpapi(await readFile(file,'utf8'),true),'base64').toString('utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function clearCredentials(){try{await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
