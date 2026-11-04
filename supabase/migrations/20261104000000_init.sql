-- raptOR: per-shooter sessions and settings, plus a daily scan counter for the Gemini function.

create table public.sessions (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  date date not null,
  label text not null,
  fired int not null default 0,
  shots jsonb not null default '[]',
  series_times jsonb not null default '{}',
  screen_total numeric(5,1),
  note text not null default '',
  created_at bigint not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  tens numeric(3,1) not null default 10,
  mark numeric(3,1) not null default 10.2,
  planned int not null default 60
);

create table public.scan_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (user_id, day)
);

alter table public.sessions enable row level security;
alter table public.settings enable row level security;
alter table public.scan_usage enable row level security; -- no policies: only bump_scan touches it

create policy "own sessions select" on public.sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "own sessions insert" on public.sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own sessions update" on public.sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own sessions delete" on public.sessions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own settings select" on public.settings for select to authenticated using ((select auth.uid()) = user_id);
create policy "own settings insert" on public.settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own settings update" on public.settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own settings delete" on public.settings for delete to authenticated using ((select auth.uid()) = user_id);

create function public.bump_scan(cap int) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return false; end if;
  insert into scan_usage as u (user_id, day, count) values (uid, (now() at time zone 'utc')::date, 1)
    on conflict (user_id, day) do update set count = u.count + 1
    returning u.count into n;
  return n <= cap;
end $$;

revoke execute on function public.bump_scan(int) from public, anon;
grant execute on function public.bump_scan(int) to authenticated;
