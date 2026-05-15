-- One-time migration if you already applied older policies where any member could
-- update rooms (e.g. rest_point). Run in Supabase SQL editor after policies.sql
-- has been applied once, or run this instead of re-running the full policies file.

drop policy if exists "rooms_update_members" on public.rooms;

drop policy if exists "rooms_update_owner" on public.rooms;
create policy "rooms_update_owner"
  on public.rooms for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
