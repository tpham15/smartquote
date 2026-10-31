-- SmartQuote P2.0 — Final Quote Learning Memory
-- Idempotent migration. Run after the existing P1.5.3.1 master migration.

create table if not exists public.quote_learning_observations (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  observation_key text not null,
  quote_revision integer not null default 1,
  product_key text not null,
  product_id text,
  product_snapshot jsonb not null default '{}'::jsonb,
  customer_category text,
  project_name text,
  industry_profile text,
  section_names jsonb not null default '[]'::jsonb,
  total_qty numeric not null default 0,
  sale_price numeric not null default 0,
  cost_price numeric not null default 0,
  margin_pct numeric,
  finalized_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (dealer_id, quote_id, product_key)
);

create index if not exists quote_learning_dealer_finalized_idx
  on public.quote_learning_observations(dealer_id, finalized_at desc);
create index if not exists quote_learning_dealer_product_idx
  on public.quote_learning_observations(dealer_id, product_key, finalized_at desc);

alter table public.quote_learning_observations enable row level security;

drop policy if exists "Quote learning visible to dealer members" on public.quote_learning_observations;
create policy "Quote learning visible to dealer members"
on public.quote_learning_observations for select
to authenticated
using (public.is_dealer_member(dealer_id));

-- Browser clients may read their own workspace observations, but writes must go
-- through the guarded RPC below so only a real Final quote can create learning.
revoke all on public.quote_learning_observations from anon, authenticated;
grant select on public.quote_learning_observations to authenticated;

create or replace function public.record_quote_learning_observations(
  target_dealer_id uuid,
  target_quote_id uuid,
  observations_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  quote_calc jsonb;
  quote_rooms jsonb;
  quote_revision_value integer := 1;
  inserted_count integer := 0;
  x jsonb;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_dealer_id is null or not public.is_dealer_member(target_dealer_id) then
    raise exception 'Not a member of this dealer workspace';
  end if;

  select q.calc, q.rooms
  into quote_calc, quote_rooms
  from public.quotes q
  where q.id = target_quote_id
    and q.dealer_id = target_dealer_id;

  if not found then
    raise exception 'Quote not found in this dealer workspace';
  end if;

  if lower(coalesce(quote_calc->'workflow'->>'lifecycle', 'draft')) <> 'final' then
    raise exception 'Learning requires a Final quote';
  end if;

  quote_revision_value := greatest(1, coalesce((quote_calc->'workflow'->>'revision')::integer, 1));

  for x in select value from jsonb_array_elements(coalesce(observations_input, '[]'::jsonb))
  loop
    if nullif(trim(x->>'product_key'), '') is null then
      continue;
    end if;

    insert into public.quote_learning_observations (
      dealer_id, quote_id, observation_key, quote_revision, product_key, product_id,
      product_snapshot, customer_category, project_name, industry_profile,
      section_names, total_qty, sale_price, cost_price, margin_pct,
      finalized_at, created_by
    ) values (
      target_dealer_id,
      target_quote_id,
      coalesce(nullif(trim(x->>'observation_key'), ''), target_quote_id::text || '|' || trim(x->>'product_key')),
      quote_revision_value,
      trim(x->>'product_key'),
      nullif(trim(x->>'product_id'), ''),
      coalesce(x->'product_snapshot', '{}'::jsonb),
      nullif(trim(x->>'customer_category'), ''),
      nullif(trim(x->>'project_name'), ''),
      coalesce(nullif(trim(x->>'industry_profile'), ''), 'generic'),
      coalesce(x->'section_names', '[]'::jsonb),
      greatest(0, coalesce((x->>'total_qty')::numeric, 0)),
      greatest(0, coalesce((x->>'sale_price')::numeric, 0)),
      greatest(0, coalesce((x->>'cost_price')::numeric, 0)),
      case when nullif(x->>'margin_pct', '') is null then null else (x->>'margin_pct')::numeric end,
      coalesce(nullif(x->>'finalized_at', '')::timestamptz, now()),
      current_user_id
    )
    on conflict (dealer_id, quote_id, product_key) do update set
      observation_key = excluded.observation_key,
      quote_revision = excluded.quote_revision,
      product_id = excluded.product_id,
      product_snapshot = excluded.product_snapshot,
      customer_category = excluded.customer_category,
      project_name = excluded.project_name,
      industry_profile = excluded.industry_profile,
      section_names = excluded.section_names,
      total_qty = excluded.total_qty,
      sale_price = excluded.sale_price,
      cost_price = excluded.cost_price,
      margin_pct = excluded.margin_pct,
      finalized_at = excluded.finalized_at;

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count, 'quote_id', target_quote_id);
end;
$$;

revoke all on function public.record_quote_learning_observations(uuid, uuid, jsonb) from public, anon;
grant execute on function public.record_quote_learning_observations(uuid, uuid, jsonb) to authenticated;

-- Verification: browser roles may read tenant-scoped rows but cannot bypass the RPC.
select
  has_table_privilege('anon', 'public.quote_learning_observations', 'INSERT') as anon_learning_insert_should_be_false,
  has_table_privilege('authenticated', 'public.quote_learning_observations', 'INSERT') as authenticated_learning_insert_should_be_false,
  has_table_privilege('authenticated', 'public.quote_learning_observations', 'SELECT') as authenticated_learning_select_should_be_true,
  has_function_privilege('anon', 'public.record_quote_learning_observations(uuid,uuid,jsonb)', 'EXECUTE') as anon_learning_rpc_should_be_false,
  has_function_privilege('authenticated', 'public.record_quote_learning_observations(uuid,uuid,jsonb)', 'EXECUTE') as authenticated_learning_rpc_should_be_true;
