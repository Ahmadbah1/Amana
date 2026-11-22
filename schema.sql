-- ============================================================
-- Amana SaaS – schéma v1 (Supabase / PostgreSQL)
-- À exécuter une fois dans Supabase : SQL Editor > New query
-- ============================================================

create table organizations(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free' check (plan in ('free','pro')),
  plan_expires_at timestamptz,
  created_at timestamptz not null default now());

create table shops(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null, city text, phone text, tax_id text, logo_url text, receipt_message text,
  next_receipt_no int not null default 1,
  created_at timestamptz not null default now());

create table members(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner','employee')),
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(org_id,user_id));
create index on members(user_id);

create table member_shops(
  member_id uuid references members on delete cascade,
  shop_id uuid references shops on delete cascade,
  permissions jsonb not null default '{"create_receipt":true,"view_scope":"own"}',
  primary key(member_id,shop_id));

create table receipts(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  shop_id uuid not null references shops on delete cascade,
  number int not null,
  created_by uuid not null references auth.users,
  customer_name text, customer_phone text,
  method text not null default 'mtn' check (method in ('mtn','om','cash','bank','card')),
  tx_id text,
  pay_status text not null default 'ok' check (pay_status in ('ok','pend','chk')),
  paid_at timestamptz not null default now(),
  total numeric(14,0) not null default 0,
  canceled_at timestamptz, canceled_by uuid references auth.users, cancel_reason text,
  created_at timestamptz not null default now(),
  unique(shop_id,number));
create index on receipts(shop_id,created_at desc);

create table receipt_items(
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references receipts on delete cascade,
  label text not null,
  qty numeric(10,2) not null default 1,
  unit_price numeric(14,0) not null default 0);

create table audit_log(
  id bigserial primary key,
  org_id uuid not null, shop_id uuid, user_id uuid,
  action text not null, entity_id uuid, details jsonb,
  created_at timestamptz not null default now());
-- index manquants : jointure items→reçu, journal par organisation, recherche par transaction
create index if not exists idx_receipt_items_receipt on receipt_items(receipt_id);
create index if not exists idx_audit_log_org_created on audit_log(org_id,created_at desc);
create index if not exists idx_receipts_tx_id on receipts(shop_id,tx_id) where tx_id is not null;

-- ---------- fonctions d'aide (security definer : pas de récursion RLS) ----------
create function is_owner(p_org uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from members where user_id=auth.uid() and org_id=p_org and role='owner' and active) $$;
create function is_member(p_org uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from members where user_id=auth.uid() and org_id=p_org and active) $$;
create function in_shop(p_shop uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from shops s join members m on m.org_id=s.org_id and m.user_id=auth.uid() and m.active
    where s.id=p_shop and (m.role='owner' or exists(select 1 from member_shops ms where ms.member_id=m.id and ms.shop_id=s.id))) $$;
create function has_perm(p_shop uuid,p_perm text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from shops s join members m on m.org_id=s.org_id and m.user_id=auth.uid() and m.active
    where s.id=p_shop and (m.role='owner' or exists(select 1 from member_shops ms where ms.member_id=m.id and ms.shop_id=s.id
      and coalesce((ms.permissions->>p_perm)::boolean,false)))) $$;
create function shop_scope(p_shop uuid) returns text language sql stable security definer set search_path=public as $$
  select case when m.role='owner' then 'all' else ms.permissions->>'view_scope' end
  from shops s join members m on m.org_id=s.org_id and m.user_id=auth.uid() and m.active
  left join member_shops ms on ms.member_id=m.id and ms.shop_id=s.id
  where s.id=p_shop limit 1 $$;

-- ---------- sécurité au niveau des lignes ----------
alter table organizations enable row level security;
alter table shops enable row level security;
alter table members enable row level security;
alter table member_shops enable row level security;
alter table receipts enable row level security;
alter table receipt_items enable row level security;
alter table audit_log enable row level security;

create policy org_read on organizations for select using (is_member(id));
create policy org_update on organizations for update using (is_owner(id)) with check (is_owner(id));

create policy shops_read on shops for select using (in_shop(id));
create policy shops_insert on shops for insert with check (is_owner(org_id));
create policy shops_update on shops for update using (is_owner(org_id) or has_perm(id,'edit_shop'));

create policy members_read on members for select using (user_id=auth.uid() or is_owner(org_id));
create policy ms_read on member_shops for select using (
  member_id in (select id from members where user_id=auth.uid())
  or is_owner((select org_id from members where id=member_id)));

create policy receipts_read on receipts for select using (
  shop_scope(shop_id)='all' or (shop_scope(shop_id)='own' and created_by=auth.uid()));
create policy items_read on receipt_items for select using (exists(select 1 from receipts r where r.id=receipt_id));
create policy audit_read on audit_log for select using (is_owner(org_id));

-- droits de table : lecture seule par défaut, écritures uniquement via les fonctions ci-dessous
revoke all on all tables in schema public from anon;
revoke insert,update,delete on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant insert(org_id,name,city,phone,tax_id,logo_url,receipt_message) on shops to authenticated;
grant update(name,city,phone,tax_id,logo_url,receipt_message) on shops to authenticated;
grant update(name) on organizations to authenticated;   -- le plan n'est modifiable que côté serveur

-- ---------- opérations métier ----------
create function create_organization(p_org_name text,p_owner_name text,p_shop_name text) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if exists(select 1 from members where user_id=auth.uid()) then raise exception 'already_member'; end if;
  if char_length(coalesce(trim(p_org_name),''))=0 or char_length(p_org_name)>120
     or char_length(coalesce(trim(p_owner_name),''))=0 or char_length(p_owner_name)>120
     or char_length(coalesce(trim(p_shop_name),''))=0 or char_length(p_shop_name)>120 then
    raise exception 'invalid_name'; end if;
  insert into organizations(name) values (p_org_name) returning id into v_org;
  insert into members(org_id,user_id,role,display_name) values (v_org,auth.uid(),'owner',p_owner_name);
  insert into shops(org_id,name) values (v_org,p_shop_name);
  return v_org;
end $$;

create function create_receipt(p_shop uuid,p_customer text,p_phone text,p_method text,p_tx text,p_status text,p_paid_at timestamptz,p_items jsonb)
returns receipts language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_no int; v_total numeric; r receipts;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  if not has_perm(p_shop,'create_receipt') then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'items_required'; end if;
  if jsonb_array_length(p_items)>100 then raise exception 'too_many_items'; end if;
  -- validation complète AVANT de consommer un numéro de reçu (sinon les numéros font des trous)
  if exists(select 1 from jsonb_array_elements(p_items) i
            where coalesce(trim(i->>'label'),'')='' or char_length(i->>'label')>200
               or coalesce(i->>'qty','')   !~ '^\d{1,4}(\.\d{1,2})?$'
               or coalesce(i->>'price','') !~ '^\d{1,10}(\.\d{1,2})?$') then
    raise exception 'invalid_item';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where (i->>'qty')::numeric<=0) then
    raise exception 'invalid_item';
  end if;
  if p_method is not null and p_method not in ('mtn','om','cash','bank','card') then raise exception 'invalid_method'; end if;
  if p_status is not null and p_status not in ('ok','pend','chk') then raise exception 'invalid_status'; end if;
  if char_length(coalesce(p_customer,''))>120 or char_length(coalesce(p_phone,''))>40 or char_length(coalesce(p_tx,''))>120 then
    raise exception 'invalid_customer'; end if;
  select org_id into v_org from shops where id=p_shop;
  if v_org is null then raise exception 'shop_not_found'; end if;
  update shops set next_receipt_no=next_receipt_no+1 where id=p_shop returning next_receipt_no-1 into v_no;
  select coalesce(sum((i->>'qty')::numeric*(i->>'price')::numeric),0) into v_total from jsonb_array_elements(p_items) i;
  if v_total is null or v_total>99999999999999 then raise exception 'total_too_large'; end if;
  insert into receipts(org_id,shop_id,number,created_by,customer_name,customer_phone,method,tx_id,pay_status,paid_at,total)
  values (v_org,p_shop,v_no,auth.uid(),p_customer,p_phone,coalesce(p_method,'mtn'),p_tx,coalesce(p_status,'ok'),coalesce(p_paid_at,now()),v_total)
  returning * into r;
  insert into receipt_items(receipt_id,label,qty,unit_price)
    select r.id,trim(i->>'label'),(i->>'qty')::numeric,(i->>'price')::numeric from jsonb_array_elements(p_items) i;
  insert into audit_log(org_id,shop_id,user_id,action,entity_id,details)
    values (v_org,p_shop,auth.uid(),'receipt.create',r.id,jsonb_build_object('number',v_no,'total',v_total));
  return r;
end $$;

create function cancel_receipt(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare r receipts;
begin
  select * into r from receipts where id=p_id;
  if not found or not has_perm(r.shop_id,'cancel_receipt') then raise exception 'forbidden'; end if;
  if shop_scope(r.shop_id)<>'all' and r.created_by<>auth.uid() then raise exception 'forbidden'; end if;
  if r.canceled_at is not null then raise exception 'already_canceled'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'reason_required'; end if;
  update receipts set canceled_at=now(),canceled_by=auth.uid(),cancel_reason=p_reason where id=p_id;
  insert into audit_log(org_id,shop_id,user_id,action,entity_id,details)
    values (r.org_id,r.shop_id,auth.uid(),'receipt.cancel',p_id,jsonb_build_object('reason',p_reason));
end $$;

-- p_perms = null : retire l'employé de la boutique
create function set_permissions(p_member uuid,p_shop uuid,p_perms jsonb) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v jsonb;
begin
  select org_id into v_org from members where id=p_member and role='employee';
  if v_org is null or not is_owner(v_org) or not exists(select 1 from shops where id=p_shop and org_id=v_org) then raise exception 'forbidden'; end if;
  if p_perms is null then
    delete from member_shops where member_id=p_member and shop_id=p_shop;
    insert into audit_log(org_id,shop_id,user_id,action,entity_id,details)
      values (v_org,p_shop,auth.uid(),'permissions.remove',p_member,'{}'::jsonb);
    return; end if;
  v:=jsonb_build_object(
    'create_receipt',coalesce((p_perms->>'create_receipt')::boolean,false),
    'view_scope',case when p_perms->>'view_scope'='all' then 'all' else 'own' end,
    'cancel_receipt',coalesce((p_perms->>'cancel_receipt')::boolean,false),
    'edit_price',coalesce((p_perms->>'edit_price')::boolean,false),
    'export',coalesce((p_perms->>'export')::boolean,false),
    'manage_stock',coalesce((p_perms->>'manage_stock')::boolean,false),
    'view_stats',coalesce((p_perms->>'view_stats')::boolean,false),
    'edit_shop',coalesce((p_perms->>'edit_shop')::boolean,false));
  insert into member_shops(member_id,shop_id,permissions) values (p_member,p_shop,v)
    on conflict(member_id,shop_id) do update set permissions=excluded.permissions;
  insert into audit_log(org_id,shop_id,user_id,action,entity_id,details)
    values (v_org,p_shop,auth.uid(),'permissions.set',p_member,v);
end $$;

-- seuls les utilisateurs connectés peuvent appeler les fonctions
do $$ declare f record; begin
  for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace loop
    execute format('revoke execute on function %s from public, anon',f.sig);
    execute format('grant execute on function %s to authenticated',f.sig);
  end loop; end $$;

-- ============================================================
-- Étapes OBLIGATOIRES après ce script (SQL Editor Supabase) :
--
-- 1) Temps réel : activer la publication sur receipts, sinon les changements
--    n'arrivent jamais en direct (l'app recharge quand même toutes les 30 s) :
--      alter publication supabase_realtime add table public.receipts;
--    Vérifier que votre version de Realtime respecte la RLS (Realtime
--    Authorization) : sinon chaque client connecté peut recevoir les
--    lignes receipts des autres organisations.
--
-- 2) Doublons de transaction (recommandé après dédoublonnage) :
--      create unique index receipts_tx_unique on receipts(shop_id, tx_id) where tx_id is not null;
--    Cela empêche de saisir deux fois le même paiement MTN / Orange Money.
--
-- 3) Déployer la fonction staff : supabase functions deploy staff
--    (le fichier se trouve dans supabase/functions/staff/index.ts)
-- ============================================================
