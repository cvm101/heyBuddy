-- =============================================================================
-- Travel with Friends — FULL Supabase setup (schema + RLS policies)
-- Paste into Supabase → SQL Editor → Run
--
-- Safe to re-run on a project that already has these tables/policies in most
-- cases (IF NOT EXISTS, DROP POLICY IF EXISTS, idempotent Realtime adds).
-- If any statement errors, read the message: often it is "already exists" and
-- you can skip that fragment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PART A — Schema (from schema.sql)
-- -----------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-------------------------------------------------------------------------------
-- profiles: 1-1 with auth.users, holds display_name
-------------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-------------------------------------------------------------------------------
-- rooms
-------------------------------------------------------------------------------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  rest_point  jsonb,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create index if not exists rooms_code_idx   on public.rooms (code);
create index if not exists rooms_owner_idx  on public.rooms (owner_id);

-------------------------------------------------------------------------------
-- room_members
-------------------------------------------------------------------------------
create table if not exists public.room_members (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id)  on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on public.room_members (user_id);

-------------------------------------------------------------------------------
-- locations
-------------------------------------------------------------------------------
create table if not exists public.locations (
  room_id     uuid not null references public.rooms(id) on delete cascade,
  user_id     uuid not null references auth.users(id)  on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    real,
  updated_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists locations_room_idx on public.locations (room_id);

-------------------------------------------------------------------------------
-- messages
-------------------------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  user_id     uuid not null references auth.users(id)  on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);

create index if not exists messages_room_created_idx on public.messages (room_id, created_at);

-------------------------------------------------------------------------------
-- app_logs
-------------------------------------------------------------------------------
create table if not exists public.app_logs (
  id          bigserial primary key,
  level       text not null check (level in ('debug','info','warn','error')),
  source      text not null,
  message     text not null,
  context     jsonb,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists app_logs_created_idx on public.app_logs (created_at desc);

-------------------------------------------------------------------------------
-- Realtime publication (idempotent adds)
-------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    execute 'alter publication supabase_realtime add table public.rooms';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'locations'
  ) then
    execute 'alter publication supabase_realtime add table public.locations';
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- PART B — Row Level Security (from policies.sql)
-- -----------------------------------------------------------------------------

create or replace function public.is_room_member(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = p_room_id
      and user_id = p_user_id
  );
$$;

revoke all on function public.is_room_member(uuid, uuid) from public;
grant execute on function public.is_room_member(uuid, uuid) to authenticated;

create or replace function public.lookup_room_by_code(p_code text)
returns table (id uuid, name text, code text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.name, r.code
  from public.rooms r
  where r.code = upper(trim(both from p_code))
    and r.ended_at is null
  limit 1;
$$;

revoke all on function public.lookup_room_by_code(text) from public;
grant execute on function public.lookup_room_by_code(text) to authenticated;

alter table public.profiles      enable row level security;
alter table public.rooms         enable row level security;
alter table public.room_members  enable row level security;
alter table public.locations     enable row level security;
alter table public.messages      enable row level security;
alter table public.app_logs      enable row level security;

-- profiles
drop policy if exists "profiles_read_all_authed" on public.profiles;
create policy "profiles_read_all_authed"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- rooms (only owner may update — destination / rest_point)
drop policy if exists "rooms_select_members" on public.rooms;
create policy "rooms_select_members"
  on public.rooms for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.is_room_member(id, auth.uid())
  );

drop policy if exists "rooms_insert_owner" on public.rooms;
create policy "rooms_insert_owner"
  on public.rooms for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "rooms_update_members" on public.rooms;
drop policy if exists "rooms_update_owner" on public.rooms;
create policy "rooms_update_owner"
  on public.rooms for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "rooms_delete_owner" on public.rooms;
create policy "rooms_delete_owner"
  on public.rooms for delete
  to authenticated
  using (owner_id = auth.uid());

-- room_members
drop policy if exists "members_select_in_my_rooms" on public.room_members;
create policy "members_select_in_my_rooms"
  on public.room_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_room_member(room_id, auth.uid())
  );

drop policy if exists "members_insert_self" on public.room_members;
create policy "members_insert_self"
  on public.room_members for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "members_delete_self" on public.room_members;
create policy "members_delete_self"
  on public.room_members for delete
  to authenticated
  using (user_id = auth.uid());

-- locations
drop policy if exists "locations_select_members" on public.locations;
create policy "locations_select_members"
  on public.locations for select
  to authenticated
  using (public.is_room_member(room_id, auth.uid()));

drop policy if exists "locations_insert_self" on public.locations;
create policy "locations_insert_self"
  on public.locations for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_room_member(room_id, auth.uid())
  );

drop policy if exists "locations_update_self" on public.locations;
create policy "locations_update_self"
  on public.locations for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_room_member(room_id, auth.uid())
  );

-- messages
drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members"
  on public.messages for select
  to authenticated
  using (public.is_room_member(room_id, auth.uid()));

drop policy if exists "messages_insert_member_self" on public.messages;
create policy "messages_insert_member_self"
  on public.messages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_room_member(room_id, auth.uid())
  );

-- app_logs
drop policy if exists "app_logs_insert_authed" on public.app_logs;
create policy "app_logs_insert_authed"
  on public.app_logs for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

-- =============================================================================
-- Done. In Dashboard → Database → Replication, confirm messages / rooms /
-- locations are listed for Realtime if your project uses the UI for that.
-- =============================================================================
