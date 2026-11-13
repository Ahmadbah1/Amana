import {json,verify} from '../../lib/license.js';
export async function onRequestGet({request,env}){
  const u=new URL(request.url),p=await verify(u.searchParams.get('token'),env.SIGN_SECRET);
  if(!p||p.dev!==u.searchParams.get('dev'))return json({pro:false,invalid:true});
  return json(p.exp>Date.now()?{pro:true,exp:p.exp,plan:p.plan}:{pro:false,expired:true});
}
