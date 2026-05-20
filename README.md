# HAVEN SU 26 Clinic Schedule Portal

A directors-only portal for assigning volunteers and co-directors to clinic Saturdays.

## Development

```
npm install
cp .env.example .env.local        # then fill in AIRTABLE_PAT
npm run dev                       # vite + tsx dev-server in one process
```

`npm run dev` starts Vite on `http://localhost:5173` and the Hono API on `http://localhost:3001`. Vite proxies `/api/*` to the API server, so the frontend behaves the same as it will on Vercel.

`.env.local` is gitignored. The only secret is `AIRTABLE_PAT`; the rest of the env vars are base/table IDs and are checked into `.env.example`.

## Tests

```
npm test
```

## Deployment

Push to a GitHub repo, connect Vercel to it, and set the env vars from `.env.example` (plus the real `AIRTABLE_PAT`) in Vercel project settings. Vercel auto-detects the Vite frontend and the `api/[[...route]].ts` Serverless Function.
