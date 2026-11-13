import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,phone text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,encrypted_password text);
create table auth.refresh_tokens(user_id text);create table auth.sessions(user_id uuid);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
`);
for(const file of ['001_schema.sql','002_security.sql','003_phone_accounts.sql','004_reliability_audit_receipts.sql','005_employee_invitations.sql']){let sql=await readFile('sql/'+file,'utf8');sql=sql.replace('create extension if not exists "pgcrypto";','');await db.exec(sql);console.log('Migration OK:',file)}
const ids={a:'11111111-1111-4111-8111-111111111111',b:'22222222-2222-4222-8222-222222222222',e:'33333333-3333-4333-8333-333333333333'};
for(const [name,id] of Object.entries(ids).slice(0,2))await db.query(`insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at,encrypted_password) values($1,$2,$3,now(),'hash')`,[id,name+'@example.com',JSON.stringify({company_name:'Company '+name,full_name:name})]);
async function root(){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)")}
async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')}
await root();const cid=(await db.query('select company_id from public.profiles where id=$1',[ids.a])).rows[0].company_id;
await db.query('insert into auth.users(id,email) values($1,$2)',[ids.e,'e@example.com']);await db.query("insert into public.profiles(id,company_id,email,full_name) values($1,$2,'e@example.com','Employee')",[ids.e,cid]);
const payload={request_key:'44444444-4444-4444-8444-444444444444',client:'Client privé',method:'MTN MoMo',status:'ok',txid:' TX-100 ',items:[{n:'Article privé',q:2,p:1500}],total:1};
async function issue(p){return (await db.query('select (public.issue_receipt($1::jsonb)).*',[JSON.stringify(p)])).rows[0]}
await as(ids.e);const r=await issue(payload);assert.equal(Number(r.total),3000);assert.equal((await issue(payload)).id,r.id);console.log('Server total + idempotence OK');
await assert.rejects(()=>issue({...payload,request_key:crypto.randomUUID(),txid:'INVALID-NULL',items:null}),/ITEMS_REQUIRED/);
await assert.rejects(()=>issue({...payload,request_key:crypto.randomUUID(),txid:'INVALID-Q',items:[{n:'Bad',q:-1,p:50}]}),/INVALID_ITEM/);
await assert.rejects(()=>issue({...payload,request_key:crypto.randomUUID(),txid:'INVALID-STATUS',status:null}),/INVALID_PAYMENT/);
console.log('Null/negative/payment validation OK');
assert.equal((await db.query('select * from public.receipts')).rows.length,0);console.log('Employee archives blocked OK');
await assert.rejects(()=>issue({...payload,request_key:crypto.randomUUID()}),/DUPLICATE_TXID/);
await assert.rejects(()=>db.query("update public.receipts set total=1 where id=$1",[r.id]),/permission denied/);
await assert.rejects(()=>db.query('delete from public.receipts where id=$1',[r.id]),/permission denied/);
await assert.rejects(()=>db.query("update public.profiles set role='admin' where id=$1",[ids.e]),/autorisee/);
await assert.rejects(()=>db.query("select public.void_receipt($1,'Wrong amount')",[r.id]),/ADMIN_REQUIRED/);console.log('Duplicate, edit, delete and privilege guards OK');
await as(ids.b);assert.equal((await db.query('select * from public.receipts')).rows.length,0);await assert.rejects(()=>db.query("select public.void_receipt($1,'Wrong amount')",[r.id]),/NOT_FOUND/);console.log('Cross-company isolation OK');
await as(ids.a);const newr=await issue({...payload,request_key:crypto.randomUUID(),replaces_id:r.id,replacement_reason:'Montant corrigé',items:[{n:'Article corrigé',q:1,p:2000}]});assert.equal(newr.replaces_id,r.id);assert.ok((await db.query('select voided_at from receipts where id=$1',[r.id])).rows[0].voided_at);await assert.rejects(()=>issue({...payload,request_key:crypto.randomUUID(),replaces_id:r.id,replacement_reason:'Repeat replacement'}),/ALREADY_REPLACED/);console.log('Atomic void + replacement OK');
const r3=await issue({...payload,request_key:crypto.randomUUID(),txid:'NEW-TX'});
await assert.rejects(()=>issue({...payload,request_key:crypto.randomUUID(),replaces_id:r3.id,replacement_reason:'Must rollback'}),/DUPLICATE_TXID/);
assert.equal((await db.query('select voided_at from receipts where id=$1',[r3.id])).rows[0].voided_at,null);console.log('Failed replacement rolls back void OK');
const v=(await db.query('select public.verify_receipt($1) as v',[r.verify_token])).rows[0].v;assert.equal(v.voided,true);assert.equal(v.replacement_number,newr.number);assert.equal(v.client,undefined);assert.equal(v.items,undefined);assert.equal(v.txid,undefined);console.log('Public verification privacy OK');
await db.query("insert into public.reports(company_id,receipt_id,author_id,message) values($1,$2,$3,'Correction')",[cid,newr.id,ids.a]);assert.ok((await db.query('select * from audit_events')).rows.length>=3);await assert.rejects(()=>db.exec('delete from audit_events'),/permission denied/);console.log('Audit read-only OK');
const inv=(await db.query("select * from public.reserve_employee_invitation('invite@example.com','Employé invité')")).rows[0];await root();const invitee=crypto.randomUUID();await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'invite@example.com',$2)",[invitee,JSON.stringify({amana_invitation_id:inv.id})]);assert.equal((await db.query('select role from profiles where id=$1',[invitee])).rows[0].role,'employee');console.log('Invitation provisioning OK');
await db.query('insert into auth.sessions(user_id) values($1)',[ids.e]);await db.query('insert into auth.refresh_tokens(user_id) values($1)',[ids.e]);
await as(ids.a);await db.query("update profiles set status='revoked' where id=$1",[ids.e]);await root();assert.equal((await db.query('select * from auth.sessions where user_id=$1',[ids.e])).rows.length,0);assert.equal((await db.query('select * from auth.refresh_tokens where user_id=$1',[ids.e])).rows.length,0);await as(ids.e);await assert.rejects(()=>issue({...payload,request_key:crypto.randomUUID(),txid:'DIFFERENT'}),/ACCOUNT_REVOKED/);console.log('Revocation writes blocked OK');
await root();await db.exec('set role anon');const publicView=(await db.query('select public.verify_receipt($1) as v',[newr.verify_token])).rows[0].v;assert.ok(publicView);assert.equal((await db.query('select public.verify_receipt($1) as v',['bad'])).rows[0].v,null);console.log('Anonymous verification OK');
await db.close();
