# GTM Studio

Built by **Sushant**.

Invite-only workspace for personalised handwritten notes, memes, and GIFs.

## Run locally

```bash
npm install
cp .env.example .env
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## Deploy on Vercel

This repo is connected as the **cursor1** Vercel project.

1. Production branch: `main`
2. Framework: Vite
3. Build command: `npm run build`
4. Output: `dist`
5. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

After a successful production deploy the app is at https://cursor1.vercel.app
