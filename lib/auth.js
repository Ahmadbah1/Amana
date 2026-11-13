import {sign,verify,json} from './license.js';
const enc=new TextEncoder();
export const rid=()=>crypto.randomUUID();
export const phone=p=>{p=String(p||'').replace(/[\s.-]/g,'');if(/^\d{9}$/.test(p))p='+237'+p;if(/^237\d{9}$/.test(p))p='+'+p;return /^\+\d{10,15}$/.test(p)?p:null};
export async function hash(pw,salt){const k=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveBits']);
  return [...new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},k,256))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export const session=(env,u)=>sign({u:u.id,exp:Date.now()+30*864e5},env.SIGN_SECRET);
export async function me({request,env}){                      // l'utilisateur est relu en base à chaque requête : un compte désactivé perd l'accès immédiatement
  const p=await verify((request.headers.get('authorization')||'').replace('Bearer ',''),env.SIGN_SECRET);
  if(!p||p.exp<Date.now())return null;
  return env.DB.prepare('SELECT id,org_id,shop_id,role,name,phone FROM users WHERE id=? AND active=1').bind(p.u).first()}
export const audit=(env,u,action,target,detail)=>env.DB.prepare('INSERT INTO audit(org_id,user_id,action,target,at,detail) VALUES(?,?,?,?,?,?)').bind(u.org_id,u.id,action,target||null,Date.now(),detail?JSON.stringify(detail):null).run();
export {json};
