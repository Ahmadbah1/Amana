import { createClient } from 'npm:@supabase/supabase-js@2.105.0';
const site=Deno.env.get('AMANA_SITE_URL')||'https://amana-project.vercel.app/';
const allowed=new URL(site).origin;
Deno.serve(async req=>{
 const origin=req.headers.get('origin');const headers={'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(origin&&origin!==allowed)return reply({error:'Origin refused'},403);
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Method'},405);
 try{
 const url=Deno.env.get('SUPABASE_URL')!,publicKey=Deno.env.get('SUPABASE_ANON_KEY')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const authorization=req.headers.get('authorization')||'';
 const token=authorization.replace(/^Bearer\s+/i,'');
 const root=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await root.auth.getUser(token);
 if(authError||!user)return reply({error:'Unauthorized'},401);
 const {data:p}=await root.from('profiles').select('role,status').eq('id',user.id).single();
 if(p?.role!=='admin'||p.status!=='active')return reply({error:'Forbidden'},403);
 const body=await req.json();
 if(typeof body.email!=='string'||typeof body.full_name!=='string')return reply({error:'Email and name required'},400);
 const caller=createClient(url,publicKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:reserved,error:reserveError}=await caller.rpc('reserve_employee_invitation',{target_email:body.email,target_name:body.full_name});
 if(reserveError)return reply({error:reserveError.message},429);
 const inv=Array.isArray(reserved)?reserved[0]:reserved;
 if(!inv?.id)return reply({error:'Invitation reservation failed'},500);
 // Le service Auth envoie le lien ; le gérant ne choisit ni ne connaît le mot de passe.
 const {error}=await root.auth.admin.inviteUserByEmail(inv.email,{data:{full_name:inv.full_name,amana_invitation_id:inv.id},redirectTo:new URL('?invitation=1',site).href});
 if(error){await root.from('employee_invitations').update({status:'failed',error_code:error.code||'delivery_error'}).eq('id',inv.id);return reply({error:'Invitation non envoyée. Vérifiez le SMTP ou si cette adresse possède déjà un compte.'},400);}
 return reply({ok:true});
 }catch{return reply({error:'Invitation impossible. Vérifiez la configuration et réessayez.'},400)}
});
