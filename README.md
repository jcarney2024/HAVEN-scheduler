# HAVEN SU 26 Clinic Schedule Portal

A directors-only portal for assigning volunteers and co-directors to clinic Saturdays.

## Development

```
npm install
npm run dev
```

## Tests

```
npm test
```

## Deployment

Frontend builds with `npm run build` (Vite). The Supabase Edge Function lives under `supabase/functions/clinic-schedule-server/` and deploys via the Supabase CLI.
