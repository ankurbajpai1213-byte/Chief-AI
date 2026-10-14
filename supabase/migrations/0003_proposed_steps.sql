-- Chief's plans start as proposals; they become real (and get reminders) only after the user approves.
alter table public.steps drop constraint steps_status_check;
alter table public.steps add constraint steps_status_check check (status in ('proposed','planned','done','missed','parked','cancelled'));
