import {PLANS,json,notch,sign,verify} from '../../lib/license.js';
export async function onRequestGet({request,env}){
  const u=new URL(request.url),ref=u.searchParams.get('ref'),dev=u.searchParams.get('dev');
  if(!ref||!dev)return json({error:'bad_request'},400);
  const tx=(await notch(env,'/payments/'+encodeURIComponent(ref))).transaction;       // vérification directe auprès de Notch Pay
  if(!tx||tx.status!=='complete')return json({error:'not_paid',status:tx&&tx.status},402);
  const meta=JSON.parse(await env.LIC.get('pay:'+tx.trxref)||'null');
  if(!meta)return json({error:'unknown_payment'},404);
  const P=PLANS[meta.plan];if(!P||Number(tx.amount)<P.amount)return json({error:'amount'},402);
  let lic=JSON.parse(await env.LIC.get('lic:'+tx.trxref)||'null');
  if(!lic){                                                                              // première activation : on prolonge l'abonnement en cours s'il existe
    const old=await verify(u.searchParams.get('token'),env.SIGN_SECRET),base=Math.max(Date.now(),old&&old.dev===dev?old.exp:0);
    lic={plan:meta.plan,dev:meta.dev,exp:base+P.days*864e5};await env.LIC.put('lic:'+tx.trxref,JSON.stringify(lic));}
  if(lic.dev!==dev)return json({error:'other_device'},409);
  return json({token:await sign({r:tx.trxref,dev,exp:lic.exp,plan:lic.plan},env.SIGN_SECRET),exp:lic.exp,plan:lic.plan});
}
