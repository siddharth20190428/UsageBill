# Deploying UsageBill

One container serves both the API (under `/api`) and the built React app, so there is one URL and no CORS.
The database is Postgres on [Neon](https://neon.com); the app runs on [Render](https://render.com) (Docker).

## 1. Database (Neon)
1. Create a Neon project (any region near you). Copy the **connection string** (it includes `sslmode=require`).
2. Nothing else: the app creates its tables on startup, including `CREATE EXTENSION btree_gist`.
   (If startup logs say the extension is not allowed, run `CREATE EXTENSION btree_gist;` once in Neon's SQL editor.)

## 2. App (Render)
1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo (it reads `render.yaml`).
3. When asked for `DATABASE_URL`, paste the Neon connection string.
4. Wait for the build (about 3-5 minutes). Open `https://<name>.onrender.com`.

Check: `https://<name>.onrender.com/api/health` returns `{"status":"ok"}`, and `/api/docs` shows the API docs.

## Run the production build locally
```bash
cd frontend && npm run build && cd ..
uvicorn app.web:site --host 0.0.0.0 --port 8000   # UI at /, API at /api
```

## Things to know
- The free web service sleeps after 15 minutes idle; the first request after that takes about a minute.
  Open the URL once before sharing it with anyone.
- **There is no login.** Anyone with the URL can create data. Don't put real data in it, and put a note on the
  resume/README that it is a demo.
- Secrets live only in Render's environment variables.
