# Putting team spaces on the live database

Do these in order. Nothing here deletes your data, and the order matters: **database first, then the app**.
The live app keeps working on the new database while you do steps 1 to 4, so there is no downtime.

Your live project is the one at `hvvtmhlxdmeyozyirpqo.supabase.co` (the `VITE_SUPABASE_URL` in `.replit`).
Open it at https://supabase.com/dashboard/project/hvvtmhlxdmeyozyirpqo and use **SQL Editor → New query**.
Off-peak is best: the changes take a few seconds of brief locks.

1. **Backup.** Paste `rollout/1-backup.sql`, Run. It prints the row counts it copied.
2. **Apply.** Paste `rollout/2-apply-all.sql`, Run. It is long; wait for "Success".
3. **Check.** Paste `rollout/3-check.sql`, Run. Every check must say `true`. Read the second table (your
   client spaces and how many campaigns each holds) and the third (who is an Owner). Demote anyone who
   should not be an Owner with the `update` line in the file.
4. **Edge Functions** (needed for inviting people and the 30-day purge). Dashboard → Edge Functions:
   - New function `invite-member`: paste `functions/invite-member/index.ts`. Secrets: `APP_URL` =
     `https://willi220p-star.github.io/cursor1/`.
   - New function `purge-trash`: paste `functions/purge-trash/index.ts`, switch **Verify JWT off**. Secret:
     `PURGE_TRASH_SECRET` = any long random string.
   - Daily purge schedule: Database → Extensions, turn on `pg_cron` and `pg_net`, then re-run the last
     migration block (`202610170006_purge_trash_schedule.sql`) after saving Vault secrets `project_url`
     and `purge_trash_secret`. Until then Trash simply keeps items longer; nothing is lost.
5. **Tell Claude "database done".** Claude then merges the app to `main` and checks the live site on a phone.

## If something looks wrong

Everything is reversible. Paste the matching `rollbacks/2026101700NN_*.down.sql` files in **reverse
order** (07 down to 01). Rollback drops the activity log, reviews, comments, notifications and invites,
so export them first if they matter. Your original tables are also copied in schema
`backup_before_spaces`.
