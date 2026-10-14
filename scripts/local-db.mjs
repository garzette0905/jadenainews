import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function localDB(path=':memory:'){
  const db=new DatabaseSync(path);
  if(!db.prepare("SELECT name FROM sqlite_master WHERE name='users'").get())db.exec(readFileSync(new URL('../drizzle/0000_users.sql',import.meta.url),'utf8'));
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='is_admin'))db.exec(readFileSync(new URL('../drizzle/0001_admin_flag.sql',import.meta.url),'utf8'));
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='login_id'))db.exec(readFileSync(new URL('../drizzle/0002_app_login.sql',import.meta.url),'utf8'));
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='password_hash'))db.exec(readFileSync(new URL('../drizzle/0003_user_passwords.sql',import.meta.url),'utf8'));
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='news_email_enabled'))db.exec(readFileSync(new URL('../drizzle/0004_news_email.sql',import.meta.url),'utf8'));
  return {prepare(sql){let args=[];const stmt=db.prepare(sql);const api={bind(...v){args=v;return api;},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return stmt.run(...args);}};return api;},async batch(items){db.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();}};
}
