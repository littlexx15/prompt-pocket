-- Prompt Pocket 云同步初始化脚本（可重复执行）
create table if not exists public.user_library (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prompts jsonb not null default '[]'::jsonb,
  cases jsonb not null default '[]'::jsonb,
  assets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_library enable row level security;
grant select, insert, update, delete on public.user_library to authenticated;

drop policy if exists "Users read own library" on public.user_library;
create policy "Users read own library" on public.user_library
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users create own library" on public.user_library;
create policy "Users create own library" on public.user_library
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update own library" on public.user_library;
create policy "Users update own library" on public.user_library
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own library" on public.user_library;
create policy "Users delete own library" on public.user_library
  for delete to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prompt-pocket-media', 'prompt-pocket-media', false, 104857600,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read own media" on storage.objects;
create policy "Users read own media" on storage.objects
  for select to authenticated
  using (bucket_id = 'prompt-pocket-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users upload own media" on storage.objects;
create policy "Users upload own media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'prompt-pocket-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users update own media" on storage.objects;
create policy "Users update own media" on storage.objects
  for update to authenticated
  using (bucket_id = 'prompt-pocket-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'prompt-pocket-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users delete own media" on storage.objects;
create policy "Users delete own media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'prompt-pocket-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
