# Handoff: DGK Outbound Studio

Written 2026-10-09 from the repo, GitHub, and the live Supabase project. No secret values are included. If a fact was not re-checked, it is marked **Unsure**.

Public repo: https://github.com/willi220p-star/cursor1

Product: invite-only operator app for DGK Business Consultancy. The UI that matters is `artifacts/gtm-studio` (Vite, React, TypeScript, Tailwind, shadcn/ui, wouter). Maintainer named in `README.md`: Sushant.

This Cursor workspace’s `origin` is **not** GitHub. Pushing `origin` does not update `willi220p-star/cursor1`. GitHub has been updated by copying files onto GitHub’s own `main` history. The two `main` branches are different commit graphs.

| Place | `main` tip checked 2026-10-09 |
| --- | --- |
| This Cursor workspace | `f2087b15b98a2646ca29e14dcae2c60f956c5fdd` — “Let saved images and files open from the library.” |
| GitHub `willi220p-star/cursor1` | `3193470aebd38b41be4384bcd10798954359f804` — same message, different commit, 2026-09-24 |

A file-by-file diff of those two trees was **not** run. Do not force-push one history onto the other.

## 1. Hosting and deploy

### Live URLs

| URL | Role |
| --- | --- |
| https://willi220p-star.github.io/cursor1/ | **Main live site.** Repo homepage. GitHub Pages `html_url`. On 2026-10-09 the served bundle `/cursor1/assets/index-D6GInG79.js` contains the library heading “Templates, files, and campaigns” and “New folder”. |
| http://127.0.0.1:43123 | Local Vite dev server only. Not a public host. |
| Vercel | A project named `cursor1` exists (`prj_Gy6qzVV3qgVOsBmUMOe7IK6mHAqT`, team `team_3y28bT63fsbdUs22YIZXRvBr`). **Unsure** whether it is linked to this GitHub repo, whether any deployment URL is healthy, and which env vars are set. `get_project` and env list returned 403 for scope `sus-7971`. The Vercel CLI is not installed here. |

No other public host was found.

### What triggers a deploy

**GitHub Pages (the one that is actually serving the app)**

- Workflow: `.github/workflows/pages.yml`, name “Deploy GitHub Pages”.
- Triggers: push to `main`, and `workflow_dispatch`.
- `concurrency.group` is `pages` with `cancel-in-progress: true`.
- Build: `pnpm install` at the repo root, then `pnpm run build` in `artifacts/gtm-studio` with `BASE_PATH=/cursor1/`.
- Deploy job uses `actions/deploy-pages@v4` and the `github-pages` environment.
- Pages site API: `build_type` is `workflow`, `https_enforced` is true, `public` is true. `source.branch` is recorded as `gh-pages` with path `/`.
- **Unsure conflict:** `GET` latest Pages build still names commit `cad1ef6a3943fc56b5138f05725996f98496cd9d` (2026-09-22, “Publish Outbound Studio to GitHub Pages”). That object does not match the JS that is actually being served. The last Actions deploy verified in the earlier publish work was run `35952840290`, conclusion success, for GitHub SHA `3193470` on 2026-09-24. This handoff did not re-list Actions runs.

**Vercel**

- `vercel.json` at the repo root sets framework `vite`, `installCommand` `pnpm install`, `buildCommand` `BASE_PATH=/ pnpm --filter @workspace/gtm-studio run build`, `outputDirectory` `artifacts/gtm-studio/dist/public`, and an SPA rewrite to `/index.html`.
- An earlier Vercel upload was stopped by the operator and was not resumed. Do not start a new Vercel deploy unless they ask.

### GitHub Actions secrets

Repository secrets on `willi220p-star/cursor1`, all present (values not read):

- `VITE_SUPABASE_URL` (created 2026-09-22)
- `VITE_SUPABASE_ANON_KEY` (created 2026-09-22)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (created 2026-09-22)

The `github-pages` **environment** has no secrets. The build job does not set `environment:`, so it uses the repository secrets. GitHub’s `pages.yml` references:

- `secrets.VITE_SUPABASE_URL`
- `secrets.VITE_SUPABASE_ANON_KEY`
- `secrets.VITE_SUPABASE_PUBLISHABLE_KEY`

The copy of `.github/workflows/pages.yml` **in this Cursor workspace** does not use those secret references. It contains literal values for the same three variables. Do not copy that file onto GitHub. GitHub secret scanning and push protection are enabled on the repo.

`VITE_OPENAI_API_KEY` is read by the carousel UI if present (`artifacts/gtm-studio/src/carousel/lib/hooks/use-keys.tsx`). It is not in `.env.example`, not in the Pages workflow, and not in the repository secret list. Carousel AI is optional without it.

## 2. Supabase

Project name: **DGK GTM Personalisation**

- Ref / id: `hvvtmhlxdmeyozyirpqo`
- Region: `ap-southeast-2`
- Status checked 2026-10-09: `ACTIVE_HEALTHY`
- Postgres 17
- API host shape: `https://hvvtmhlxdmeyozyirpqo.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/hvvtmhlxdmeyozyirpqo

### Tables the app uses

All of these are in `public`, with RLS enabled. Counts are `count(*)` on 2026-10-09, not the table-list estimate.

| Table | Rows | What it is |
| --- | --- | --- |
| `outbound_campaigns` | 17 | Saved studio jobs. `mode` check includes `handwritten`, `memes`, `gif`, `avatar`, `handgif`. `folder_id` nullable, FK to `outbound_folders` `ON DELETE SET NULL`. |
| `outbound_templates` | 16 | Saved studio looks. Same mode check. `metadata.config` holds the studio config. `folder_id` same as campaigns. |
| `outbound_assets` | 119 | Stored files. `folder_id` same. `campaign_id` FK `ON DELETE SET NULL`. |
| `outbound_folders` | 2 | One folder list for templates, files, and campaigns. Name length 1–80. Unique per user on lowercased trimmed name. |
| `outbound_copy_templates` | 2 | Per-studio message templates. `studio` is `handwritten`, `avatar`, `memes`, `gif`, `handgif`, or `carousel`. |

`auth.users`: 1 row. This handoff does not list that email.

### Storage

One app bucket: `outbound-assets`.

- Public read: yes.
- File size limit live: 15728640 bytes (15 MiB).
- Allowed types live: png, jpeg, webp, gif, svg, ttf, otf, woff, woff2, csv, plain text, ms-excel, xlsx, ods, and `application/octet-stream`.

Storage policies on `storage.objects`:

- `public reads outbound assets` — `SELECT`, role `public`
- `users upload outbound assets` — `INSERT`, role `authenticated`
- `users update outbound assets` — `UPDATE`, role `authenticated`
- `users delete outbound assets` — `DELETE`, role `authenticated`

### RLS policies (names read from the live database)

| Table | Policy | Command | Roles |
| --- | --- | --- | --- |
| `outbound_campaigns` | `campaign owners manage campaigns` | `ALL` | `public` |
| `outbound_templates` | `template owners manage templates` | `ALL` | `public` |
| `outbound_assets` | `asset owners manage assets` | `ALL` | `public` |
| `outbound_copy_templates` | `copy template owners manage rows` | `ALL` | `authenticated` |
| `outbound_folders` | `folder owners manage folders` | `ALL` | `authenticated` |

The three older policies are flagged by Supabase for re-evaluating `auth.uid()` per row. The folder and copy-template policies were written with `(select auth.uid()) = user_id`. Do not rewrite the old policies unless asked. Docs: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

Other advisor results on 2026-10-09:

- Security: leaked-password protection is off. https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Performance info: `outbound_assets.campaign_id`, `outbound_assets.user_id`, `outbound_campaigns.user_id`, and `outbound_templates.user_id` have no covering index.
- The linter also calls these indexes unused: `outbound_assets_folder_id`, `outbound_templates_folder_id`, `outbound_campaigns_folder_id`, `outbound_copy_templates_user_updated`, `outbound_copy_templates_user_studio_updated`. Keep them. Low traffic makes a new index look unused.

### Triggers present

- `outbound_templates_set_updated_at`
- `outbound_copy_templates_set_updated_at`
- `outbound_templates_folder_owner`
- `outbound_campaigns_folder_owner`
- `outbound_assets_folder_owner`

The folder-owner triggers call `library_folder_same_owner()` and reject a `folder_id` that belongs to another user. `folder_id` null is allowed. Deleting a folder sets child `folder_id` to null, so items return to the library root.

### Migrations applied on the server vs files in the repo

Remote history (`list_migrations`), in order:

1. `create_outbound_studio_core`
2. `add_outbound_campaign_source_data`
3. `allow_avatar_campaign_mode`
4. `allow_handwriting_gif_mode`
5. `allow_spreadsheet_uploads`
6. `copy_templates`
7. `copy_templates_rls_initplan`
8. `copy_templates_by_studio`
9. `copy_templates_notes_only`
10. `copy_templates_by_studio_again`
11. `file_folders`
12. `library_folders`

Repo files under `artifacts/gtm-studio/supabase/migrations/`:

- `202609160001_create_outbound_studio.sql`
- `202609170002_allow_avatar_mode.sql`
- `202609210001_templates_realtime.sql`
- `202609240001_copy_templates.sql`
- `202609240003_copy_templates_notes_only.sql`
- `202609240004_copy_templates_by_studio.sql`
- `202609240005_file_folders.sql`
- `202609240006_library_folders.sql`

Applied remotely and **not** represented by a matching file:

- `allow_handwriting_gif_mode` — live `mode` check includes `handgif`. The repo file `202609170002_allow_avatar_mode.sql` stops at `handwritten`, `memes`, `gif`, `avatar`. Replaying that file would drop `handgif`.
- `allow_spreadsheet_uploads` — live bucket allows spreadsheets and is 15 MiB. The repo create script sets 10485760 bytes and image/font types only.
- `copy_templates_rls_initplan`
- `copy_templates_by_studio_again` — live `studio` check includes all six studios. Remote history applied `copy_templates_notes_only` and then restored per-studio. Repo filename order applies notes-only **before** `202609240004`, so a clean replay of the files ends per-studio, but the order is not the same as production.

`202609210001_templates_realtime.sql` is in the repo and is **not** in the remote migration name list. The trigger `outbound_templates_set_updated_at` does exist, so the effect is live. **Unsure** which remote migration applied it.

After DDL, PostgREST has served a stale schema until `notify pgrst, 'reload schema'`. Do that after the next migration or the client selects that mention new columns return empty lists.

### Auth

- The app has a login screen and no register button.
- `README.md` says: Authentication → Providers → Email, turn off “Allow new users to sign up”, invite from Authentication → Users.
- **Unsure:** this session did not re-read the live “Allow new users to sign up” toggle. Only the advisor and the user count were read.
- Operator login email and password are written in clear text in `README.md` under “Run locally”. This document does not repeat the password.
- Users: https://supabase.com/dashboard/project/hvvtmhlxdmeyozyirpqo/auth/users

### Where env vars are set

| Variable | Where |
| --- | --- |
| `VITE_SUPABASE_URL` | GitHub Actions repository secret. Also a literal in the Cursor workspace copy of `pages.yml` (do not publish that copy). `.env.example` has the name and an empty value. Vite reads env from the repo root (`envDir` in `artifacts/gtm-studio/vite.config.ts`). |
| `VITE_SUPABASE_ANON_KEY` | Same three places. The client uses this if `VITE_SUPABASE_PUBLISHABLE_KEY` is empty. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same three places. The client prefers this over the anon key (`artifacts/gtm-studio/src/studio/cloud.ts`). |
| `VITE_OPENAI_API_KEY` | Optional. Not set in Actions, `.env.example`, or the Pages workflow. |
| `PORT` | Process env for Vite. Default `43123`. |
| `BASE_PATH` | Process env for Vite. Local and `vercel.json` use `/`. Pages workflow uses `/cursor1/`. |
| `NODE_ENV`, `REPL_ID` | Only gate optional Replit Vite plugins. |

`.env.local` is gitignored (`*.local`). It was **absent** in this workspace on 2026-10-09. Create it from `.env.example` for local login. Do not commit it.

## 3. Current state

### What works

Checked in the browser on 2026-09-24, and the same library strings are in the Pages bundle on 2026-10-09:

- Desk, Notes, Avatar, Memes, GIFs, Write, and Carousel routes.
- One desk library for templates, created files, and campaigns.
- New folder, and a three-dot menu: Rename, Move, Delete. Open still resumes a template or campaign.
- Open on a png/jpeg/gif/webp/svg shows the image. Open on another file, such as a csv, opens the public Supabase URL.
- Deleting a folder puts its items back at the library root and does not delete those items.
- A later campaign or template save does not clear `folder_id` when that column is omitted from the upsert. This was checked with a throwaway row and then removed.
- Per-studio Name / Copy message templates, with Select and Remove under the table. Studios do not share those rows.
- Delete of a saved look, campaign, or file removes the Supabase row. Storage objects are removed only when no other live template or campaign still references them. Deleting one file always removes that object.
- Notes handwriting styles are Handwriting 1 through 7.
- Moving memes use the copyright-safe sample layouts already in the app.

Row counts above are the operator’s real data. Do not delete them to test.

### Half-finished or broken

- Vercel project `cursor1` exists, and `vercel.json` is ready, but the operator stopped the Vercel upload. Treat Vercel as not the live site until someone confirms a deployment.
- GitHub `main` and this Cursor `main` are not the same commit. Feature work through 2026-09-24 was copied across. Anything committed only on the Cursor remote after that is not on GitHub. Right now the Cursor tip message matches the GitHub tip message, with different SHAs.
- Repo SQL is not a complete replay of production (`handgif` mode, spreadsheet MIME types, 15 MiB limit, and two copy-template migrations).
- The workspace `pages.yml` still has raw key material. GitHub’s file does not.
- `README.md` still contains the operator password.
- Supabase leaked-password protection is off.
- Older RLS policies still call `auth.uid()` per row.
- **Unsure:** whether “Allow new users to sign up” is off in the dashboard right now.

### Local changes not committed

`git status` on this workspace `main` was clean. No extra branches exist in this workspace. `.env.local` is not present.

### Other GitHub branches

| Branch | Tip | What it is |
| --- | --- | --- |
| `main` | `3193470` | Source of the Pages workflow deploy. |
| `gh-pages` | `cad1ef6` (2026-09-22) | Older published tree. Pages `build_type` is `workflow`, and the live JS is newer than this commit. Do not treat `gh-pages` as the source of truth. |
| `v0/fix-deployment-build-errors-5933ec76` | `310c29f` (2026-09-17) | Vercel v0 commit: “feat: update build script to use tsc directly before vite build”. Not merged into the `main` that Pages serves. |

## 4. How to run and verify

Requirements: Node 22 and pnpm 10 (the Pages workflow pins pnpm 10).

```bash
pnpm install
```

Create `.env.local` in the repo root with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. Do not commit it.

```bash
cd artifacts/gtm-studio
PORT=43123 BASE_PATH=/ pnpm run dev
```

Vite binds `0.0.0.0`. Open http://127.0.0.1:43123 . `strictPort` is true, so a busy 43123 fails instead of moving.

Studio typecheck:

```bash
pnpm --filter @workspace/gtm-studio typecheck
```

Root typecheck also builds the workspace libs:

```bash
pnpm run typecheck
```

Production build of the studio:

```bash
BASE_PATH=/ pnpm --filter @workspace/gtm-studio run build
```

Pages uses `BASE_PATH=/cursor1/` instead. Output is `artifacts/gtm-studio/dist/public`. The workflow copies `index.html` to `404.html` and adds `.nojekyll`.

Gotchas:

- Sign in before expecting Supabase data. With no env, the client runs local-only.
- A new column is invisible to the API until `notify pgrst, 'reload schema'`.
- Campaign rename must update `outbound_campaigns.name` and `config.campaignName`. Template rename must update `name` and `metadata.config.campaignName`. The studio shows `config.campaignName`.
- `saveCampaign` and `saveTemplateConfig` must keep omitting `folder_id` on ordinary saves so a save does not clear the folder.
- File rename updates `outbound_assets.filename` only. The storage path and public URL stay.
- Local campaign and template lists are capped (campaigns 30, templates 40 in local storage). Cloud lists are the source of truth when signed in. Template list select is limited to 80. File list select is limited to 400.
- Do not use the workspace `pages.yml` as the GitHub workflow.

## 5. Pending work

No next feature was left in the chat. The last requests were the live link, the login details, and running the app on localhost.

Decisions already made, with the reason:

- GitHub Pages is the public site. The operator asked for a GitHub preview and stopped the Vercel upload because it was taking too long.
- Carousel stays a separate route (`/carousel`). It does not use the prospect CSV generate pipeline, and it does not share data with Notes, Avatar, Memes, GIFs, or Write.
- Message templates are per studio. A template saved in Notes must not appear in Avatar or the others. The Name / Copy table is only the draft being typed. Select and Remove sit under that table.
- Notes shows Handwriting 1 through 7 only. Older handwriting names were removed from that picker on purpose.
- Templates, files, and campaigns are one library, with one `outbound_folders` table. The operator asked to manage the three lists in one place.
- Deleting a folder does not delete the items inside it.
- Deleting a look or a campaign must not delete a storage object that another live look or campaign still uses.
- Opening a generated image from the library shows the file. The operator reported `Wesley_Mission_Neville_48_note.png` and other files did not open when the row had no Open action.
- Generate, download, and the studio form fields stay as they are unless a requested feature has to touch them.
- Do not force-push GitHub `main`.
- Do not replace GitHub `pages.yml` with the workspace file.

## 6. Rules for working on it

- Studio UI lives in `artifacts/gtm-studio/src`. Cloud calls live in `src/studio/cloud.ts`. Desk library UI is `src/components/studio/library.tsx`.
- Use the existing shadcn/ui primitives (Button is often the app’s `.btn` classes; dialogs and menus are the shadcn components).
- New SQL goes in `artifacts/gtm-studio/supabase/migrations/` **and** must be applied to project `hvvtmhlxdmeyozyirpqo`. A file that is only in git does not change production.
- New tables: RLS on, policy uses `(select auth.uid()) = user_id`, grants for `authenticated` only as needed, index every new foreign key.
- `library_folder_same_owner()` is `security invoker` with `search_path = public`. Do not make it `security definer` in `public`.
- Match the current voice in the UI. No placeholder copy.
- Verify UI changes in a browser, including the empty library and a real Open / Move / Rename / Delete on throwaway rows only.

Needs the operator’s approval first:

- Turning public signup on, inviting or deleting auth users, or changing the operator password.
- Deleting or editing the existing 17 campaigns, 16 looks, 119 files, 2 folders, or 2 copy templates.
- Dropping the “unused” indexes or rewriting the old RLS policies.
- Replaying `202609170002_allow_avatar_mode.sql` against production.
- Any Vercel deploy, any change to GitHub `pages.yml`, any force-push, and any write deploy key left on the repo.
- Putting secret values into git, README, or this handoff.
