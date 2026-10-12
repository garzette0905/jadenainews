const OWNER='garzette@paran.com';
const ADMIN='garzette.kim@samsungsds.com',INITIAL=[OWNER,ADMIN];
const fail=(message,status=403)=>{throw Object.assign(new Error(message),{status});};
export function userDisplayName(request,storedName,email){
  let name=request.headers.get('oai-authenticated-user-full-name')||'';
  if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){
    try{name=decodeURIComponent(name);}catch{name='';}
  }
  return (name.trim()||String(storedName||'').trim()||email||'사용자').replace(/[\r\n\t]/g,' ').slice(0,100);
}
export async function member(env,request,user){
  if(!env.DB){if(env.LOCAL_PREVIEW==='1')return {email:OWNER,role:'owner',status:'active'};return null;}
  const email=(request.headers.get('oai-authenticated-user-email')||(env.LOCAL_PREVIEW==='1'?OWNER:'')).trim().toLowerCase();
  if(!email)fail('로그인 이메일을 확인하지 못했습니다. 다시 로그인해 주세요.',401);
  const now=new Date().toISOString();
  // Defaults apply only to new bootstrap records; saved role changes are never reset.
  await env.DB.batch(INITIAL.map(e=>env.DB.prepare('INSERT OR IGNORE INTO users (email,name,role,status,created_at,is_admin) VALUES (?,?,?,?,?,?)').bind(e,e===OWNER?'Jaden Kim':'',e===OWNER?'owner':'viewer','active',now,e===ADMIN?1:0)));
  const row=await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if(!row)fail('등록된 사용자가 아닙니다. 관리자에게 이메일 등록을 요청하세요.');
  if(row.status==='disabled')fail('사용이 중지된 계정입니다. 관리자에게 문의하세요.');
  if(row.user_id&&row.user_id!==user)fail('계정 식별자가 일치하지 않습니다. 관리자에게 문의하세요.');
  // Reaching this route with trusted Sites identity proves platform access was granted.
  await env.DB.prepare("UPDATE users SET user_id = ?, status = 'active', last_seen_at = ? WHERE email = ? AND status != 'disabled'").bind(user,now,email).run();
  return {...row,name:userDisplayName(request,row.name,email),role:row.role==='owner'?'owner':row.is_admin===1?'admin':'viewer',user_id:user,status:'active',last_seen_at:now};
}
export async function manageUsers(env,actor,data){
  if(!actor||!['owner','admin'].includes(actor.role))fail('관리자만 사용자 정보를 관리할 수 있습니다.');
  if(!env.DB)fail('사용자 DB가 연결되지 않았습니다.',503);
  if(!data)return {users:(await env.DB.prepare("SELECT email,name,CASE WHEN role = 'owner' THEN 'owner' WHEN is_admin = 1 THEN 'admin' ELSE 'viewer' END AS role,status,created_at,last_seen_at FROM users ORDER BY role,created_at,email").all()).results};
  const email=String(data.email||'').trim().toLowerCase();
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('올바른 이메일 주소를 입력하세요.',400);
  if(email===OWNER)fail('사이트 소유자는 변경할 수 없습니다.',400);
  if(email===actor.email&&data.action==='disable')fail('본인 계정은 사용 중지할 수 없습니다.',400);
  if(data.action==='add'){
    await env.DB.prepare("INSERT INTO users (email,name,role,status,created_at) VALUES (?,?,'viewer','pending',?) ON CONFLICT(email) DO NOTHING").bind(email,String(data.name||'').trim().slice(0,100),new Date().toISOString()).run();
  }else if(data.action==='set-role'){
    if(actor.role!=='owner')fail('사용자 권한은 소유자만 변경할 수 있습니다.');
    if(!['admin','viewer'].includes(data.role))fail('권한은 관리자 또는 조회 전용 사용자만 선택할 수 있습니다.',400);
    const target=await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
    if(!target)fail('등록된 사용자를 찾을 수 없습니다.',404);
    await env.DB.prepare("UPDATE users SET is_admin = ? WHERE email = ? AND role != 'owner'").bind(data.role==='admin'?1:0,email).run();
  }else if(['disable','enable'].includes(data.action)){
    await env.DB.prepare("UPDATE users SET status = ? WHERE email = ? AND role != 'owner'").bind(data.action==='disable'?'disabled':'pending',email).run();
  }else fail('허용되지 않은 변경입니다.',400);
  return manageUsers(env,actor);
}
