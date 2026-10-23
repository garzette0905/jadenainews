const COOKIE='__Host-news-session';
// CHIPS isolates an embedded session by its top-level site. Direct visits stay Strict.
const sessionCookie=(token,embedded,maxAge)=>`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=${embedded===true?'None; Partitioned':'Strict'}; Max-Age=${maxAge}`;
const authFail=(message,status=401)=>{throw Object.assign(new Error(message),{status});};
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export function validLoginId(value){return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);}
export function validPassword(value){return typeof value==='string'&&value.length>=6&&value.length<=128&&!/[\r\n\u0000]/.test(value);}
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export async function passwordRecord(password,salt=hex(crypto.getRandomValues(new Uint8Array(16)))){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const hash=hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256));
  return {hash,salt};
}
const sameHash=(a,b)=>{let diff=a.length^b.length;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^(b.charCodeAt(i)||0);return diff===0;};
export async function setPassword(env,email,password){
  if(!validPassword(password))authFail('암호는 6~128자로 입력하세요.',400);
  const {hash,salt}=await passwordRecord(password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, password_version = password_version + 1, password_updated_at = ? WHERE email = ?').bind(hash,salt,new Date().toISOString(),email),
    env.DB.prepare('DELETE FROM app_sessions WHERE email = ?').bind(email)
  ]);
}
export async function initializeLoginIds(env){
  const rows=(await env.DB.prepare('SELECT email FROM users WHERE login_id IS NULL ORDER BY created_at,email').all()).results;
  for(const row of rows){let id=row.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,52);if(!validLoginId(id))id='user';
    const collision=await env.DB.prepare('SELECT email FROM users WHERE login_id = ? COLLATE NOCASE').bind(id).first();if(collision)id+='-'+(await digest(row.email)).slice(0,10);
    await env.DB.prepare('UPDATE OR IGNORE users SET login_id = ? WHERE email = ? AND login_id IS NULL').bind(id,row.email).run();
  }
}
export async function sessionMember(env,request){
  const token=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token||!/^[a-f0-9]{64}$/.test(token))authFail('로그인이 필요합니다.');
  const row=await env.DB.prepare('SELECT u.* FROM app_sessions s JOIN users u ON u.email = s.email WHERE s.token_hash = ? AND s.expires_at > ? AND s.password_version = u.password_version').bind(await digest(token),Date.now()).first();
  if(!row||row.status==='disabled')authFail('로그인이 만료되었거나 사용할 수 없는 계정입니다.');
  return {...row,name:row.name||row.login_id,role:row.role==='owner'?'owner':row.is_admin===1?'admin':'viewer'};
}
export async function login(env,request,data){
  const now=Date.now(),client=await digest(request.headers.get('cf-connecting-ip')||'unknown');
  await env.DB.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').bind(now).run();
  await env.DB.prepare('INSERT INTO login_attempts (client_hash,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(client_hash) DO UPDATE SET attempts = attempts + 1').bind(client,now+900000).run();
  const limit=await env.DB.prepare('SELECT attempts FROM login_attempts WHERE client_hash = ?').bind(client).first();
  if(limit.attempts>15)authFail('로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.',429);
  const id=String(data.loginId||'').trim().toLowerCase(),password=String(data.password||'');
  await initializeLoginIds(env);
  let row=id.length<=254?await env.DB.prepare('SELECT * FROM users WHERE login_id = ? COLLATE NOCASE OR email = ?').bind(id,id).first():null;
  if(!validPassword(password))authFail('아이디 또는 암호를 확인해 주세요.');
  // Only the owner may initialize a legacy password from a server secret.
  if(row?.role==='owner'&&!row.password_hash&&env.OWNER_BOOTSTRAP_PASSWORD){
    if(sameHash(await digest(password),await digest(env.OWNER_BOOTSTRAP_PASSWORD))){
      const record=await passwordRecord(password);
      await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, password_updated_at = ? WHERE email = ? AND password_hash IS NULL').bind(record.hash,record.salt,new Date(now).toISOString(),row.email).run();
      row=await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(row.email).first();
    }
  }
  const actual=await passwordRecord(password,row?.password_salt||'unregistered-account');
  if(!row||row.status==='disabled'||!row.password_hash||!sameHash(actual.hash,row.password_hash))authFail('아이디 또는 암호를 확인해 주세요.');
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').bind(now).run();
  await env.DB.prepare('INSERT INTO app_sessions (token_hash,email,expires_at,password_version) VALUES (?,?,?,?)').bind(await digest(token),row.email,now+86400000,row.password_version).run();
  await env.DB.prepare("UPDATE users SET status = 'active', last_seen_at = ? WHERE email = ?").bind(new Date(now).toISOString(),row.email).run();
  return sessionCookie(token,data.embedded,86400);
}
export async function logout(env,request,data={}){
  const token=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(token)await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(await digest(token)).run();
  return sessionCookie('',data.embedded,0);
}
