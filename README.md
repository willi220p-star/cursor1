# DGK GTM Personalisation

Built by **Sushant**.

Internal operator tool for DGK Business Consultancy in Darwin, Australia. The team uploads a prospect spreadsheet and generates one personalised image per row — a handwritten note or a meme — then hosts the files on Supabase Storage and writes permanent URLs back to Airtable for Clay and Smartlead.

This is not a public product. There is no signup. Accounts are created in the Supabase dashboard.

## What is in this repo

| Route | Purpose |
| --- | --- |
| `/login` | Email and password via Supabase Auth |
| `/` | Dashboard: campaigns, presets, storage, links into both generators |
| `/handwritten` | Personalised handwritten note images |
| `/memes` | Personalised meme images, static and animated |

The handwritten generator includes six paper-and-pen templates, custom letterhead upload, a draggable Fabric.js canvas, postscript and signature zones, and LinkedIn (1080×1080) versus email (1200×628) variants. Spreadsheet import and the merge-tag engine are live on both generator pages. Meme canvas, bulk export, and the Airtable chain land in the following phases.

## Run locally

Requirements: Node 22+.

```bash
cp .env.example .env.local
```

Fill in:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then:

```bash
npm install
npm run dev
```

The app listens on [http://127.0.0.1:43123](http://127.0.0.1:43123). Unauthenticated visits to any route except `/login` redirect to sign-in.

```bash
npm run build
npm run preview
```

## Environment

Never commit credentials. `.env.local` is gitignored. Production (Vercel) needs the same two `VITE_` variables.

Airtable personal access tokens are entered in the operator session later and are not stored in source.

## Brand

Interface type is Inter (400–700). Headings 32px and above use negative letter-spacing. Primary actions are Violet Pulse pills (`border-radius: 1584px`). Cards use a 12px radius, Sand Border, and a 1px shadow.

## Stack

Vite, React, TypeScript, React Router, Tailwind CSS, Supabase Auth. Canvas, spreadsheet parsing, and GIF encoding are added in later phases and lazy-loaded.

## Maintainer

Sushant
