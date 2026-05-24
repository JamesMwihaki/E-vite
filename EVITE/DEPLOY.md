# Deploying E-vite (Vercel + Supabase)

The app runs as a single Vercel project: static frontend + an Express app
wrapped as a serverless function. The database lives in Supabase (Postgres).

## 1. Create the Supabase database

1. Sign in at https://supabase.com and create a new project. Pick a region close to your Vercel region.
2. Wait for it to provision (~2 minutes). Save the database password — you'll need it.
3. Go to **Project Settings → Database → Connection string** and pick **Transaction pooler** (the URL ends with `pooler.supabase.com:6543`). That's the URL Vercel functions should use.
   - Direct connection (port 5432) is fine for local dev but exhausts connection limits on serverless. Always use the pooler URL in production.
4. Copy the URL — it looks like
   `postgres://postgres.abc123:YOUR_PASSWORD@aws-0-us-west-1.pooler.supabase.com:6543/postgres`

No need to manually run any SQL — the app creates its tables on first startup via `backend/migrations/create_tables.sql`.

## 2. Run locally first (optional but recommended)

```bash
cd EVITE
cp .env.example .env
# Edit .env and paste your DATABASE_URL + a SESSION_SECRET
npm install
npm start
```

Generate a session secret with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

In a second terminal serve the frontend:
```bash
cd EVITE/frontend
python3 -m http.server 5500
```

Then `open http://localhost:5500/pages/landing-page.html`.

> Note: in local dev the frontend lives on `:5500` and the API on `:3001`, so the relative URLs in the frontend JS resolve to `:5500/api/*` which won't reach the backend. For full local parity with production, use **`vercel dev`** instead (see step 4) — that serves both on the same port.

## 3. Push to GitHub

```bash
cd "/Users/jameskarui/Desktop/Evite Drafts/E-vite"
git add .
git commit -m "Set up for Vercel + Supabase deployment"
git push
```

## 4. Deploy to Vercel

Easiest path — install the Vercel CLI, link the project, deploy:

```bash
npm install -g vercel
cd EVITE
vercel login
vercel link              # answer prompts, point at this directory
vercel env add DATABASE_URL    # paste Supabase pooler URL when prompted (apply to Production + Preview + Development)
vercel env add SESSION_SECRET  # paste a random 48-byte hex string
vercel env add GEMINI_API_KEY  # optional, only if you want the AI route
vercel --prod            # build + deploy to production
```

Or via the dashboard:

1. https://vercel.com → New Project → import your GitHub repo.
2. **Root Directory** = `EVITE` (since the repo's `vercel.json`, `api/`, and `frontend/` all live inside `EVITE/`).
3. Framework Preset = **Other** (no build step needed).
4. Add environment variables (DATABASE_URL, SESSION_SECRET, optionally GEMINI_API_KEY) for Production, Preview, and Development.
5. Click **Deploy**.

After the build finishes:

- `https://your-app.vercel.app/` → landing page
- `https://your-app.vercel.app/api/health` → `{"ok":true}` sanity check
- `https://your-app.vercel.app/signup` → make your first account; it'll be the first real row in Supabase's `users` table.

## 5. Verify the database

In the Supabase dashboard:
- **Table Editor** → you should see `users`, `events`, `rsvps`, `invitations`, `friendships`, `messages`, `session`.
- The `session` table is created automatically by `connect-pg-simple` and stores logged-in sessions across function invocations.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| "Not authenticated" right after login | `SESSION_SECRET` missing or session cookie not coming back. Check cookies in DevTools, ensure HTTPS in production. |
| `relation "users" does not exist` | First request before migrations ran. Hit `/api/health` once to warm up; subsequent requests should work. |
| Connections timing out | Using the direct DB URL (port 5432) instead of the **transaction pooler** (port 6543). Swap to the pooler. |
| Frontend loads, API returns 500 | Look at Vercel function logs (Dashboard → Deployments → click latest → Functions). Most likely `DATABASE_URL` is missing or wrong. |
| `SESSION_SECRET is using the dev fallback` warning | Set the env var. |

## Local-dev shortcut

To run the entire app (frontend + serverless function) on one port locally, exactly like production:

```bash
cd EVITE
vercel dev
```

Then everything is at `http://localhost:3000/` — no separate frontend server needed.
