# DGK Outbound Studio

Built by **Sushant**.

Invite-only workspace for DGK Business Consultancy (Darwin, NT). Import a prospect spreadsheet, generate a handwritten note, moving meme, or GIF for every row, then download this row or the whole campaign as a ZIP.

This repo started as a clone of [`willi220p-star/dgk-gtm-studio-replit`](https://github.com/willi220p-star/dgk-gtm-studio-replit) and now includes the Outbound Studio dashboard, login gate, realism controls, and live meme motion.

## Run locally

Requirements: Node 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install
```

Copy `.env.example` to `.env.local` and fill the Supabase values:

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

Outbound Studio deploys on **Vercel** (`vercel.json` at the repo root). GitHub Pages remains an optional static host.

Live site: [https://willi220p-star.github.io/cursor1/](https://willi220p-star.github.io/cursor1/) — Avatar cards: [https://willi220p-star.github.io/cursor1/avatar](https://willi220p-star.github.io/cursor1/avatar)

Studio UI (Vite):

```bash
cd artifacts/gtm-studio
PORT=43123 BASE_PATH=/ pnpm run dev
```

Sign in with:

- **Username:** `operator@dgk.internal`
- **Password:** `VioletPulse#2026Dgk`

Invite-only. Add more people in [Supabase Auth users](https://supabase.com/dashboard/project/hvvtmhlxdmeyozyirpqo/auth/users) — Authentication → Users → Invite. Keep public signup off.

There is no public signup — sign in with an invited operator account.

## Authentication (no paid plan required)

The existing free-tier Supabase project is enough for operator login and a handful of authorized users.

1. In Supabase: **Authentication → Providers → Email**.
2. Turn **off** “Allow new users to sign up”.
3. Invite people from **Authentication → Users**.
4. Do not put a register button in this app.

Upgrade later only if you outgrow free auth or storage quotas.

## What the studio does

- Import CSV, XLSX, XLS, ODS, or paste rows from Google Sheets / Excel. Choose handwritten notes, handwriting GIF, avatar cards, moving memes, and/or GIFs — after save, that studio opens. Spreadsheet headers are matched automatically. Each imported file is stored as its own object in Supabase.
- Generate writes file names and public links back onto every row (`handwritten_file` / `handwritten_url`, `handwriting_gif_file` / `handwriting_gif_url`, `avatar_card_file` / `avatar_card_url`, `meme_file` / `meme_url`, or `gif_file` / `gif_url`). Download list CSV or ZIP includes those columns.
- Avatar cards: choose **None** (still PNG) or **Auto writing** (the portrait stays, the letter types like Canva, download is a GIF). Optional glow or highlight.
- Handwritten notes stay a still A4 page. Handwriting GIF is the only studio with a writing hand — pick fineliner, white click, fountain, or tripod grip, then Slow / Medium / Fast. Avatar never shows a pen.
- **Carousel generator** is a separate last studio (`/carousel`). It is the full [FranciscoMoretti carousel-generator](https://github.com/FranciscoMoretti/carousel-generator) program — slides, brand, theme, fonts, File import/export, PDF download, optional OpenAI key (gear icon). It is not mixed into handwritten, avatar, memes, GIF, or handwriting GIF, and it does not use the prospect CSV generate pipeline.
- Meme and GIF text boxes have Canva-like style: highlight words, typing / glow / highlight / pop on each layer.
- Optional drawn signature (one-click pad) plus a signature file upload.
- Notes writing styles are Handwriting 1 through 7, matched to the pen samples. The older handwriting list is not shown in Notes.
- Notes Copy can save a named message template (name and copy) and pick it later. Those templates are stored in Supabase for the signed-in operator.
- Crop (zoom + pan) on notes, memes, GIFs, and avatars. Drag the note and avatar frames to size them.
- Handwritten notes on A4: notebook, white paper, or diary; paper colours (white, cream, watercolour, custom); real desk woods (pine, oak, walnut, maple, mahogany, or a custom colour / photo); finishes (desk, flat lay, scanned, clean)
- Paper background: put linen, kraft, grid, or your own photo on the sheet, then remove it
- Paper photos, desk backgrounds, signatures, and live GIFs upload to the same Supabase bucket. Remove deletes the file there too.
- Remove any uploaded paper, desk, signature, or meme background image
- Moving memes and GIFs use original copyright-safe photographs in the familiar layouts from [50 Copyright-Safe Meme Templates](https://shlomo-genchin.notion.site/50-Copyright-Safe-Meme-Templates-66a71bb3274a42bda72859dfa2be8a5f) — two buttons, looking away, table sign, expanding boxes, trade offer, and more — plus Add live GIF from your computer
- Download this row, or download all rows as a ZIP with `prospects.csv` and an Airtable-ready manifest
- Campaigns save locally and sync to Supabase when you are signed in

## Layout

The operator UI is a desk, not a three-column dashboard. A slim 88px icon rail, a giant preview on paper or in a cutting-room lightbox, a contact filmstrip, and a Copy / Look / Ship inspector.

| Path | Purpose |
| --- | --- |
| `artifacts/gtm-studio` | Operator UI |
| `artifacts/api-server` | Express API |
| `artifacts/mockup-sandbox` | Mockup preview sandbox |
| `lib/` | Shared API client, Zod schemas, Drizzle DB |
| `scripts/` | Workspace scripts |

## Maintainer

Sushant
