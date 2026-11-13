begin;
create table public.employee_invitations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 invited_by uuid not null references public.profiles(id), email text not null, full_name text not null,
 status text not null default 'reserved' check(status in ('reserved','sent','failed','accepted')),
 created_at timestamptz not null default now(), auth_user_id uuid, error_code text
);
alter table public.employee_invitations enable row level security;
create policy invitations_admin_read on public.employee_invitations for select to authenticated using(company_id=public.my_company_id() and public.is_admin());
grant select on public.employee_invitations to authenticated;
create function public.reserve_employee_invitation(target_email text,target_name text) returns public.employee_invitations language plpgsql security definer set search_path=public as $$
declare inv public.employee_invitations; cid uuid:=public.my_company_id();
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 perform 1 from public.companies where id=cid for update;
 if length(trim(target_name))<2 or length(target_email)>254 or target_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'INVALID_INVITATION'; end if;
 if (select count(*) from public.employee_invitations where company_id=cid and created_at>now()-interval '1 hour')>=10 then raise exception 'INVITE_RATE_LIMIT'; end if;
 if exists(select 1 from public.employee_invitations where company_id=cid and email=lower(trim(target_email)) and created_at>now()-interval '2 minutes') then raise exception 'INVITE_WAIT'; end if;
 insert into public.employee_invitations(company_id,invited_by,email,full_name) values(cid,auth.uid(),lower(trim(target_email)),left(trim(target_name),200)) returning * into inv;
 insert into public.audit_events(company_id,actor_id,action,entity_id) values(cid,auth.uid(),'employee.invite_reserved',inv.id::text);
 return inv;
end $$;
revoke all on function public.reserve_employee_invitation(text,text) from public;grant execute on function public.reserve_employee_invitation(text,text) to authenticated;
-- Le trigger rattache exclusivement un destinataire qui possède une réservation valide.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare cid uuid; inv public.employee_invitations; iid uuid; cname text:=nullif(trim(coalesce(new.raw_user_meta_data->>'company_name','')),'');
begin
 if new.raw_user_meta_data ? 'amana_invitation_id' then
  iid:=(new.raw_user_meta_data->>'amana_invitation_id')::uuid;
  select * into inv from public.employee_invitations where id=iid and email=lower(new.email) and status='reserved' and created_at>now()-interval '1 hour' for update;
  if not found then raise exception 'INVALID_EMPLOYEE_INVITATION'; end if;
  insert into public.profiles(id,company_id,full_name,email,phone,role,status) values(new.id,inv.company_id,inv.full_name,coalesce(new.email,''),coalesce(new.phone,''),'employee','active');
  update public.employee_invitations set status='sent',auth_user_id=new.id where id=iid;
  insert into public.audit_events(company_id,actor_id,action,entity_id) values(inv.company_id,inv.invited_by,'employee.invite_created',iid::text);
  return new;
 end if;
 if cname is null then return new;end if;
 insert into public.companies(name,city,tel) values(left(cname,200),left(coalesce(new.raw_user_meta_data->>'company_city',''),200),left(coalesce(new.phone,''),40)) returning id into cid;
 insert into public.profiles(id,company_id,full_name,email,phone,role,status) values(new.id,cid,left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),nullif(new.email,''),new.phone,'Gérant'),200),coalesce(new.email,''),coalesce(new.phone,''),'admin','active');
 return new;
end $$;
create function public.accept_employee_invitation() returns void language plpgsql security definer set search_path=public as $$
declare inv public.employee_invitations;
begin
 if public.my_company_id() is null then raise exception 'ACCOUNT_REVOKED';end if;
 select * into inv from public.employee_invitations where auth_user_id=auth.uid() and status in ('sent','failed') for update;
 if found then
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and encrypted_password is not null and encrypted_password<>'') then raise exception 'PASSWORD_REQUIRED';end if;
  update public.employee_invitations set status='accepted' where id=inv.id;
  insert into public.audit_events(company_id,actor_id,action,entity_id) values(inv.company_id,auth.uid(),'employee.invite_accepted',inv.id::text);
 end if;
end $$;
revoke all on function public.accept_employee_invitation() from public;grant execute on function public.accept_employee_invitation() to authenticated;
commit;
