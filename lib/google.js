import {sign,verify} from './license.js';
const enc=new TextEncoder(),dec=new TextDecoder();
const B64=u=>btoa(String.fromCharCode(...new Uint8Array(u))),UB64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const aes=async env=>crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(env.TOKEN_KEY)),'AES-GCM',false,['encrypt','decrypt']);
export async function seal(env,t){const iv=crypto.getRandomValues(new Uint8Array(12));return B64(iv)+'.'+B64(await crypto.subtle.encrypt({name:'AES-GCM',iv},await aes(env),enc.encode(t)))}
export async function unseal(env,s){const [a,b]=s.split('.');return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:UB64(a)},await aes(env),UB64(b)))}

const H1=['N°','Date','Boutique','Vendeur','Client','Mode','TxID','Paiement','Total (FCFA)','État','ID'],H2=['N° reçu','Article','Quantité','Prix unitaire (FCFA)','Total ligne (FCFA)'];
const ML={mtn:'MTN MoMo',om:'Orange Money',cash:'Espèces',bank:'Virement',card:'Carte'},PL={ok:'Confirmé',pend:'En attente',chk:'À vérifier'},SL={valid:'Valide',flagged:'Signalé',void:'Annulé'};
const when=ms=>new Date(ms+36e5).toISOString().slice(0,16).replace('T',' ');            // heure du Cameroun (UTC+1)

async function G(at,url,o={}){
  const r=await fetch(url,{method:o.method||'GET',headers:{authorization:'Bearer '+at,...(o.json?{'content-type':'application/json'}:{}),...(o.headers||{})},body:o.json?JSON.stringify(o.json):o.body});
  const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error((d.error&&d.error.message)||('google '+r.status));e.status=r.status;throw e}return d}
async function tokenReq(env,p){
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...p})});
  const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||'token');e.grant=d.error==='invalid_grant';throw e}return d}
async function access(env,g){
  if(g.at_enc&&g.at_exp>Date.now()+6e4)return unseal(env,g.at_enc);
  const d=await tokenReq(env,{grant_type:'refresh_token',refresh_token:await unseal(env,g.refresh_enc)});
  await env.DB.prepare('UPDATE google SET at_enc=?,at_exp=? WHERE org_id=?').bind(await seal(env,d.access_token),Date.now()+(d.expires_in||3600)*1000,g.org_id).run();return d.access_token}

/* ---- Connexion Google (portée limitée aux fichiers créés par Amana) ---- */
export async function authUrl(env,u,origin){
  const state=await sign({u:u.id,o:u.org_id,exp:Date.now()+6e5},env.SIGN_SECRET);
  return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/api/v1/google/callback',response_type:'code',scope:'https://www.googleapis.com/auth/drive.file openid email',access_type:'offline',prompt:'consent',state})}

const MODES=['MTN MoMo','Orange Money','Espèces','Virement','Carte'];
function synthese(){                                                              // onglet calculé par des formules : se met à jour tout seul
  const T=(v,b)=>({userEnteredValue:{stringValue:v},userEnteredFormat:b?{textFormat:{bold:true}}:{}}),F=(f,fmt)=>({userEnteredValue:{formulaValue:f},userEnteredFormat:fmt?{numberFormat:fmt}:{}}),E={},row=(...c)=>({values:c.map(x=>x||E)});
  const SUMX='SUMIFS(Reçus!I:I,Reçus!J:J,"<>Annulé")',N='COUNTIFS(Reçus!J:J,"Valide")+COUNTIFS(Reçus!J:J,"Signalé")',rows=[
    row(T('Synthèse Amana',1)),row(T('Ventes hors reçus annulés, calculées automatiquement depuis l’onglet « Reçus ».')),row(),
    row(T('Chiffre d’affaires (FCFA)',1),F('='+SUMX,{type:'NUMBER',pattern:'#,##0'})),row(T('Nombre de reçus',1),F('='+N)),
    row(T('Panier moyen (FCFA)',1),F('=IF(B5=0,0,ROUND(B4/B5,0))',{type:'NUMBER',pattern:'#,##0'})),row(T('Reçus annulés',1),F('=COUNTIFS(Reçus!J:J,"Annulé")')),
    row(T('Taux d’annulation',1),F('=IF(B5+B7=0,0,B7/(B5+B7))',{type:'PERCENT',pattern:'0.0%'})),row(),
    row(T('Mode de paiement',1),T('CA (FCFA)',1),0,F('=QUERY(Reçus!A:K,"select C, sum(I) where J <> \'Annulé\' group by C label C \'Boutique\', sum(I) \'CA (FCFA)\'",1)'),0,0,F('=QUERY(Reçus!A:K,"select D, sum(I), count(A) where J <> \'Annulé\' group by D label D \'Vendeur\', sum(I) \'CA (FCFA)\', count(A) \'Reçus\'",1)')),
    ...MODES.map((m,i)=>row(T(m),F(`=SUMIFS(Reçus!$I:$I,Reçus!$F:$F,A${11+i},Reçus!$J:$J,"<>Annulé")`)))];
  return{properties:{sheetId:3,title:'Synthèse'},data:[{startRow:0,startColumn:0,rowData:rows}]}}
const rng=(c0,c1,r1)=>({sources:[{sheetId:3,startRowIndex:10,endRowIndex:r1,startColumnIndex:c0,endColumnIndex:c1}]});
const CHARTS=[{addChart:{chart:{spec:{title:'CA par mode de paiement',pieChart:{legendPosition:'RIGHT_LEGEND',domain:{sourceRange:rng(0,1,15)},series:{sourceRange:rng(1,2,15)}}},position:{overlayPosition:{anchorCell:{sheetId:3,rowIndex:31,columnIndex:0},widthPixels:430,heightPixels:260}}}}},
  {addChart:{chart:{spec:{title:'CA par vendeur',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',axis:[{position:'BOTTOM_AXIS'},{position:'LEFT_AXIS'}],domains:[{domain:{sourceRange:rng(6,7,30)}}],series:[{series:{sourceRange:rng(7,8,30)},targetAxis:'LEFT_AXIS'}],headerCount:0}},position:{overlayPosition:{anchorCell:{sheetId:3,rowIndex:31,columnIndex:4},widthPixels:430,heightPixels:260}}}}}];

async function workspace(at,orgName){
  const folder=await G(at,'https://www.googleapis.com/drive/v3/files',{method:'POST',json:{name:`Amana – ${orgName}`,mimeType:'application/vnd.google-apps.folder'}});
  const hd=a=>({values:a.map(v=>({userEnteredValue:{stringValue:v},userEnteredFormat:{textFormat:{bold:true,foregroundColor:{red:1,green:1,blue:1}},backgroundColor:{red:.03,green:.15,blue:.32}}}))});
  const tab=(t,c)=>({properties:{title:t,gridProperties:{frozenRowCount:1}},data:[{startRow:0,startColumn:0,rowData:[hd(c)]}]});
  const sh=await G(at,'https://sheets.googleapis.com/v4/spreadsheets',{method:'POST',json:{properties:{title:'Amana – Reçus'},sheets:[tab('Reçus',H1),tab('Articles',H2),synthese()]}});
  await G(at,`https://www.googleapis.com/drive/v3/files/${sh.spreadsheetId}?addParents=${folder.id}&removeParents=root&fields=id`,{method:'PATCH',json:{}});
  try{await G(at,`https://sheets.googleapis.com/v4/spreadsheets/${sh.spreadsheetId}:batchUpdate`,{method:'POST',json:{requests:CHARTS}})}catch(e){}   // graphiques : facultatifs, n'empêchent pas la connexion
  return{folder:folder.id,sheet:sh.spreadsheetId}}

const reset=async(DB,o)=>{for(const q of ['DELETE FROM gmap WHERE receipt_id IN (SELECT id FROM receipts WHERE org_id=?)','DELETE FROM gfiles WHERE receipt_id IN (SELECT id FROM receipts WHERE org_id=?)','DELETE FROM gfolders WHERE org_id=?','DELETE FROM sync_queue WHERE org_id=?'])await DB.prepare(q).bind(o).run()};
export async function backfill(DB,o){
  await DB.prepare("INSERT INTO sync_queue(org_id,kind,ref) SELECT org_id,'receipt',id FROM receipts WHERE org_id=? AND id NOT IN (SELECT receipt_id FROM gmap) AND id NOT IN (SELECT ref FROM sync_queue WHERE kind='receipt' AND done=0)").bind(o).run();
  await DB.prepare("INSERT INTO sync_queue(org_id,kind,ref) SELECT r.org_id,'image',f.receipt_id FROM receipt_files f JOIN receipts r ON r.id=f.receipt_id WHERE r.org_id=? AND f.receipt_id NOT IN (SELECT receipt_id FROM gfiles) AND f.receipt_id NOT IN (SELECT ref FROM sync_queue WHERE kind='image' AND done=0)").bind(o).run();
  await DB.prepare("INSERT INTO sync_queue(org_id,kind,ref) SELECT org_id,'state',id FROM receipts WHERE org_id=? AND state!='valid'").bind(o).run()}

export async function callback(env,url,waitUntil){
  const to=ok=>new Response(null,{status:302,headers:{location:`${url.origin}/espace.html?google=${ok?'ok':'err'}`}});
  try{
    const st=await verify(url.searchParams.get('state'),env.SIGN_SECRET);if(!st||st.exp<Date.now()||!url.searchParams.get('code'))return to(false);
    const t=await tokenReq(env,{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:url.origin+'/api/v1/google/callback'});
    if(!t.refresh_token)return to(false);
    const email=(JSON.parse(atob((t.id_token||'..').split('.')[1].replace(/-/g,'+').replace(/_/g,'/')||'e30='))||{}).email||'';
    const DB=env.DB,ex=await DB.prepare('SELECT email,folder_id,sheet_id FROM google WHERE org_id=?').bind(st.o).first();
    let ws={folder:ex&&ex.folder_id,sheet:ex&&ex.sheet_id};
    if(!ex||ex.email!==email){const org=await DB.prepare('SELECT name FROM orgs WHERE id=?').bind(st.o).first();ws=await workspace(t.access_token,org.name);await reset(DB,st.o)}
    await DB.prepare("INSERT INTO google(org_id,refresh_enc,email,folder_id,sheet_id,status,connected_at,at_enc,at_exp) VALUES(?,?,?,?,?,'ok',?,?,?) ON CONFLICT(org_id) DO UPDATE SET refresh_enc=excluded.refresh_enc,email=excluded.email,folder_id=excluded.folder_id,sheet_id=excluded.sheet_id,status='ok',at_enc=excluded.at_enc,at_exp=excluded.at_exp")
      .bind(st.o,await seal(env,t.refresh_token),email,ws.folder,ws.sheet,Date.now(),await seal(env,t.access_token),Date.now()+(t.expires_in||3600)*1000).run();
    await backfill(DB,st.o);await DB.prepare('INSERT INTO audit(org_id,user_id,action,target,at) VALUES(?,?,?,?,?)').bind(st.o,st.u,'google.connect',email,Date.now()).run();
    waitUntil(flush(env,st.o));return to(true)
  }catch(e){return to(false)}}

export async function disconnect(env,o){
  const g=await env.DB.prepare('SELECT refresh_enc FROM google WHERE org_id=?').bind(o).first();
  if(g)try{await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:await unseal(env,g.refresh_enc)})})}catch(e){}
  await env.DB.prepare('DELETE FROM google WHERE org_id=?').bind(o).run();await reset(env.DB,o)}

export async function status(env,o){
  const DB=env.DB,g=await DB.prepare('SELECT email,folder_id,sheet_id,status FROM google WHERE org_id=?').bind(o).first();
  const n=await DB.prepare('SELECT COUNT(*) pending,SUM(attempts>=3) errors FROM sync_queue WHERE org_id=? AND done=0').bind(o).first();
  return{configured:!!env.GOOGLE_CLIENT_ID,connected:!!g,status:g&&g.status,email:g&&g.email,sheet_url:g&&`https://docs.google.com/spreadsheets/d/${g.sheet_id}`,folder_url:g&&`https://drive.google.com/drive/folders/${g.folder_id}`,pending:n.pending||0,errors:n.errors||0}}

export const enqueue=(DB,o,kind,ref)=>DB.prepare("INSERT INTO sync_queue(org_id,kind,ref) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM google WHERE org_id=? AND status='ok')").bind(o,kind,ref,o).run();

/* ---- Envoi vers Google : file d'attente, par lots, avec nouvelles tentatives ---- */
async function folder(DB,at,g,k,name,parent){
  const c=await DB.prepare('SELECT drive_id FROM gfolders WHERE org_id=? AND k=?').bind(g.org_id,k).first();if(c)return c.drive_id;
  const f=await G(at,'https://www.googleapis.com/drive/v3/files',{method:'POST',json:{name,mimeType:'application/vnd.google-apps.folder',parents:[parent]}});
  await DB.prepare('INSERT OR REPLACE INTO gfolders(org_id,k,drive_id) VALUES(?,?,?)').bind(g.org_id,k,f.id).run();return f.id}
async function upload(at,name,parent,b64){
  const bin=UB64(b64),bd='amana'+crypto.randomUUID().replace(/-/g,''),head=enc.encode(`--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name,parents:[parent]})}\r\n--${bd}\r\nContent-Type: image/png\r\n\r\n`),tail=enc.encode(`\r\n--${bd}--`);
  const body=new Uint8Array(head.length+bin.length+tail.length);body.set(head);body.set(bin,head.length);body.set(tail,head.length+bin.length);
  return G(at,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'content-type':`multipart/related; boundary=${bd}`},body})}

export async function flush(env,o){
  const DB=env.DB,g=await DB.prepare("SELECT * FROM google WHERE org_id=? AND status='ok'").bind(o).first();if(!g)return{sent:0};
  const now=Date.now(),jobs=(await DB.prepare('UPDATE sync_queue SET locked_until=? WHERE id IN (SELECT id FROM sync_queue WHERE org_id=? AND done=0 AND next_at<=? AND locked_until<? ORDER BY id LIMIT 40) RETURNING id,kind,ref,attempts').bind(now+12e4,o,now,now).all()).results;
  if(!jobs.length)return{sent:0};
  const ok=js=>Promise.all(js.map(j=>DB.prepare('UPDATE sync_queue SET done=1,locked_until=0,error=NULL WHERE id=?').bind(j.id).run()));
  const ko=(js,e)=>Promise.all(js.map(j=>DB.prepare('UPDATE sync_queue SET attempts=attempts+1,next_at=?,locked_until=0,error=? WHERE id=?').bind(Date.now()+Math.min(2**j.attempts*3e4,36e5),String(e.message||e).slice(0,200),j.id).run()));
  const later=js=>Promise.all(js.map(j=>DB.prepare('UPDATE sync_queue SET next_at=?,locked_until=0 WHERE id=?').bind(Date.now()+3e4,j.id).run()));
  let at;try{at=await access(env,g)}catch(e){if(e.grant)await DB.prepare("UPDATE google SET status='revoked' WHERE org_id=?").bind(o).run();await ko(jobs,e);return{sent:0,error:'auth'}}
  const by=k=>jobs.filter(j=>j.kind===k),S=`https://sheets.googleapis.com/v4/spreadsheets/${g.sheet_id}`;
  const rcs=async ids=>ids.length?(await DB.prepare(`SELECT r.id,r.number,r.created_at,r.client,r.method,r.txid,r.pay_status,r.total,r.items,r.state,r.shop_id,s.name shop,u.name seller FROM receipts r JOIN shops s ON s.id=r.shop_id JOIN users u ON u.id=r.user_id WHERE r.id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all()).results:[];
  let sent=0;

  const nj=by('receipt');if(nj.length)try{                                       // 1) nouveaux reçus : onglets « Reçus » et « Articles »
    const fresh=[],part=[];for(const r of await rcs(nj.map(j=>j.ref))){const m=await DB.prepare('SELECT art FROM gmap WHERE receipt_id=?').bind(r.id).first();if(!m)fresh.push(r);else if(!m.art)part.push(r)}
    if(fresh.length){
      const d=await G(at,`${S}/values/${encodeURIComponent('Reçus!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',json:{values:fresh.map(r=>[r.number,when(r.created_at),r.shop,r.seller,r.client,ML[r.method]||r.method,r.txid,PL[r.pay_status]||'',r.total,SL[r.state],r.id])}});
      const start=+/![A-Z]+(\d+)/.exec(d.updates.updatedRange)[1];
      for(const [i,r] of fresh.entries())await DB.prepare('INSERT INTO gmap(receipt_id,sheet_row) VALUES(?,?)').bind(r.id,start+i).run()}
    const all=[...fresh,...part];
    if(all.length){await G(at,`${S}/values/${encodeURIComponent('Articles!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',json:{values:all.flatMap(r=>JSON.parse(r.items).map(i=>[r.number,i.n,i.q,i.p,i.q*i.p]))}});
      for(const r of all)await DB.prepare('UPDATE gmap SET art=1 WHERE receipt_id=?').bind(r.id).run()}
    await ok(nj);sent+=nj.length}catch(e){await ko(nj,e)}

  const sj=by('state');if(sj.length)try{                                         // 2) changements d'état (signalé / annulé / valide)
    const rs=await rcs([...new Set(sj.map(j=>j.ref))]),data=[],wait=[],fin=[];
    for(const j of sj){const r=rs.find(x=>x.id===j.ref),m=r&&await DB.prepare('SELECT sheet_row FROM gmap WHERE receipt_id=?').bind(r.id).first();
      if(!r)fin.push(j);else if(!m)wait.push(j);else{data.push({range:`Reçus!J${m.sheet_row}`,values:[[SL[r.state]]]});fin.push(j)}}
    if(data.length)await G(at,`${S}/values:batchUpdate`,{method:'POST',json:{valueInputOption:'RAW',data}});
    await ok(fin);await later(wait);sent+=fin.length}catch(e){await ko(sj,e)}

  for(const j of by('image'))try{                                                // 3) image du reçu dans le Drive : Boutique / AAAA-MM / N°.png
    if(await DB.prepare('SELECT 1 FROM gfiles WHERE receipt_id=?').bind(j.ref).first()){await ok([j]);continue}
    const [r]=await rcs([j.ref]),f=await DB.prepare('SELECT png FROM receipt_files WHERE receipt_id=?').bind(j.ref).first();if(!r||!f){await ok([j]);continue}
    const ym=when(r.created_at).slice(0,7),sf=await folder(DB,at,g,'s:'+r.shop_id,r.shop,g.folder_id),mf=await folder(DB,at,g,`s:${r.shop_id}:${ym}`,ym,sf);
    const up=await upload(at,`${r.number}.png`,mf,f.png);await DB.prepare('INSERT OR IGNORE INTO gfiles(receipt_id,file_id) VALUES(?,?)').bind(r.id,up.id).run();await ok([j]);sent++
  }catch(e){if(e.status===404)await DB.prepare('DELETE FROM gfolders WHERE org_id=?').bind(o).run();await ko([j],e)}
  return{sent}}
