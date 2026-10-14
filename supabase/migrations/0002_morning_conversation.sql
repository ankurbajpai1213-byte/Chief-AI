-- Chief starts the morning conversation after the first unlock past wake time.
alter table public.profiles
  add column wake_time time not null default '06:00',
  add column morning_auto boolean not null default true;
