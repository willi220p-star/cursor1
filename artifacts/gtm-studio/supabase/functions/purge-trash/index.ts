// Edge Function: purge-trash
// Deletes library items that have been in Trash for more than 30 days: storage objects first (batches of 100),
// then the rows. The delete trigger on each table writes the 'purged' activity row.
// Called daily by pg_cron + pg_net (migration 202610170006) with "Authorization: Bearer <PURGE_TRASH_SECRET>".
// Deploy with --no-verify-jwt; this function checks the shared secret itself.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (provided by Supabase), PURGE_TRASH_SECRET (set with
// `supabase secrets set`, same value as the Vault secret 'purge_trash_secret').
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TRASH_DAYS = 30;
const BATCH = 100;
const BUCKET = 'outbound-assets';
// Assets and templates own files; campaigns and folders go after them so their items unlink cleanly.
const TABLES = [
  { table: 'outbound_assets', hasFile: true },
  { table: 'outbound_templates', hasFile: true },
  { table: 'outbound_campaigns', hasFile: false },
  { table: 'outbound_folders', hasFile: false },
] as const;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PURGE_TRASH_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) return json(500, { ok: false, error: { code: 'server', message: 'Not configured.' } });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(token, secret)) return json(401, { ok: false, error: { code: 'permission', message: 'Not allowed.' } });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const purged: Record<string, number> = {};

  for (const { table, hasFile } of TABLES) {
    purged[table] = 0;
    for (;;) {
      const { data: rows, error } = await admin
        .from(table)
        .select(hasFile ? 'id, storage_path' : 'id')
        .lt('deleted_at', cutoff)
        .order('deleted_at')
        .limit(BATCH);
      if (error) return json(500, { ok: false, purged, error: { code: 'server', message: `${table}: ${error.message}` } });
      if (!rows?.length) break;

      const items = rows as unknown as Array<{ id: string; storage_path?: string | null }>;
      const paths = items.map((row) => row.storage_path).filter((path): path is string => Boolean(path));
      if (paths.length) {
        const removed = await admin.storage.from(BUCKET).remove(paths);
        // A file that is already gone is fine; any other storage error stops before rows are deleted.
        if (removed.error) {
          return json(502, { ok: false, purged, error: { code: 'server', message: `storage: ${removed.error.message}` } });
        }
      }

      const ids = items.map((row) => row.id);
      const deleted = await admin.from(table).delete().in('id', ids);
      if (deleted.error) return json(500, { ok: false, purged, error: { code: 'server', message: `${table}: ${deleted.error.message}` } });
      purged[table] += ids.length;
      if (ids.length < BATCH) break;
    }
  }

  console.log(JSON.stringify({ event: 'purge-trash', cutoff, purged }));
  return json(200, { ok: true, purged, error: null });
});
