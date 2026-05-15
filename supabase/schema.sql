-- Travel-with-Friends Live Map -- Schema
-- Run this in the Supabase SQL editor BEFORE policies.sql

-- Required extension for gen_random_uuid()
create extension if not exists "pgcrypto";

-------------------------------------------------------------------------------
-- profiles: 1-1 with auth.users, holds display_name
-------------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
-- The display_name comes from raw_user_meta_data.display_name (set at signup).
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
-- rooms: a travel room with a shareable code and an optional destination (JSON rest_point)
-------------------------------------------------------------------------------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  rest_point  jsonb,                 -- shared destination: { lat, lng, label? } — only owner may update (see policies)
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create index if not exists rooms_code_idx   on public.rooms (code);
create index if not exists rooms_owner_idx  on public.rooms (owner_id);

-------------------------------------------------------------------------------
-- room_members: who is in which room
-------------------------------------------------------------------------------
create table if not exists public.room_members (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id)  on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on public.room_members (user_id);

-------------------------------------------------------------------------------
-- locations: latest known position per (room, user) -- upsert target
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
-- messages: chat
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
-- app_logs: client-reported errors so we can debug without screen-sharing
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
-- Realtime: ensure the relevant tables are in the publication
-- (Supabase normally adds them automatically, but this is idempotent.)
-------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end$$;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.locations;
