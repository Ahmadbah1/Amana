-- Déjà appliqué sur etomyyijwouxbagnnjun après 001_schema.sql.
drop policy if exists receipts_read on public.receipts;
create policy receipts_read on public.receipts for select to authenticated using(company_id=public.my_company_id() and public.is_admin());
create or replace function public.validate_receipt() returns trigger language plpgsql set search_path=public as $$ declare it jsonb; amount numeric:=0; begin
if new.method not in ('MTN MoMo','Orange Money','Espèces','Virement','Carte') or new.status not in ('ok','chk') then raise exception 'Invalid payment'; end if;
if jsonb_typeof(new.items)<>'array' or jsonb_array_length(new.items)<1 then raise exception 'Items required'; end if;
for it in select * from jsonb_array_elements(new.items) loop
if coalesce(trim(it->>'n'),'')='' or (it->>'q')::numeric<=0 or (it->>'p')::numeric<0 then raise exception 'Invalid item'; end if;
amount:=amount+(it->>'q')::numeric*(it->>'p')::numeric;
end loop;
new.total:=amount; return new; end $$;
create trigger validate_receipt before insert or update on public.receipts for each row execute function public.validate_receipt();
create or replace function public.issue_receipt(payload jsonb) returns public.receipts language plpgsql security definer set search_path=public as $$ declare p public.profiles; r public.receipts; begin
select * into p from public.profiles where id=auth.uid() and status='active'; if not found then raise exception 'Unauthorized'; end if;
insert into public.receipts(company_id,author_id,client,method,status,txid,items) values(p.company_id,p.id,left(payload->>'client',200),payload->>'method',payload->>'status',left(payload->>'txid',200),payload->'items') returning * into r;
return r; end $$;
revoke all on function public.issue_receipt(jsonb) from public; grant execute on function public.issue_receipt(jsonb) to authenticated;
create or replace function public.validate_report() returns trigger language plpgsql security definer set search_path=public as $$ begin
if new.receipt_id is not null and not exists(select 1 from public.receipts where id=new.receipt_id and company_id=new.company_id and (author_id=auth.uid() or public.is_admin())) then raise exception 'Invalid receipt'; end if; return new; end $$;
create trigger validate_report before insert on public.reports for each row execute function public.validate_report();
-- 001 uses these policy names; replace both original and deployed variants.
drop policy if exists receipts_read on storage.objects;
drop policy if exists receipts_insert on storage.objects;
drop policy if exists receipts_obj_read on storage.objects;
create policy receipts_obj_read on storage.objects for select to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=public.my_company_id()::text and public.is_admin());
drop policy if exists receipts_obj_insert on storage.objects;
create policy receipts_obj_insert on storage.objects for insert to authenticated with check(bucket_id='receipts' and (storage.foldername(name))[1]=public.my_company_id()::text and public.is_admin());
