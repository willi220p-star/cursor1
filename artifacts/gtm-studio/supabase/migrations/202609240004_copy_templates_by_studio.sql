alter table public.outbound_copy_templates
  add column if not exists studio text not null default 'handwritten';

alter table public.outbound_copy_templates
  drop constraint if exists outbound_copy_templates_user_name;

alter table public.outbound_copy_templates
  drop constraint if exists outbound_copy_templates_studio_known;

alter table public.outbound_copy_templates
  add constraint outbound_copy_templates_studio_known
  check (studio in ('handwritten', 'avatar', 'memes', 'gif', 'handgif', 'carousel'));

alter table public.outbound_copy_templates
  drop constraint if exists outbound_copy_templates_user_studio_name;

alter table public.outbound_copy_templates
  add constraint outbound_copy_templates_user_studio_name
  unique (user_id, studio, name);

create index if not exists outbound_copy_templates_user_studio_updated
  on public.outbound_copy_templates (user_id, studio, updated_at desc);
