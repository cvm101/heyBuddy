-- Fix: "Join room" failed for guests because rooms SELECT RLS only allowed
-- owner or existing members — joiners could not read the row to get room id.
-- Run once in Supabase SQL editor.

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
