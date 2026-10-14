-- Chief: core schema. Every row belongs to one user; RLS keeps users apart.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Dubai',
  morning_checkin time not null default '09:00',
  evening_checkin time not null default '21:00',
  max_active_projects int not null default 3 check (max_active_projects between 1 and 10),
  tone text not null default 'calm and direct',
  language text not null default 'English + Hinglish',
  voice_replies boolean not null default true,
  leak_apps text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Whole-life context: goals, constraints, facts Chief should always weigh.
create table public.life_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area text not null check (area in ('work','money','side_projects','family','health','learning','other')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  why text,
  outcome text,
  goal_type text check (goal_type in ('money','business','personal','health','learning','family','other')),
  hours_per_week numeric,
  deadline date,
  status text not null default 'active' check (status in ('active','parked','done','dropped')),
  milestones jsonb not null default '[]',
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  minutes int not null default 30 check (minutes between 5 and 480),
  scheduled_at timestamptz,
  status text not null default 'planned' check (status in ('planned','done','missed','parked','cancelled')),
  postpone_count int not null default 0,
  last_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user','chief','event')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('morning','evening')),
  day date not null,
  done_count int not null default 0,
  missed_count int not null default 0,
  summary text,
  created_at timestamptz not null default now()
);

create index on public.life_notes (user_id);
create index on public.projects (user_id, status);
create index on public.steps (user_id, status, scheduled_at);
create index on public.steps (project_id);
create index on public.messages (user_id, created_at desc);
create index on public.checkins (user_id, day);

alter table public.profiles   enable row level security;
alter table public.life_notes enable row level security;
alter table public.projects   enable row level security;
alter table public.steps      enable row level security;
alter table public.messages   enable row level security;
alter table public.checkins   enable row level security;

create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "own life notes" on public.life_notes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own projects" on public.projects for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own steps" on public.steps for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own messages" on public.messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own checkins" on public.checkins for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Create a profile automatically on sign-up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- "Delete all my data": removes the account and, by cascade, every row.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Trigger function must not be callable over the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
