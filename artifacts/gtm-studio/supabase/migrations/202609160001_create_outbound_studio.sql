create extension if not exists pgcrypto;

create table if not exists public.outbound_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  mode text not null check (mode in ('handwritten', 'memes', 'gif')),
  config jsonb not null default '{}'::jsonb,
  source_columns jsonb not null default '[]'::jsonb,
  source_data jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outbound_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  mode text not null check (mode in ('handwritten', 'memes', 'gif')),
  storage_path text,
  zones jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outbound_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.outbound_campaigns(id) on delete set null,
  contact_key text,
  filename text not null,
  storage_path text not null,
  public_url text not null,
  content_type text not null default 'image/png',
  bytes integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.outbound_campaigns enable row level security;
alter table public.outbound_templates enable row level security;
alter table public.outbound_assets enable row level security;

create policy "campaign owners manage campaigns"
  on public.outbound_campaigns for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "template owners manage templates"
  on public.outbound_templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "asset owners manage assets"
  on public.outbound_assets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'outbound-assets',
  'outbound-assets',
  true,
  10485760,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'font/ttf', 'font/otf', 'font/woff', 'font/woff2'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "public reads outbound assets"
  on storage.objects for select
  using (bucket_id = 'outbound-assets');

create policy "users upload outbound assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'outbound-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users update outbound assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'outbound-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'outbound-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete outbound assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'outbound-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
