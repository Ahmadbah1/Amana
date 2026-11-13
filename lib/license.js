// Offres : MODIFIEZ ICI les prix (en FCFA) et les durées (en jours)
export const PLANS={month:{amount:1500,days:31,label:'Amana Pro - 1 mois'},year:{amount:15000,days:366,label:'Amana Pro - 1 an'}};
const enc=new TextEncoder();
const key=s=>crypto.subtle.importKey('raw',enc.encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function sign(o,secret){const p=b64(enc.encode(JSON.stringify(o)));return p+'.'+b64(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(p)))}
export async function verify(tok,secret){const [p,s]=(tok||'').split('.');if(!p||!s)return null;
  if(b64(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(p)))!==s)return null;
  try{return JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')))}catch{return null}}
export const json=(o,st=200)=>new Response(JSON.stringify(o),{status:st,headers:{'content-type':'application/json','cache-control':'no-store'}});
export const notch=async(env,path,opt={})=>(await fetch('https://api.notchpay.co'+path,{...opt,headers:{Authorization:env.NOTCH_KEY,'Content-Type':'application/json'}})).json();
