# Deployment Configuration

Target architecture (unchanged from the assignment):

```
Vercel (Next.js)  --HTTPS/WSS-->  Render (FastAPI + WebSocket)  -->  SQLite on Render Persistent Disk
```

No database migration to Postgres/Supabase/Firebase. SQLite stays; only its
file path becomes environment-driven so Render can point it at a mounted
persistent disk instead of the ephemeral container filesystem.

## Render (backend)

Repo is a monorepo (`backend/`, `frontend/` as subdirectories of the git
root), so `render.yaml` at the repo root uses `rootDir: backend` to scope
the build/start commands and disk mount to the backend service.

- **Build command:** `pip install -r requirements.txt`
- **Start command:** `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - Migrations run once, synchronously, before uvicorn binds — if a
    migration fails, the deploy fails closed rather than serving against a
    stale schema.
- **Persistent Disk:** mounted at `/var/data` (1 GB `starter` plan default;
  resize as needed). This is what makes `messages.db` survive redeploys and
  restarts — without it, Render's container filesystem is ephemeral and the
  database resets on every deploy.

Required Render environment variables:

| Variable | Value | Notes |
|---|---|---|
| `JWT_SECRET` | a strong random secret (e.g. `openssl rand -hex 32`) | Set directly in the Render dashboard; never commit it. `render.yaml` marks this `sync: false` so Render prompts for it instead of expecting a value in git. |
| `ENVIRONMENT` | `production` | Flips cookie `Secure=True` and `SameSite=None` (see below), and is read wherever production-only behavior is gated. |
| `FRONTEND_URL` | `https://<vercel-production-domain>` | Used for both CORS (`app/main.py`) and the WebSocket origin allowlist (`app/routes/ws.py`). Set after the Vercel domain is known; also `sync: false`. |
| `DATABASE_URL` | `sqlite:////var/data/messages.db` | Points SQLite at the persistent disk's mount path. Already set as a plain (non-secret) value in `render.yaml`. |

## Vercel (frontend)

Standard Next.js import, project root = `frontend/`. No `vercel.json`
needed — `next build`/`next start` work unmodified.

`NEXT_PUBLIC_*` variables are inlined at **build time**, not read at
runtime, so they must be set in the Vercel project's environment variable
settings *before* the production build runs (not just before first visit).

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<render-backend-domain>` |
| `NEXT_PUBLIC_WS_URL` | `wss://<render-backend-domain>/ws/messages` |

`frontend/.env.local` (gitignored) remains the local-dev-only values and is
unaffected by this — Vercel's own env var UI is the production source of
truth.

## Cookie cross-site behavior

Vercel and Render are different registrable domains — this is a genuinely
cross-site deployment topology, not same-site. Browsers withhold
`SameSite=Strict` (and `Lax`, for most request types) cookies on cross-site
requests entirely, which would silently break every authenticated REST call
and the WebSocket handshake cookie in production.

- `get_cookie_samesite_flag()` (`app/security.py`) returns `"none"` when
  `ENVIRONMENT=production`, `"strict"` otherwise.
- `SameSite=None` requires `Secure=True`, which `get_cookie_secure_flag()`
  already sets whenever `ENVIRONMENT=production` — so production cookies
  are `Secure=True; SameSite=None`, development cookies are unchanged
  (`Secure=False; SameSite=Strict`, matching local `http://localhost`).

## WebSocket origin validation

`app/routes/ws.py` previously hardcoded
`["http://localhost:3000", "http://127.0.0.1:3000"]` as the only accepted
`Origin` header values, which would reject every WebSocket connection from
the deployed Vercel origin. It now builds `ALLOWED_WS_ORIGINS` from
`FRONTEND_URL` (the same env var CORS uses) plus the two localhost entries,
so local development keeps working unchanged while production accepts the
real frontend origin.

## SQLite path

`app/database.py`'s `DATABASE_URL` now reads `os.getenv("DATABASE_URL", "sqlite:///./messages.db")`
— local dev (no env var set) is byte-for-byte unchanged; Render sets
`DATABASE_URL=sqlite:////var/data/messages.db` pointing at the persistent
disk. `alembic/env.py` already imports `DATABASE_URL` from `app.database`
at runtime, so migrations target the same path automatically — no alembic
config change was needed.

No schema change. No data is copied from the local dev database into
production; the persistent disk starts empty and `alembic upgrade head`
creates the schema on first deploy.
