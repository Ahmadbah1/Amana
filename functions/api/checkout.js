import {PLANS,json,notch} from '../../lib/license.js';
export async function onRequestPost({request,env}){
  const {plan,phone,dev}=await request.json().catch(()=>({}));
  let ph=String(phone||'').replace(/\s/g,'');if(/^\d{9}$/.test(ph))ph='+237'+ph;
  const P=PLANS[plan];if(!P||!dev||!/^\+\d{10,15}$/.test(ph))return json({error:'bad_request'},400);
  const ref='amana_'+plan+'_'+crypto.randomUUID().slice(0,12);
  const d=await notch(env,'/payments',{method:'POST',body:JSON.stringify({amount:P.amount,currency:'XAF',customer:{name:'Client Amana',phone:ph},description:P.label,reference:ref,callback:new URL(request.url).origin+'/app.html',metadata:{plan}})});
  if(!d.authorization_url)return json({error:'notch',detail:d.message},502);
  await env.LIC.put('pay:'+ref,JSON.stringify({plan,dev}),{expirationTtl:604800});
  return json({url:d.authorization_url});
}
