-- Reverses 202610170005_bulk_rpcs.sql.

drop function if exists public.accept_invite();
drop function if exists public.bulk_purge(text, uuid[]);
drop function if exists public.bulk_rename(text, jsonb);
drop function if exists public.bulk_update_campaigns(uuid[], jsonb);
drop function if exists public.bulk_move(text, uuid[], uuid, uuid);
drop function if exists public.bulk_restore(text, uuid[]);
drop function if exists public.bulk_trash(text, uuid[]);
drop function if exists public.app_tag_list(jsonb);
drop function if exists public.app_merge_tags(text[], text[], text[]);
drop function if exists public.app_push_history(jsonb, text, integer);
drop function if exists public.app_last_editor(text, uuid);
drop function if exists public.app_bulk_row(text, uuid);
drop function if exists public.app_bulk_ids(uuid[]);
drop function if exists public.app_bulk_reject(uuid[], text, text);
drop function if exists public.app_bulk_error_message(text, text);
drop function if exists public.app_bulk_error_code(text);
drop function if exists public.app_bulk_table(text);
