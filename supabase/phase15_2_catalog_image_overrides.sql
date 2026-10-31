-- SmartQuote P1.5.2 — Dealer product-image overrides
-- Public-read / tenant-write bucket: product photos are intended to appear in customer quotations.
-- Only authenticated members of the dealer workspace can upload, replace or delete objects
-- under that dealer's UUID prefix.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-product-images',
  'catalog-product-images',
  true,
  4194304,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_catalog_image_path(object_name text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  dealer_text text;
  dealer_uuid uuid;
begin
  dealer_text := split_part(coalesce(object_name, ''), '/', 1);
  if dealer_text = '' then
    return false;
  end if;
  begin
    dealer_uuid := dealer_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return public.is_dealer_member(dealer_uuid);
end;
$$;

revoke all on function public.can_manage_catalog_image_path(text) from public;
grant execute on function public.can_manage_catalog_image_path(text) to authenticated;

drop policy if exists "Catalog images insert by dealer members" on storage.objects;
create policy "Catalog images insert by dealer members"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
);

drop policy if exists "Catalog images update by dealer members" on storage.objects;
create policy "Catalog images update by dealer members"
on storage.objects for update
to authenticated
using (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
)
with check (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
);

drop policy if exists "Catalog images delete by dealer members" on storage.objects;
create policy "Catalog images delete by dealer members"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
);

-- Authenticated members may list/read their own workspace objects through Storage APIs.
-- The bucket itself is public-read so generated quotation files can embed the image URL.
drop policy if exists "Catalog images list by dealer members" on storage.objects;
create policy "Catalog images list by dealer members"
on storage.objects for select
to authenticated
using (
  bucket_id = 'catalog-product-images'
  and public.can_manage_catalog_image_path(name)
);

-- Verification: all *_should_be_true columns should return true.
select
  exists (
    select 1 from storage.buckets
    where id = 'catalog-product-images'
      and public = true
      and file_size_limit = 4194304
  ) as bucket_public_read_should_be_true,
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Catalog images insert by dealer members'
  ) as tenant_insert_policy_should_be_true,
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Catalog images update by dealer members'
  ) as tenant_update_policy_should_be_true,
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Catalog images delete by dealer members'
  ) as tenant_delete_policy_should_be_true,
  has_function_privilege('authenticated', 'public.can_manage_catalog_image_path(text)', 'EXECUTE')
    as authenticated_path_guard_should_be_true;
