-- Sorentho Garage Kasir: one-owner cloud state
-- Run this in Supabase SQL Editor after creating the owner in Authentication.
-- Replace the UUID in the final INSERT with that owner's Auth user ID.

create table if not exists public.shop_state (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null references auth.users (id) on delete restrict,
  payload jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

alter table public.shop_state enable row level security;

drop policy if exists "Owner can read shop state" on public.shop_state;
create policy "Owner can read shop state"
  on public.shop_state
  for select
  to authenticated
  using (auth.uid() = owner_id);

revoke all on table public.shop_state from anon, authenticated;
grant select on table public.shop_state to authenticated;

create or replace function public.save_shop_state(
  p_payload jsonb,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_expected_revision is null then
    raise exception 'Expected revision is required' using errcode = '22023';
  end if;

  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Shop payload must be a JSON object' using errcode = '22023';
  end if;

  select revision
    into current_revision
    from public.shop_state
    where singleton = true and owner_id = auth.uid()
    for update;

  if not found then
    raise exception 'Owner shop state is not configured';
  end if;

  if current_revision <> p_expected_revision then
    raise exception 'Cloud data changed on another device; reload before saving'
      using errcode = '40001';
  end if;

  update public.shop_state
    set payload = p_payload,
        revision = current_revision + 1,
        updated_at = now()
    where singleton = true and owner_id = auth.uid();

  return current_revision + 1;
end;
$$;

revoke all on function public.save_shop_state(jsonb, bigint) from public, anon;
grant execute on function public.save_shop_state(jsonb, bigint) to authenticated;

-- Replace the UUID with the owner ID shown in Authentication > Users.
-- The initial null payload tells the app to migrate local data on the first device.
-- insert into public.shop_state (singleton, owner_id, payload)
-- values (true, '00000000-0000-0000-0000-000000000000', null);
