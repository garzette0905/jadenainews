const COOKIE='__Host-news-session';
const authFail=(message,status=401)=>{throw Object.assign(new Error(message),{status});};
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export function validLoginId(value){return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);}
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
  const row=await env.DB.prepare('SELECT u.* FROM app_sessions s JOIN users u ON u.email = s.email WHERE s.token_hash = ? AND s.expires_at > ?').bind(await digest(token),Date.now()).first();
  if(!row||row.status==='disabled')authFail('로그인이 만료되었거나 사용할 수 없는 계정입니다.');
  return {...row,name:row.name||row.login_id,role:row.role==='owner'?'owner':row.is_admin===1?'admin':'viewer'};
}
export async function login(env,request,data){
  if(!env.LOGIN_PASSWORD)authFail('로그인 서버 설정을 확인해 주세요.',503);
  const now=Date.now(),client=await digest(request.headers.get('cf-connecting-ip')||'unknown');
  await env.DB.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').bind(now).run();
  await env.DB.prepare('INSERT INTO login_attempts (client_hash,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(client_hash) DO UPDATE SET attempts = attempts + 1').bind(client,now+900000).run();
  const limit=await env.DB.prepare('SELECT attempts FROM login_attempts WHERE client_hash = ?').bind(client).first();
  if(limit.attempts>15)authFail('로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.',429);
  const id=String(data.loginId||'').trim().toLowerCase(),password=String(data.password||'');
  const actual=await digest(password),expected=await digest(env.LOGIN_PASSWORD);let difference=0;for(let i=0;i<actual.length;i++)difference|=actual.charCodeAt(i)^expected.charCodeAt(i);
  await initializeLoginIds(env);
  const row=validLoginId(id)?await env.DB.prepare('SELECT * FROM users WHERE login_id = ? COLLATE NOCASE').bind(id).first():null;
  if(difference||!row||row.status==='disabled')authFail('아이디 또는 암호를 확인해 주세요.');
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').bind(now).run();
  await env.DB.prepare('INSERT INTO app_sessions (token_hash,email,expires_at) VALUES (?,?,?)').bind(await digest(token),row.email,now+86400000).run();
  await env.DB.prepare("UPDATE users SET status = 'active', last_seen_at = ? WHERE email = ?").bind(new Date(now).toISOString(),row.email).run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
}
export async function logout(env,request){
  const token=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(token)await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(await digest(token)).run();
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
