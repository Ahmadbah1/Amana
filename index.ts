import { createClient } from 'npm:@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 const reply=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...headers,'Content-Type':'application/json'}});
 try{
  if(req.method!=='POST')return reply({error:'Method'},405);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)return reply({error:'Unauthorized'},401);
  const {data:p}=await db.from('profiles').select('*').eq('id',user.id).single();
  if(p?.role!=='admin'||p.status!=='active')return reply({error:'Forbidden'},403);
  const {email,password,full_name}=await req.json();
  if(typeof password!=='string'||password.length<12||!email||!full_name)return reply({error:'Email, name and password (12+) required'},400);
  const {data:u,error:e}=await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name}});
  if(e)throw e;
  const {error:pe}=await db.from('profiles').insert({id:u.user.id,company_id:p.company_id,email,full_name,role:'employee',status:'active'});
  if(pe){await db.auth.admin.deleteUser(u.user.id);throw pe;}
  return reply({ok:true});
 }catch(e){return reply({error:e.message},400);}
});
