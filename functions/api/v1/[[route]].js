import {rid,phone as normPhone,hash,session,me,audit,json} from '../../../lib/auth.js';
import {authUrl,callback,disconnect,status as gStatus,enqueue,flush} from '../../../lib/google.js';
const same=(a,b)=>a.length===b.length&&[...a].reduce((x,c,i)=>x|(c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const addMonths=(ms,n)=>{const d=new Date(ms),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.getTime()};
const pad=n=>String(n).padStart(4,'0'),METHODS=['mtn','om','cash','bank','card'],REASONS=['amount','duplicate','cancelled','other'];

export async function onRequest(ctx){
  const {request,params}=ctx,m=request.method,r=[].concat(params.route||[]).join('/');
  const B=m==='POST'?await request.json().catch(()=>({})):{};
  try{return await route(m,r,B,new URL(request.url),{request,env:ctx.env,waitUntil:ctx.waitUntil?ctx.waitUntil.bind(ctx):()=>{}})}catch(e){return json({error:'server',detail:String(e.message||e)},500)}
}

async function uniqueCode(DB,org,name){
  const base=(name||'').replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase().padEnd(3,'X');let c=base,i=1;
  while(await DB.prepare('SELECT 1 FROM shops WHERE org_id=? AND code=?').bind(org,c).first())c=base+(++i);return c}
const pubUser=x=>({id:x.id,org_id:x.org_id,shop_id:x.shop_id,role:x.role,name:x.name,phone:x.phone});

async function route(m,r,B,url,{request,env,waitUntil}){
  const DB=env.DB;
  /* ---- Inscription / connexion ---- */
  if(m==='POST'&&r==='auth/register'){
    const ph=normPhone(B.phone);
    if(!B.org||!B.name||!ph||String(B.password||'').length<8)return json({error:'bad_request'},400);
    if(await DB.prepare('SELECT 1 FROM users WHERE phone=?').bind(ph).first())return json({error:'phone_taken'},409);
    const oid=rid(),sid=rid(),uid=rid(),salt=rid(),now=Date.now(),shopName=B.shop||B.org;
    await DB.batch([
      DB.prepare('INSERT INTO orgs(id,name,niu,created_at) VALUES(?,?,?,?)').bind(oid,B.org,B.niu||null,now),
      DB.prepare('INSERT INTO shops(id,org_id,name,city,tel,code) VALUES(?,?,?,?,?,?)').bind(sid,oid,shopName,B.city||null,ph,await uniqueCode(DB,oid,shopName)),
      DB.prepare('INSERT INTO users(id,org_id,shop_id,role,name,phone,pw,salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid,oid,sid,'owner',B.name,ph,await hash(B.password,salt),salt,now)]);
    const u={id:uid,org_id:oid,shop_id:sid,role:'owner',name:B.name,phone:ph};
    return json({token:await session(env,u),user:u});
  }
  if(m==='POST'&&r==='auth/login'){
    const ph=normPhone(B.phone),x=ph&&await DB.prepare('SELECT * FROM users WHERE phone=?').bind(ph).first();
    if(!x||!x.active)return json({error:'invalid'},401);
    if(x.locked_until>Date.now())return json({error:'locked'},429);
    if(await hash(String(B.password||''),x.salt)!==x.pw){                      // 5 échecs : blocage de 15 minutes
      const f=x.fails+1;await DB.prepare('UPDATE users SET fails=?,locked_until=? WHERE id=?').bind(f>=5?0:f,f>=5?Date.now()+9e5:0,x.id).run();
      return json({error:'invalid'},401)}
    await DB.prepare('UPDATE users SET fails=0,locked_until=0 WHERE id=?').bind(x.id).run();
    return json({token:await session(env,pubUser(x)),user:pubUser(x)});
  }

  if(m==='GET'&&r==='google/callback')return callback(env,url,waitUntil);          // appelé par Google, sans jeton Amana (l'état signé fait foi)
  const u=await me({request,env});if(!u)return json({error:'unauthorized'},401);
  const owner=u.role==='owner',deny=()=>json({error:'forbidden'},403);
  let mm;
  /* ---- Super administrateur de la plateforme : Premium et suivi des paiements ---- */
  if(r.startsWith('admin/')){
    const isAdmin=!!await DB.prepare('SELECT 1 FROM platform_admins WHERE user_id=?').bind(u.id).first();
    if(m==='GET'&&r==='admin/me')return json({admin:isAdmin,claimable:!!env.ADMIN_KEY});
    if(m==='POST'&&r==='admin/claim'){                                           // activation avec la clé secrète du serveur (ADMIN_KEY), 5 essais maximum
      const x=await DB.prepare('SELECT fails,locked_until FROM users WHERE id=?').bind(u.id).first();
      if(x.locked_until>Date.now())return json({error:'locked'},429);
      if(!env.ADMIN_KEY||!same(String(B.key||''),env.ADMIN_KEY)){const f=x.fails+1;await DB.prepare('UPDATE users SET fails=?,locked_until=? WHERE id=?').bind(f>=5?0:f,f>=5?Date.now()+9e5:0,u.id).run();await audit(env,u,'admin.claim_failed');return deny()}
      await DB.prepare('UPDATE users SET fails=0 WHERE id=?').bind(u.id).run();
      await DB.prepare('INSERT OR IGNORE INTO platform_admins(user_id,created_at) VALUES(?,?)').bind(u.id,Date.now()).run();await audit(env,u,'admin.claim');return json({admin:true});
    }
    if(!isAdmin)return deny();
    const now=Date.now();
    if(m==='GET'&&r==='admin/orgs'){
      const rows=(await DB.prepare(`SELECT o.id,o.name,o.created_at,ow.name owner,ow.phone,
        (SELECT COUNT(*) FROM shops WHERE org_id=o.id) shops,(SELECT COUNT(*) FROM users WHERE org_id=o.id AND role='employee') employees,
        (SELECT COUNT(*) FROM receipts WHERE org_id=o.id AND created_at>=?) receipts30,sb.expires_at,
        (SELECT COALESCE(SUM(amount),0) FROM grants WHERE org_id=o.id AND kind='grant') paid_total,
        (SELECT created_at FROM grants WHERE org_id=o.id AND kind='grant' AND amount>0 ORDER BY created_at DESC LIMIT 1) last_paid_at,
        (SELECT COUNT(*) FROM grants WHERE org_id=o.id AND kind='grant') grants_n
        FROM orgs o JOIN users ow ON ow.org_id=o.id AND ow.role='owner' LEFT JOIN subscriptions sb ON sb.org_id=o.id ORDER BY o.created_at DESC LIMIT 1000`).bind(now-30*864e5).all()).results
        .map(x=>({...x,status:!x.expires_at?'free':x.expires_at<=now?'expired':x.expires_at-now<7*864e5?'expiring':'active',days_left:x.expires_at?Math.ceil((x.expires_at-now)/864e5):null}));
      const w=new Date(now+36e5),ms=Date.UTC(w.getUTCFullYear(),w.getUTCMonth(),1)-36e5,c=k=>rows.filter(x=>x.status===k).length;
      const tot=await DB.prepare("SELECT COALESCE(SUM(amount),0) total,COALESCE(SUM(CASE WHEN created_at>=? THEN amount END),0) month FROM grants WHERE kind='grant'").bind(ms).first();
      const f=url.searchParams.get('filter')||'',q=(url.searchParams.get('q')||'').toLowerCase().trim();
      const keep=x=>(!f||(f==='active'?['active','expiring'].includes(x.status):x.status===f))&&(!q||[x.name,x.owner,x.phone].some(v=>String(v||'').toLowerCase().includes(q)));
      return json({summary:{total:rows.length,active:c('active')+c('expiring'),expiring:c('expiring'),expired:c('expired'),free:c('free'),month_amount:tot.month,total_amount:tot.total},orgs:rows.filter(keep)});
    }
    if(m==='GET'&&(mm=r.match(/^admin\/orgs\/([\w-]+)\/history$/)))
      return json((await DB.prepare('SELECT g.id,g.kind,g.months,g.amount,g.method,g.ref,g.note,g.starts_at,g.expires_at,g.created_at,us.name admin FROM grants g JOIN users us ON us.id=g.admin_id WHERE g.org_id=? ORDER BY g.created_at DESC LIMIT 100').bind(mm[1]).all()).results);
    if(m==='POST'&&(mm=r.match(/^admin\/orgs\/([\w-]+)\/(grant|revoke)$/))){
      if(!await DB.prepare('SELECT 1 FROM orgs WHERE id=?').bind(mm[1]).first())return json({error:'not_found'},404);
      const cur=await DB.prepare('SELECT expires_at FROM subscriptions WHERE org_id=?').bind(mm[1]).first();
      if(mm[2]==='revoke'){
        if(!cur||cur.expires_at<=now)return json({error:'no_subscription'},400);
        await DB.batch([DB.prepare('UPDATE subscriptions SET expires_at=?,updated_at=? WHERE org_id=?').bind(now,now,mm[1]),
          DB.prepare("INSERT INTO grants(id,org_id,admin_id,kind,note,starts_at,expires_at,created_at) VALUES(?,?,?,'revoke',?,?,?,?)").bind(rid(),mm[1],u.id,String(B.note||'').slice(0,200),now,now,now)]);
        await audit(env,u,'admin.revoke',mm[1]);return json({ok:true});
      }
      const months=B.months,amount=B.amount===undefined||B.amount===''?0:+B.amount;
      if(!Number.isInteger(months)||months<1||months>12||!Number.isInteger(amount)||amount<0||amount>1e8)return json({error:'bad_request'},400);
      const start=Math.max(now,cur?cur.expires_at:0),exp=addMonths(start,months);       // un renouvellement s'ajoute à la fin de l'abonnement en cours
      await DB.batch([DB.prepare('INSERT INTO subscriptions(org_id,expires_at,updated_at) VALUES(?,?,?) ON CONFLICT(org_id) DO UPDATE SET expires_at=excluded.expires_at,updated_at=excluded.updated_at').bind(mm[1],exp,now),
        DB.prepare("INSERT INTO grants(id,org_id,admin_id,kind,months,amount,method,ref,note,starts_at,expires_at,created_at) VALUES(?,?,?,'grant',?,?,?,?,?,?,?,?)")
          .bind(rid(),mm[1],u.id,months,amount,['mtn','om','cash','bank','free'].includes(B.method)?B.method:(amount?'cash':'free'),String(B.ref||'').slice(0,60),String(B.note||'').slice(0,200),start,exp,now)]);
      await audit(env,u,'admin.grant',mm[1],{months,amount});return json({expires_at:exp});
    }
    return json({error:'not_found'},404);
  }

  if(m==='GET'&&r==='me'){
    const org=await DB.prepare('SELECT id,name,niu FROM orgs WHERE id=?').bind(u.org_id).first();
    const shops=(await DB.prepare(owner?'SELECT id,name,city,code FROM shops WHERE org_id=?':'SELECT id,name,city,code FROM shops WHERE id=?').bind(owner?u.org_id:u.shop_id).all()).results;
    const sb=await DB.prepare('SELECT expires_at FROM subscriptions WHERE org_id=?').bind(u.org_id).first();
    return json({user:u,org,shops,premium:{active:!!sb&&sb.expires_at>Date.now(),expires_at:sb?sb.expires_at:null}});
  }
  /* ---- Google Drive / Sheets (propriétaire) ---- */
  if(r.startsWith('google/')){
    if(!owner)return deny();
    if(m==='GET'&&r==='google/start'){if(!env.GOOGLE_CLIENT_ID)return json({error:'not_configured'},400);return json({url:await authUrl(env,u,url.origin)})}
    if(m==='GET'&&r==='google/status')return json(await gStatus(env,u.org_id));
    if(m==='POST'&&r==='google/sync'){await flush(env,u.org_id);return json(await gStatus(env,u.org_id))}
    if(m==='POST'&&r==='google/disconnect'){await disconnect(env,u.org_id);await audit(env,u,'google.disconnect');return json({ok:true})}
  }
  /* ---- Tableau de bord (propriétaire) : agrégats calculés en base ---- */
  if(m==='GET'&&r==='stats'){
    if(!owner)return deny();
    const q=url.searchParams,to=+q.get('to')||Date.now(),from=+q.get('from')||to-30*864e5,w=['r.org_id=?','r.created_at>=?','r.created_at<=?'],a=[u.org_id,from,to];
    if(q.get('shop')){w.push('r.shop_id=?');a.push(q.get('shop'))}if(q.get('user')){w.push('r.user_id=?');a.push(q.get('user'))}
    const W=w.join(' AND '),Q=async sql=>(await DB.prepare(sql).bind(...a).all()).results,LV="r.state!='void'",REV=`CASE WHEN ${LV} THEN r.total ELSE 0 END`,LOC='(r.created_at+3600000)/1000';   // heure du Cameroun = UTC+1
    const [k]=await Q(`SELECT COUNT(*) n,COALESCE(SUM(${REV}),0) rev,COALESCE(SUM(${LV}),0) cnt,COALESCE(SUM(r.state='void'),0) voids,COALESCE(SUM(r.state='flagged'),0) flagged FROM receipts r WHERE ${W}`);
    const flags=Object.fromEntries((await DB.prepare('SELECT f.user_id,COUNT(*) n FROM flags f JOIN receipts r ON r.id=f.receipt_id WHERE r.org_id=? AND f.created_at>=? AND f.created_at<=? GROUP BY f.user_id').bind(u.org_id,from,to).all()).results.map(x=>[x.user_id,x.n]));
    const agg={};for(const x of await Q(`SELECT r.items FROM receipts r WHERE ${W} AND ${LV} ORDER BY r.created_at DESC LIMIT 5000`))for(const i of JSON.parse(x.items)){const n=(i.n||'(sans nom)').trim().toLowerCase(),e=agg[n]||(agg[n]={name:(i.n||'(sans nom)').trim(),qty:0,rev:0});e.qty+=i.q;e.rev+=i.q*i.p}
    return json({period:{from,to},kpi:k,
      byShop:await Q(`SELECT s.name name,SUM(${REV}) rev,SUM(${LV}) cnt FROM receipts r JOIN shops s ON s.id=r.shop_id WHERE ${W} GROUP BY r.shop_id ORDER BY rev DESC`),
      byEmployee:(await Q(`SELECT u.id,u.name,u.role,SUM(${REV}) rev,SUM(${LV}) cnt,SUM(r.state='void') voids,SUM(r.state='flagged') flagged FROM receipts r JOIN users u ON u.id=r.user_id WHERE ${W} GROUP BY r.user_id ORDER BY rev DESC`)).map(x=>({...x,flags:flags[x.id]||0})),
      byMethod:await Q(`SELECT r.method method,SUM(${REV}) rev,SUM(${LV}) cnt FROM receipts r WHERE ${W} GROUP BY r.method ORDER BY rev DESC`),
      byState:await Q(`SELECT r.state state,COUNT(*) n FROM receipts r WHERE ${W} GROUP BY r.state`),
      byDay:await Q(`SELECT strftime('%Y-%m-%d',${LOC},'unixepoch') day,SUM(${REV}) rev,SUM(${LV}) cnt FROM receipts r WHERE ${W} GROUP BY day ORDER BY day`),
      byHour:await Q(`SELECT CAST(strftime('%H',${LOC},'unixepoch') AS INTEGER) hour,SUM(${LV}) cnt,SUM(${REV}) rev FROM receipts r WHERE ${W} GROUP BY hour ORDER BY hour`),
      amounts:await Q(`SELECT CASE WHEN r.total<1000 THEN 0 WHEN r.total<2000 THEN 1 WHEN r.total<5000 THEN 2 WHEN r.total<10000 THEN 3 WHEN r.total<20000 THEN 4 WHEN r.total<50000 THEN 5 ELSE 6 END bin,COUNT(*) n FROM receipts r WHERE ${W} AND ${LV} GROUP BY bin ORDER BY bin`),
      topItems:Object.values(agg).sort((x,y)=>y.rev-x.rev).slice(0,8)});
  }
  /* ---- Boutiques et employés (propriétaire) ---- */
  if(m==='POST'&&r==='shops'){
    if(!owner)return deny();if(!B.name)return json({error:'bad_request'},400);
    const id=rid();await DB.prepare('INSERT INTO shops(id,org_id,name,city,tel,code) VALUES(?,?,?,?,?,?)').bind(id,u.org_id,B.name,B.city||null,B.tel||null,await uniqueCode(DB,u.org_id,B.name)).run();
    await audit(env,u,'shop.create',id,{name:B.name});return json({id});
  }
  if(m==='GET'&&r==='employees'){
    if(!owner)return deny();
    return json((await DB.prepare("SELECT id,name,phone,shop_id,active FROM users WHERE org_id=? AND role='employee' ORDER BY created_at").bind(u.org_id).all()).results);
  }
  if(m==='POST'&&r==='employees'){
    if(!owner)return deny();
    const ph=normPhone(B.phone);
    if(!B.name||!ph||!/^\d{6}$/.test(String(B.pin||'')))return json({error:'bad_request'},400);
    if(!await DB.prepare('SELECT 1 FROM shops WHERE id=? AND org_id=?').bind(B.shop_id,u.org_id).first())return json({error:'shop'},400);
    if(await DB.prepare('SELECT 1 FROM users WHERE phone=?').bind(ph).first())return json({error:'phone_taken'},409);
    const id=rid(),salt=rid();
    await DB.prepare('INSERT INTO users(id,org_id,shop_id,role,name,phone,pw,salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,u.org_id,B.shop_id,'employee',B.name,ph,await hash(String(B.pin),salt),salt,Date.now()).run();
    await audit(env,u,'employee.create',id,{name:B.name});return json({id});
  }
  if(m==='POST'&&(mm=r.match(/^employees\/([\w-]+)\/(active|reset)$/))){
    if(!owner)return deny();
    const t=await DB.prepare("SELECT id FROM users WHERE id=? AND org_id=? AND role='employee'").bind(mm[1],u.org_id).first();if(!t)return json({error:'not_found'},404);
    if(mm[2]==='active')await DB.prepare('UPDATE users SET active=? WHERE id=?').bind(B.active?1:0,t.id).run();
    else{if(!/^\d{6}$/.test(String(B.pin||'')))return json({error:'bad_request'},400);const salt=rid();
      await DB.prepare('UPDATE users SET pw=?,salt=?,fails=0,locked_until=0 WHERE id=?').bind(await hash(String(B.pin),salt),salt,t.id).run()}
    await audit(env,u,'employee.'+mm[2],t.id,mm[2]==='active'?{active:!!B.active}:null);return json({ok:true});
  }

  /* ---- Reçus : création et lecture seulement ---- */
  if(m==='POST'&&r==='receipts'){
    if(B.ref){const ex=await DB.prepare('SELECT id,number,total FROM receipts WHERE user_id=? AND client_ref=?').bind(u.id,String(B.ref)).first();if(ex)return json({...ex,existing:true})}
    const shop=await DB.prepare('SELECT id,code FROM shops WHERE id=? AND org_id=?').bind(owner?(B.shop_id||u.shop_id):u.shop_id,u.org_id).first();
    if(!shop)return json({error:'shop'},400);
    const items=(Array.isArray(B.items)?B.items.slice(0,50):[]).map(i=>({n:String(i.n||'').slice(0,100),q:+i.q,p:+i.p}));
    if(!items.length||items.some(i=>!Number.isInteger(i.q)||i.q<1||i.q>1e4||!Number.isInteger(i.p)||i.p<0||i.p>1e8))return json({error:'items'},400);
    const total=items.reduce((s,i)=>s+i.q*i.p,0),seq=(await DB.prepare('UPDATE shops SET seq=seq+1 WHERE id=? RETURNING seq').bind(shop.id).first()).seq;
    const id=rid(),number=shop.code+'-'+pad(seq);
    await DB.prepare('INSERT INTO receipts(id,org_id,shop_id,user_id,number,client_ref,created_at,client,method,txid,pay_status,total,items) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id,u.org_id,shop.id,u.id,number,B.ref?String(B.ref):null,Date.now(),String(B.client||'').slice(0,100),METHODS.includes(B.method)?B.method:'cash',String(B.txid||'').slice(0,40),['ok','pend','chk'].includes(B.pay_status)?B.pay_status:'ok',total,JSON.stringify(items)).run();
    await audit(env,u,'receipt.create',id,{number,total});await enqueue(DB,u.org_id,'receipt',id);waitUntil(flush(env,u.org_id));return json({id,number,total});
  }
  if(m==='GET'&&r==='receipts'){
    const w=['r.org_id=?'],a=[u.org_id],q=url.searchParams;
    if(!owner){w.push('r.user_id=?');a.push(u.id)}else{if(q.get('shop')){w.push('r.shop_id=?');a.push(q.get('shop'))}if(q.get('user')){w.push('r.user_id=?');a.push(q.get('user'))}}
    if(+q.get('from')){w.push('r.created_at>=?');a.push(+q.get('from'))}if(+q.get('to')){w.push('r.created_at<=?');a.push(+q.get('to'))}
    a.push(Math.min(+q.get('limit')||100,500));
    const rows=(await DB.prepare(`SELECT r.id,r.number,r.created_at,r.client,r.method,r.txid,r.pay_status,r.total,r.items,r.state,us.name seller,s.name shop FROM receipts r JOIN users us ON us.id=r.user_id JOIN shops s ON s.id=r.shop_id WHERE ${w.join(' AND ')} ORDER BY r.created_at DESC LIMIT ?`).bind(...a).all()).results;
    return json(rows.map(x=>({...x,items:JSON.parse(x.items)})));
  }
  if(m==='POST'&&(mm=r.match(/^receipts\/([\w-]+)\/(flag|void|image)$/))){
    const rc=await DB.prepare('SELECT id,user_id,state FROM receipts WHERE id=? AND org_id=?').bind(mm[1],u.org_id).first();
    if(!rc||(!owner&&rc.user_id!==u.id))return json({error:'not_found'},404);
    if(mm[2]==='image'){                                                         // image du reçu (écriture unique) : copiée ensuite dans le Drive du propriétaire
      const png=String(B.png||'');if(!/^iVBOR/.test(png)||png.length>700000)return json({error:'bad_request'},400);
      await DB.prepare('INSERT OR IGNORE INTO receipt_files(receipt_id,png,created_at) VALUES(?,?,?)').bind(rc.id,png,Date.now()).run();
      await enqueue(DB,u.org_id,'image',rc.id);waitUntil(flush(env,u.org_id));return json({ok:true});
    }
    if(mm[2]==='void'){                                                          // annulation directe : propriétaire seulement
      if(!owner)return deny();await DB.prepare("UPDATE receipts SET state='void' WHERE id=?").bind(rc.id).run();
      await audit(env,u,'receipt.void',rc.id,{reason:String(B.reason||'').slice(0,200)});await enqueue(DB,u.org_id,'state',rc.id);waitUntil(flush(env,u.org_id));return json({ok:true});
    }
    if(rc.state!=='valid')return json({error:'not_valid'},409);
    if(!REASONS.includes(B.reason))return json({error:'bad_request'},400);
    const fid=rid();
    await DB.batch([DB.prepare('INSERT INTO flags(id,receipt_id,user_id,reason,comment,created_at) VALUES(?,?,?,?,?,?)').bind(fid,rc.id,u.id,B.reason,String(B.comment||'').slice(0,300),Date.now()),
      DB.prepare("UPDATE receipts SET state='flagged' WHERE id=?").bind(rc.id)]);
    await audit(env,u,'receipt.flag',rc.id,{reason:B.reason});await enqueue(DB,u.org_id,'state',rc.id);waitUntil(flush(env,u.org_id));return json({id:fid});
  }
  /* ---- Signalements : décision du propriétaire ---- */
  if(m==='GET'&&r==='flags'){
    if(!owner)return deny();
    return json((await DB.prepare('SELECT f.id,f.reason,f.comment,f.created_at,r.number,r.total,r.client,us.name seller FROM flags f JOIN receipts r ON r.id=f.receipt_id JOIN users us ON us.id=f.user_id WHERE r.org_id=? AND f.decision IS NULL ORDER BY f.created_at').bind(u.org_id).all()).results);
  }
  if(m==='POST'&&(mm=r.match(/^flags\/([\w-]+)\/decide$/))){
    if(!owner)return deny();if(!['void','reject'].includes(B.decision))return json({error:'bad_request'},400);
    const f=await DB.prepare('SELECT f.id,f.receipt_id FROM flags f JOIN receipts r ON r.id=f.receipt_id WHERE f.id=? AND r.org_id=? AND f.decision IS NULL').bind(mm[1],u.org_id).first();
    if(!f)return json({error:'not_found'},404);
    await DB.batch([DB.prepare('UPDATE flags SET decision=?,decided_by=?,decided_at=? WHERE id=?').bind(B.decision,u.id,Date.now(),f.id),
      DB.prepare('UPDATE receipts SET state=? WHERE id=?').bind(B.decision==='void'?'void':'valid',f.receipt_id)]);
    await audit(env,u,'flag.'+B.decision,f.receipt_id);await enqueue(DB,u.org_id,'state',f.receipt_id);waitUntil(flush(env,u.org_id));return json({ok:true});
  }
  return json({error:'not_found'},404);
}
