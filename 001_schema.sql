-- ============================================================
-- Amana Recu — schema multi-entreprises (gerant / employes)
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- tables ----------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text default '',
  tel         text default '',
  niu         text default '',
  logo_url    text,
  footer_msg  text default 'Merci de votre confiance !',
  currency    text default 'FCFA',
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name  text not null default '',
  email      text not null default '',
  role       text not null default 'employee' check (role in ('admin','employee')),
  status     text not null default 'active'   check (status in ('active','revoked')),
  created_at timestamptz not null default now()
);
create index if not exists profiles_company_idx on public.profiles(company_id);

create sequence if not exists public.receipt_seq start 1000;

create table if not exists public.receipts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  number      text not null default ('REC-' || lpad(nextval('public.receipt_seq')::text, 5, '0')),
  client      text default '',
  method      text default 'mtn',
  status      text default 'ok',
  txid        text default '',
  issued_at   timestamptz not null default now(),
  items       jsonb not null default '[]'::jsonb,
  total       numeric(14,2) not null default 0,
  note        text default '',
  created_at  timestamptz not null default now()
);
create index if not exists receipts_company_idx on public.receipts(company_id, issued_at desc);
create index if not exists receipts_author_idx  on public.receipts(author_id);

create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  receipt_id    uuid references public.receipts(id) on delete cascade,
  author_id     uuid references public.profiles(id) on delete set null,
  reason        text not null default 'erreur',
  message       text not null default '',
  status        text not null default 'open' check (status in ('open','resolved','rejected')),
  resolution    text default '',
  resolved_by   uuid references public.profiles(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists reports_company_idx on public.reports(company_id, created_at desc);

-- ---------- helpers (security definer : evite la recursion RLS) ----------
create or replace function public.my_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles
   where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and status = 'active' and role = 'admin'
  )
$$;

revoke all on function public.my_company_id() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.my_company_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- provisioning d'un compte entreprise ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  cname text := nullif(trim(coalesce(new.raw_user_meta_data->>'company_name','')), '');
begin
  if cname is null then
    return new; -- compte employe : la ligne profiles est creee par l'admin
  end if;

  insert into public.companies (name, city, tel)
  values (cname,
          coalesce(new.raw_user_meta_data->>'company_city',''),
          coalesce(new.raw_user_meta_data->>'company_tel',''))
  returning id into cid;

  insert into public.profiles (id, company_id, full_name, email, role, status)
  values (new.id, cid,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          new.email, 'admin', 'active');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- garde-fous ----------
-- un employe revoque perd tout acces : la fonction my_company_id() renvoie null.
create or replace function public.block_revoked_writes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles
                  where id = auth.uid() and status = 'active') then
    raise exception 'Compte revoque : action impossible.';
  end if;
  return new;
end $$;

drop trigger if exists guard_receipts on public.receipts;
create trigger guard_receipts before insert on public.receipts
  for each row execute function public.block_revoked_writes();

drop trigger if exists guard_reports on public.reports;
create trigger guard_reports before insert on public.reports
  for each row execute function public.block_revoked_writes();

-- un admin ne peut pas se revoquer lui-meme
create or replace function public.protect_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (new.role <> 'admin' or new.status <> 'active')
     and new.id = auth.uid() then
    raise exception 'Vous ne pouvez pas revoquer votre propre compte gerant.';
  end if;
  return new;
end $$;

drop trigger if exists guard_admin on public.profiles;
create trigger guard_admin before update on public.profiles
  for each row execute function public.protect_last_admin();

-- un non-admin ne peut pas modifier son role, son statut ni son entreprise
create or replace function public.block_self_privilege()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id = auth.uid() and not public.is_admin() then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.company_id is distinct from old.company_id then
      raise exception 'Modification non autorisee.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_privilege on public.profiles;
create trigger guard_privilege before update on public.profiles
  for each row execute function public.block_self_privilege();

-- ---------- RLS ----------
alter table public.companies enable row level security;
alter table public.profiles  enable row level security;
alter table public.receipts  enable row level security;
alter table public.reports   enable row level security;

-- companies
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to authenticated
  using (id = public.my_company_id());

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (id = public.my_company_id() and public.is_admin())
  with check (id = public.my_company_id() and public.is_admin());

-- profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or (company_id = public.my_company_id() and public.is_admin()));

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());

-- receipts : le gerant voit tout, l'employe uniquement ses propres recus
drop policy if exists receipts_read on public.receipts;
create policy receipts_read on public.receipts for select to authenticated
  using (company_id = public.my_company_id()
         and (public.is_admin() or author_id = auth.uid()));

drop policy if exists receipts_insert on public.receipts;
create policy receipts_insert on public.receipts for insert to authenticated
  with check (company_id = public.my_company_id() and author_id = auth.uid());

drop policy if exists receipts_admin_write on public.receipts;
create policy receipts_admin_write on public.receipts for update to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id());

drop policy if exists receipts_admin_delete on public.receipts;
create policy receipts_admin_delete on public.receipts for delete to authenticated
  using (company_id = public.my_company_id() and public.is_admin());

-- reports
drop policy if exists reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated
  using (company_id = public.my_company_id()
         and (public.is_admin() or author_id = auth.uid()));

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (company_id = public.my_company_id() and author_id = auth.uid());

drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports for update to authenticated
  using (company_id = public.my_company_id() and public.is_admin())
  with check (company_id = public.my_company_id() and public.is_admin());

-- ---------- grants ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.companies, public.profiles, public.receipts, public.reports to authenticated;
grant usage, select on sequence public.receipt_seq to authenticated;

-- ---------- storage ----------
insert into storage.buckets (id, name, public)
values ('logos','logos', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('receipts','receipts', false)
on conflict (id) do nothing;

drop policy if exists logos_public_read on storage.objects;
create policy logos_public_read on storage.objects for select
  using (bucket_id = 'logos');

drop policy if exists logos_admin_write on storage.objects;
create policy logos_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.is_admin()
              and (storage.foldername(name))[1] = public.my_company_id()::text);

drop policy if exists logos_admin_update on storage.objects;
create policy logos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.is_admin()
         and (storage.foldername(name))[1] = public.my_company_id()::text);

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
              and (storage.foldername(name))[1] = public.my_company_id()::text);

drop policy if exists receipts_read on storage.objects;
create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
         and (storage.foldername(name))[1] = public.my_company_id()::text
         and (public.is_admin() or (storage.foldername(name))[2] = auth.uid()::text));
