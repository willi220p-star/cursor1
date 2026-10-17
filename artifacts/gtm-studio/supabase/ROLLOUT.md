# Live rollout status (project hvvtmhlxdmeyozyirpqo, "DGK GTM Personalisation")

**Done by Claude on 2026-10-17:** backup (`backup_before_spaces`), migrations 1 to 5 applied in pieces (the
tool times out on long statements and on anything with DROP/DELETE), the checks in `rollout/3-check.sql`
all pass (19 campaigns, 120 files, 121 stored images, 1 Owner, everything filed in "Internal (DGK)"), and the
`invite-member` Edge Function is deployed.

**Left for you (2 minutes), because they need a human to confirm:**
1. SQL editor: paste and run `rollout/4-finish.sql` (removes the four old owner-only rules, adds "Delete
   forever", keeps a person's work when their login is removed).
2. Dashboard, Edge Functions, Secrets: add `APP_URL` = `https://willi220p-star.github.io/cursor1/`
   (invites need it). Optional: Authentication, Passwords, turn on leaked-password protection.
3. Skipped on purpose: the 30-day auto-purge (needs pg_cron, pg_net and a shared secret). Trash simply keeps
   items until you empty it.

---

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
