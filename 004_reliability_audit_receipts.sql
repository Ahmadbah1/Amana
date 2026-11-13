-- Amana v3 : après 001, 002 et 003. Transaction atomique, aucune suppression d'historique.
begin;
create table public.audit_events (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id), actor_id uuid,
 action text not null, entity_id text, details jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.audit_events enable row level security;
create policy audit_admin_read on public.audit_events for select to authenticated using(company_id=public.my_company_id() and public.is_admin());
grant select on public.audit_events to authenticated;
create or replace function public.amana_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid; details jsonb:='{}';
begin
 cid:=case when tg_table_name='companies' then new.id else new.company_id end;
 if tg_table_name='profiles' then details:=jsonb_build_object('role',new.role,'status',new.status);
 elsif tg_table_name='reports' then details:=jsonb_build_object('status',new.status);
 elsif tg_table_name='receipts' then details:=jsonb_build_object('number',new.number,'voided',new.voided_at is not null,'replaces',new.replaces_id);
 end if;
 insert into public.audit_events(company_id,actor_id,action,entity_id,details) values(cid,auth.uid(),tg_table_name||'.'||lower(tg_op),new.id::text,details);
 return new;
end $$;
alter table public.receipts add column request_key uuid;
alter table public.receipts add column request_payload jsonb;
alter table public.receipts add column verify_token text not null default left(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),48);
alter table public.receipts add column company_snapshot jsonb;
alter table public.receipts add column voided_at timestamptz;
alter table public.receipts add column voided_by uuid references public.profiles(id);
alter table public.receipts add column void_reason text;
alter table public.receipts add column replaces_id uuid references public.receipts(id);
create unique index receipt_request_unique on public.receipts(author_id,request_key) where request_key is not null;
create unique index receipt_verify_unique on public.receipts(verify_token);
create unique index receipt_replacement_unique on public.receipts(replaces_id) where replaces_id is not null;
update public.receipts r set company_snapshot=jsonb_build_object('name',c.name,'city',c.city,'tel',c.tel,'niu',c.niu,'footer_msg',c.footer_msg,'logo_url',c.logo_url) from public.companies c where c.id=r.company_id;
-- Réserver les références déjà utilisées sans modifier les doublons historiques.
create table public.transaction_claims(company_id uuid references public.companies(id),txkey text not null,receipt_id uuid not null references public.receipts(id),primary key(company_id,txkey));
alter table public.transaction_claims enable row level security;
insert into public.transaction_claims select distinct on(company_id,lower(regexp_replace(txid,'\s','','g'))) company_id,lower(regexp_replace(txid,'\s','','g')),id from public.receipts where trim(coalesce(txid,''))<>'' order by company_id,lower(regexp_replace(txid,'\s','','g')),created_at;
-- Validation stricte : aucune valeur JSON nulle, négative ou non numérique.
create or replace function public.validate_receipt() returns trigger language plpgsql set search_path=public as $$
declare it jsonb;amount numeric:=0;q numeric;price numeric;
begin
 if new.method is null or new.method not in ('MTN MoMo','Orange Money','Espèces','Virement','Carte') or new.status is null or new.status not in ('ok','chk') then raise exception 'INVALID_PAYMENT';end if;
 if new.items is null or jsonb_typeof(new.items)<>'array' then raise exception 'ITEMS_REQUIRED';end if;
 if jsonb_array_length(new.items)<1 or jsonb_array_length(new.items)>100 then raise exception 'ITEMS_REQUIRED';end if;
 for it in select * from jsonb_array_elements(new.items) loop
  if jsonb_typeof(it)<>'object' or coalesce(trim(it->>'n'),'')='' or length(it->>'n')>200 or coalesce(jsonb_typeof(it->'q'),'')<>'number' or coalesce(jsonb_typeof(it->'p'),'')<>'number' then raise exception 'INVALID_ITEM';end if;
  q:=(it->>'q')::numeric;price:=(it->>'p')::numeric;
  if q<=0 or q>1000000 or price<0 or price>10000000000 then raise exception 'INVALID_ITEM';end if;
  amount:=amount+q*price;
 end loop;
 if amount>999999999999.99 then raise exception 'TOTAL_TOO_LARGE';end if;
 new.total:=amount;return new;
end $$;
-- Les écritures de reçus ne passent plus par des UPDATE / INSERT REST arbitraires.
revoke insert,update,delete on public.receipts from authenticated;
drop policy if exists receipts_insert on public.receipts;
drop policy if exists receipts_admin_write on public.receipts;
drop policy if exists receipts_admin_delete on public.receipts;
create or replace function public.issue_receipt(payload jsonb) returns public.receipts language plpgsql security definer set search_path=public as $$
declare p public.profiles; r public.receipts; oldr public.receipts; k uuid; tx text; rid uuid; claim uuid; replacement_reason text;
begin
 select * into p from public.profiles where id=auth.uid() and status='active'; if not found then raise exception 'ACCOUNT_REVOKED'; end if;
 -- Verrou par entreprise : idempotence + réservation de TxID atomiques.
 perform 1 from public.companies where id=p.company_id for update;
 k:=(payload->>'request_key')::uuid; if k is null then raise exception 'REQUEST_KEY_REQUIRED'; end if;
 select * into r from public.receipts where author_id=p.id and request_key=k;
 if found then if r.request_payload is distinct from payload then raise exception 'REQUEST_CHANGED'; end if; return r; end if;
 if (select count(*) from public.receipts where author_id=p.id and created_at>now()-interval '1 minute')>=20 then raise exception 'RATE_LIMIT_RECEIPTS'; end if;
 if length(coalesce(payload->>'txid',''))>200 then raise exception 'TXID_TOO_LONG';end if;
 if coalesce(trim(payload->>'client'),'')='' then raise exception 'CLIENT_REQUIRED'; end if;
 if coalesce(jsonb_typeof(payload->'items'),'')<>'array' then raise exception 'ITEMS_REQUIRED';end if;
 if length(payload::text)>100000 or jsonb_array_length(payload->'items')>100 then raise exception 'RECEIPT_TOO_LARGE'; end if;
 rid:=nullif(payload->>'replaces_id','')::uuid;
 if rid is not null then
  if p.role<>'admin' then raise exception 'ADMIN_REQUIRED'; end if;
  select * into oldr from public.receipts where id=rid and company_id=p.company_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if exists(select 1 from public.receipts where replaces_id=rid) then raise exception 'ALREADY_REPLACED'; end if;
  replacement_reason:=trim(payload->>'replacement_reason');
  if coalesce(length(replacement_reason),0)<5 then raise exception 'REASON_REQUIRED'; end if;
  if oldr.voided_at is null then update public.receipts set voided_at=now(),voided_by=p.id,void_reason=replacement_reason where id=rid; end if;
 end if;
 tx:=lower(regexp_replace(coalesce(payload->>'txid',''),'\s','','g'));
 if tx<>'' then
  select receipt_id into claim from public.transaction_claims where company_id=p.company_id and txkey=tx;
  if found and (rid is null or claim<>rid) then raise exception 'DUPLICATE_TXID'; end if;
 end if;
 insert into public.receipts(company_id,author_id,client,method,status,txid,items,request_key,request_payload,replaces_id,company_snapshot)
 select p.company_id,p.id,left(payload->>'client',200),payload->>'method',payload->>'status',left(payload->>'txid',200),payload->'items',k,payload,rid,jsonb_build_object('name',c.name,'city',c.city,'tel',c.tel,'niu',c.niu,'footer_msg',c.footer_msg,'logo_url',c.logo_url) from public.companies c where c.id=p.company_id returning * into r;
 if tx<>'' then insert into public.transaction_claims values(p.company_id,tx,r.id) on conflict(company_id,txkey) do update set receipt_id=excluded.receipt_id; end if;
 return r;
end $$;
revoke all on function public.issue_receipt(jsonb) from public; grant execute on function public.issue_receipt(jsonb) to authenticated;
create function public.void_receipt(receipt uuid,reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if coalesce(length(trim(reason)),0)<5 then raise exception 'REASON_REQUIRED'; end if;
 update public.receipts set voided_at=now(),voided_by=auth.uid(),void_reason=left(trim(reason),2000) where id=receipt and company_id=public.my_company_id() and voided_at is null;
 if not found then raise exception 'RECEIPT_NOT_FOUND_OR_VOID'; end if;
end $$;
revoke all on function public.void_receipt(uuid,text) from public; grant execute on function public.void_receipt(uuid,text) to authenticated;
create function public.verify_receipt(token text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.receipts; replacement text;
begin
 if token is null or token !~ '^[0-9a-f]{48}$' then return null; end if;
 select * into r from public.receipts where verify_token=token; if not found then return null; end if;
 select number into replacement from public.receipts where replaces_id=r.id;
 -- Aucun client, article, téléphone, employé, TxID ni motif privé exposé.
 return jsonb_build_object('company',r.company_snapshot->>'name','number',r.number,'issued_at',r.issued_at,'total',r.total,'currency','FCFA','voided',r.voided_at is not null,'replacement_number',replacement,'replaces',r.replaces_id is not null);
end $$;
revoke all on function public.verify_receipt(text) from public; grant execute on function public.verify_receipt(text) to anon,authenticated;
create function public.amana_health() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.amana_health() to anon,authenticated;
create trigger amana_audit_receipts after insert or update on public.receipts for each row execute function public.amana_audit();
create trigger amana_audit_profiles after insert or update on public.profiles for each row execute function public.amana_audit();
create trigger amana_audit_reports after insert or update on public.reports for each row execute function public.amana_audit();
create trigger amana_audit_companies after update on public.companies for each row execute function public.amana_audit();
-- Détruire les sessions serveur lors d'une révocation ; les JWT déjà émis restent
-- cryptographiquement valides jusqu'à expiration, mais la RLS les bloque immédiatement.
create function public.amana_revoke_sessions() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status='revoked' and old.status<>'revoked' then
  delete from auth.refresh_tokens where user_id=new.id::text;
  delete from auth.sessions where user_id=new.id;
 end if; return new;
end $$;
create trigger amana_revoke_sessions after update of status on public.profiles for each row execute function public.amana_revoke_sessions();
-- Les signalements ne peuvent pas être finalisés à l'insertion par l'employé.
create function public.amana_report_defaults() returns trigger language plpgsql set search_path=public as $$
begin new.status:='open';new.resolved_at:=null;new.resolved_by:=null;new.resolution:='';return new;end $$;
create trigger amana_report_defaults before insert on public.reports for each row execute function public.amana_report_defaults();

-- Lecture ponctuelle du reçu courant pour PDF : employé = uniquement son reçu.
-- L'UI n'offre pas d'archives employés ; ce contrôle ne peut pas effacer les copies déjà remises.
create function public.receipt_for_delivery(receipt uuid) returns public.receipts language plpgsql stable security definer set search_path=public as $$
declare r public.receipts;
begin
 select * into r from public.receipts where id=receipt and company_id=public.my_company_id() and (public.is_admin() or author_id=auth.uid());
 if not found then raise exception 'RECEIPT_NOT_FOUND';end if;return r;
end $$;
revoke all on function public.receipt_for_delivery(uuid) from public;grant execute on function public.receipt_for_delivery(uuid) to authenticated;

commit;
