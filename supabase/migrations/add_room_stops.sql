-- Migration: add room_stops table
-- Any room member can add up to 2 stops (enforced in app); only the adder or
-- owner can remove a stop.  Realtime is enabled so all members see changes live.

-------------------------------------------------------------------------------
-- room_stops table
-------------------------------------------------------------------------------
create table if not exists public.room_stops (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id)  on delete cascade,
  added_by    uuid not null references auth.users(id)    on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  label       text,
  created_at  timestamptz not null default now()
);

create index if not exists room_stops_room_idx on public.room_stops (room_id);

-------------------------------------------------------------------------------
-- Enable RLS
-------------------------------------------------------------------------------
alter table public.room_stops enable row level security;

-------------------------------------------------------------------------------
-- Policies
--  SELECT : any member of the room
--  INSERT : any member of the room, must be adding as themselves
--  DELETE : the user who added the stop, OR the room owner
-------------------------------------------------------------------------------
drop policy if exists "stops_select_members" on public.room_stops;
create policy "stops_select_members"
  on public.room_stops for select
  to authenticated
  using (public.is_room_member(room_id, auth.uid()));

drop policy if exists "stops_insert_member" on public.room_stops;
create policy "stops_insert_member"
  on public.room_stops for insert
  to authenticated
  with check (
    added_by = auth.uid()
    and public.is_room_member(room_id, auth.uid())
  );

drop policy if exists "stops_delete_self_or_owner" on public.room_stops;
create policy "stops_delete_self_or_owner"
  on public.room_stops for delete
  to authenticated
  using (
    added_by = auth.uid()
    or exists (
      select 1 from public.rooms r
      where r.id = room_id
        and r.owner_id = auth.uid()
    )
  );

-------------------------------------------------------------------------------
-- Realtime publication
-------------------------------------------------------------------------------
alter publication supabase_realtime add table public.room_stops;
