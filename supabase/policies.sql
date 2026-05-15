-- Travel-with-Friends Live Map -- Row Level Security policies
-- Run this AFTER schema.sql in the Supabase SQL editor.

-------------------------------------------------------------------------------
-- Helper: is_room_member -- avoids recursive RLS when policies on a table
-- reference that same table.
-------------------------------------------------------------------------------
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

-------------------------------------------------------------------------------
-- Join flow: lookup room by share code (bypasses rooms RLS safely)
-- Anyone authenticated can call this; it only returns id/name/code for a match.
-------------------------------------------------------------------------------
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

-------------------------------------------------------------------------------
-- Enable RLS
-------------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.rooms         enable row level security;
alter table public.room_members  enable row level security;
alter table public.locations     enable row level security;
alter table public.messages      enable row level security;
alter table public.app_logs      enable row level security;

-------------------------------------------------------------------------------
-- profiles
-- Anyone authenticated can read profiles (so we can show display names of
-- room members). Each user can update only their own profile.
-------------------------------------------------------------------------------
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

-------------------------------------------------------------------------------
-- rooms
-- Read: members or owner.
-- Insert: any authenticated user; must be owner.
-- Update: only the owner (creator) can change the room, e.g. destination on the map.
-- Delete: only owner.
-------------------------------------------------------------------------------
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

-------------------------------------------------------------------------------
-- room_members
-- Read: rows for any room you are a member of (so you can see other members).
-- Insert: only your own membership row (this is how you "join" a room).
-- Delete: only your own membership row (this is how you "leave" a room).
-- Note: SELECT policy uses the helper function to avoid RLS recursion.
-------------------------------------------------------------------------------
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

-------------------------------------------------------------------------------
-- locations
-- Read: any member of the same room can see all locations in that room.
-- Insert/Update: only your own row, and only in a room you belong to.
-------------------------------------------------------------------------------
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

-------------------------------------------------------------------------------
-- messages
-- Read: members of the room.
-- Insert: members of the room, sending as themselves.
-------------------------------------------------------------------------------
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

-------------------------------------------------------------------------------
-- app_logs
-- Insert allowed for any authenticated user (to record their own errors).
-- No SELECT/UPDATE/DELETE from clients -- you read these in the Supabase UI.
-------------------------------------------------------------------------------
drop policy if exists "app_logs_insert_authed" on public.app_logs;
create policy "app_logs_insert_authed"
  on public.app_logs for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());
