alter table public.outbound_campaigns drop constraint if exists outbound_campaigns_mode_check;
alter table public.outbound_campaigns add constraint outbound_campaigns_mode_check check (mode in ('handwritten', 'memes', 'gif', 'avatar'));
alter table public.outbound_templates drop constraint if exists outbound_templates_mode_check;
alter table public.outbound_templates add constraint outbound_templates_mode_check check (mode in ('handwritten', 'memes', 'gif', 'avatar'));
