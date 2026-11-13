-- À appliquer après 001 et 002 ; sur le projet Amana existant appliquer seulement 003.
begin;
alter table public.profiles add column if not exists phone text not null default '';
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid; cname text:=nullif(trim(coalesce(new.raw_user_meta_data->>'company_name','')),'');
begin
 if cname is null then return new; end if;
 insert into public.companies(name,city,tel) values(cname,left(coalesce(new.raw_user_meta_data->>'company_city',''),200),left(coalesce(new.phone,new.raw_user_meta_data->>'company_tel',''),40)) returning id into cid;
 insert into public.profiles(id,company_id,full_name,email,phone,role,status)
 values(new.id,cid,left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),nullif(new.email,''),new.phone,'Gérant'),200),coalesce(new.email,''),coalesce(new.phone,''),'admin','active');
 return new;
end $$;
-- Synchronisation lors d'un changement de coordonnées confirmé par Auth.
create or replace function public.sync_auth_contact()
returns trigger language plpgsql security definer set search_path=public as $$
begin update public.profiles set email=coalesce(new.email,''),phone=coalesce(new.phone,'') where id=new.id; return new; end $$;
drop trigger if exists amana_sync_auth_contact on auth.users;
create trigger amana_sync_auth_contact after update of email,phone on auth.users for each row execute function public.sync_auth_contact();
-- Employés : pas d'accès direct en lecture aux archives ; émission via RPC.
drop policy if exists receipts_read on public.receipts;
create policy receipts_read on public.receipts for select to authenticated using(company_id=public.my_company_id() and public.is_admin());
commit;
