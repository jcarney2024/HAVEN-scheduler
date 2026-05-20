# SU 26 Clinic Schedule Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a director-facing web portal that joins SU 26 volunteer + director availability (from two separate Airtable application bases) with the HAVEN Management roster, and writes back per-Saturday assignments to a new `SU 26 Schedule` table.

**Architecture:** Mirrors the existing Member Information Update Form portal (extracted under `reference-portal/`). React + Vite + Tailwind v4 + shadcn/ui frontend; a single Supabase Edge Function (Deno + Hono) that holds the Airtable PAT and proxies all reads/writes. Frontend never sees Airtable directly.

**Tech Stack:** React 18, Vite 6, TypeScript, Tailwind v4 (`@tailwindcss/vite`), shadcn/ui (Radix-based), Sonner, motion (Framer Motion), Hono on Supabase Edge Functions (Deno), Airtable REST API. Vitest for the few pure-function unit tests.

**Source of truth for design choices:** `docs/superpowers/specs/2026-05-20-clinic-schedule-portal-design.md`. If anything below contradicts the spec, the spec wins — flag it and ask before deviating.

**Conscious deviation from the spec:** the spec lists `/director/:netid` and `/schedule/:dept` as `GET` with a JSON body. Bodies on GET are not portable across `fetch` implementations, so this plan implements both as `POST` (the reference portal does the same). All other API shapes match the spec.

---

## Working assumptions

- The new portal lives in `clinic-schedule-portal/` at the repo root, alongside `reference-portal/`. The reference portal stays untouched and acts purely as documentation.
- The engineer has access to a Supabase project for hosting the Edge Function and a single Supabase KV table for config. Either reuse the existing Supabase project the reference portal uses, or stand up a new one — either works; the plan calls out which env vars need to be set.
- The engineer has been given an Airtable Personal Access Token (PAT) with these scopes:
  - `data.records:read` on all three bases (HAVEN Management, Director Recruitment, Volunteer Recruitment)
  - `data.records:write` on HAVEN Management only
  - `schema.bases:read` on all three (for the setup wizard)
- All commands assume the working directory is the repo root (`/Users/jcarney/Documents/Code-Projects/HAVENINFO/`) unless a step says otherwise.

If any of these assumptions fail, pause and confirm with the user before proceeding.

---

## File structure

Everything new lives under `clinic-schedule-portal/`:

```
clinic-schedule-portal/
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── index.html
├── .gitignore
├── src/
│   ├── main.tsx
│   ├── lib/utils.ts                          # cn() helper for shadcn
│   ├── styles/{tailwind,index,fonts,theme}.css
│   ├── api/
│   │   ├── client.ts                         # typed fetch wrapper to Edge Function
│   │   └── types.ts                          # shared TS types matching API contract
│   ├── app/
│   │   ├── App.tsx                           # step machine + shell
│   │   ├── constants.ts                      # BG_IMAGE, LOGO_URL, brand color
│   │   └── components/
│   │       ├── SetupWizard.tsx
│   │       ├── DirectorLookup.tsx
│   │       ├── ScheduleBuilder.tsx           # composes the schedule UI
│   │       ├── SubmittedView.tsx
│   │       ├── schedule/
│   │       │   ├── DepartmentSwitcher.tsx
│   │       │   ├── StatsBar.tsx
│   │       │   ├── ViewToggle.tsx
│   │       │   ├── SaturdayView.tsx
│   │       │   ├── GridView.tsx
│   │       │   ├── PersonRow.tsx             # shared between views
│   │       │   ├── ConflictBadge.tsx
│   │       │   └── SubmitModal.tsx
│   │       └── ui/                           # shadcn primitives (vendored)
│   └── tests/
│       └── (vitest specs — mirrors src/)
├── supabase/
│   └── functions/clinic-schedule-server/
│       ├── index.ts                          # Hono routes
│       ├── airtable.ts                       # PAT-authed fetch helpers
│       ├── dates.ts                          # canonical 18-date list + normalizers
│       ├── conflicts.ts                      # cross-dept conflict computation
│       ├── kv_store.ts                       # KV interface (copied from reference)
│       └── tests/
│           ├── dates.test.ts
│           └── conflicts.test.ts
└── utils/supabase/info.tsx                   # projectId + publicAnonKey (autogen)
```

---

## Testing strategy

The reference portal ships **zero** automated tests. We add lightweight ones only where they pull their weight:

- **Vitest unit tests** for pure functions: date normalization, conflict computation. These have non-obvious behavior; bugs would silently corrupt data.
- **No unit tests for React components.** Visual changes are verified via the dev server. The plan includes explicit manual-verification checklists.
- **No automated integration tests against Airtable.** A documented end-to-end smoke protocol (Task 22) walks through every endpoint with the real Edge Function once deployed.

This is pragmatic for a one-off scheduling portal — adding Playwright/MSW infrastructure would cost more than it returns.

---

## Phase 0 — Prerequisites (manual + Airtable schema)

### Task 1: Provision Airtable schema and capture configuration

**Files:** None (this is manual / Airtable UI work).

The portal cannot be wired up until two schema changes exist in HAVEN Management (`appkxTQ19GmaHgW1O`):

- [ ] **Step 1: Add submission tracking fields to the `SU 26` roster table**

In Airtable, open `appkxTQ19GmaHgW1O` → `SU 26` table (`tbl2VrP1uqwFt7QNQ`). Add three fields exactly as named:

1. `Schedule Status` — Single select. Options: `Draft` (default), `Submitted`. Default value: `Draft`.
2. `Submitted At` — Date with time enabled (ISO format).
3. `Submitted By` — Link to another record → choose `All People` table. Allow linking to multiple records: **off**.

Backfill every existing row's `Schedule Status` to `Draft` (use Airtable's bulk edit / fill-down).

- [ ] **Step 2: Create the `SU 26 Schedule` table**

In the same base, add a new table named `SU 26 Schedule` with these fields in order. The first field becomes the primary key automatically.

| Field | Type | Configuration |
|---|---|---|
| `Name` | Single line text | Written explicitly by the server as `"{Department Name} — {Date}"` on each upsert. Airtable's API doesn't allow formula primary fields on create, so we drive it server-side instead. |
| `Department` | Link to another record | Target: `SU 26`. Allow linking to multiple: off. |
| `Date` | Single select | Options (in this order): `May 30th`, `June 6th`, `June 13th`, `June 20th`, `June 27th`, `July 4th`, `July 11th`, `July 18th`, `July 25th`, `August 1st`, `August 8th`, `August 15th`, `August 22nd`, `August 29th`, `September 5th`, `September 12th`, `September 19th`, `September 26th`. |
| `Directors on Shift` | Link to another record | Target: `All People`. Allow multiple: **on**. |
| `Volunteers on Shift` | Link to another record | Target: `All People`. Allow multiple: **on**. |
| `Last Modified` | Last modified time | All editable fields. |
| `Last Modified By` | Last modified by | All editable fields. |

After saving, hover the table's tab → Copy URL → extract the `tblXXXXXXXXXXXXXXXX` ID. Write it down; it's needed in Task 5 (setup wizard preset).

- [ ] **Step 3: Verify the reverse-link wires up**

Open any `All People` record. The fields `SU 26 (Director)` and `SU 26 (Volunteer)` should now show "links to: SU 26 Schedule → Directors on Shift / Volunteers on Shift". If they're still empty linked-record fields with no target, edit their settings to point at the new `SU 26 Schedule` table.

- [ ] **Step 4: Collect environment values for the Edge Function**

Write these down (will paste into Supabase secrets in Task 4):

| Var | Where to find it |
|---|---|
| `AIRTABLE_PAT` | Airtable → developer hub → personal access tokens. Must have scopes listed in the assumptions. |
| `SUPABASE_URL` | Auto-injected by Supabase Edge runtime. |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase Edge runtime. |

Also note:
- HAVEN Management base ID: `appkxTQ19GmaHgW1O`
- Director Recruitment base ID: `app6MHzSA1yPej2zX`
- Volunteer Recruitment base ID: `appOq1yOiA1Lfzq8L`
- Director Recruitment Applications table ID: `tbluFoybFPBjBAXyk`
- Volunteer Recruitment Applicants table ID: `tblV3UrQQvIIZzFTU`
- HAVEN All People table ID: `tblnHgBpknuqWvx9c`
- HAVEN SU 26 roster table ID: `tbl2VrP1uqwFt7QNQ`
- HAVEN SU 26 Schedule table ID: *(captured in Step 2)*

- [ ] **Step 5: Commit (no code yet — just a marker)**

```bash
git commit --allow-empty -m "chore: Airtable schema ready for clinic schedule portal

- SU 26 Schedule table created
- SU 26 roster gained Schedule Status / Submitted At / Submitted By fields"
```

---

## Phase 1 — Repo scaffolding

### Task 2: Scaffold the portal directory and dependencies

**Files:**
- Create: `clinic-schedule-portal/package.json`
- Create: `clinic-schedule-portal/.gitignore`
- Create: `clinic-schedule-portal/tsconfig.json`
- Create: `clinic-schedule-portal/vite.config.ts`
- Create: `clinic-schedule-portal/postcss.config.mjs`
- Create: `clinic-schedule-portal/index.html`
- Create: `clinic-schedule-portal/README.md`

- [ ] **Step 1: Create the directory and `package.json`**

```bash
mkdir -p clinic-schedule-portal/src/{app/components/{schedule,ui},api,lib,styles,tests}
mkdir -p clinic-schedule-portal/supabase/functions/clinic-schedule-server/tests
mkdir -p clinic-schedule-portal/utils/supabase
```

Write `clinic-schedule-portal/package.json`:

```json
{
  "name": "clinic-schedule-portal",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@radix-ui/react-checkbox": "1.1.4",
    "@radix-ui/react-dialog": "1.1.6",
    "@radix-ui/react-label": "2.1.2",
    "@radix-ui/react-popover": "1.1.6",
    "@radix-ui/react-select": "2.1.6",
    "@radix-ui/react-separator": "1.1.2",
    "@radix-ui/react-slot": "1.1.2",
    "@radix-ui/react-tabs": "1.1.3",
    "@radix-ui/react-tooltip": "1.1.8",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "lucide-react": "0.487.0",
    "motion": "12.23.24",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "sonner": "2.0.3",
    "tailwind-merge": "3.2.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.1.12",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "4.7.0",
    "jsdom": "25.0.1",
    "tailwindcss": "4.1.12",
    "typescript": "5.6.3",
    "vite": "6.3.5",
    "vitest": "2.1.4"
  }
}
```

- [ ] **Step 2: Write the supporting config files**

`clinic-schedule-portal/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src", "utils"]
}
```

`clinic-schedule-portal/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

`clinic-schedule-portal/postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`clinic-schedule-portal/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HAVEN Clinic Schedule</title>
    <style>
      html, body { height: 100%; margin: 0; }
      #root { height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`clinic-schedule-portal/.gitignore`:

```
node_modules/
dist/
.env
.env.local
.DS_Store
```

`clinic-schedule-portal/README.md`:

```markdown
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
```

- [ ] **Step 3: Install dependencies**

```bash
cd clinic-schedule-portal && npm install
```

Expected: `npm` resolves all deps, creates `node_modules/`, prints "added N packages" with no errors. Warnings about peer deps are fine.

- [ ] **Step 4: Commit**

```bash
git add clinic-schedule-portal/package.json clinic-schedule-portal/.gitignore clinic-schedule-portal/tsconfig.json clinic-schedule-portal/vite.config.ts clinic-schedule-portal/postcss.config.mjs clinic-schedule-portal/index.html clinic-schedule-portal/README.md
git commit -m "chore(portal): scaffold project, install deps"
```

---

### Task 3: Set up styles + utilities + a "Hello HAVEN" render

**Files:**
- Create: `clinic-schedule-portal/src/main.tsx`
- Create: `clinic-schedule-portal/src/lib/utils.ts`
- Create: `clinic-schedule-portal/src/styles/index.css`
- Create: `clinic-schedule-portal/src/styles/tailwind.css`
- Create: `clinic-schedule-portal/src/styles/fonts.css`
- Create: `clinic-schedule-portal/src/styles/theme.css`
- Create: `clinic-schedule-portal/src/app/App.tsx`
- Create: `clinic-schedule-portal/src/app/constants.ts`

- [ ] **Step 1: Copy the reference portal's styles verbatim**

```bash
cp reference-portal/src/styles/tailwind.css clinic-schedule-portal/src/styles/tailwind.css
cp reference-portal/src/styles/fonts.css clinic-schedule-portal/src/styles/fonts.css
cp reference-portal/src/styles/theme.css clinic-schedule-portal/src/styles/theme.css
```

Write `clinic-schedule-portal/src/styles/index.css`:

```css
@import "./tailwind.css";
@import "./theme.css";
@import "./fonts.css";
```

- [ ] **Step 2: Write the shadcn `cn()` helper**

`clinic-schedule-portal/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Write constants and the root entry**

`clinic-schedule-portal/src/app/constants.ts`:

```ts
export const BG_IMAGE =
  "https://images.squarespace-cdn.com/content/v1/6079e7ffe4027e04eed212ed/5a82eeb6-5735-494a-bc45-fa3724a16c42/bbb9f2ea-db33-41be-9ab2-9786d57f7470.jpeg";
export const LOGO_URL =
  "https://images.squarespace-cdn.com/content/v1/6079e7ffe4027e04eed212ed/58209b9d-8c63-4f83-b99c-2c0d1e9dadc1/HAVEN-Logo-white-01-01.png";
export const HAVEN_BLUE = "#0F4D92";
export const HAVEN_BLUE_DARK = "#0B3D75";
```

`clinic-schedule-portal/src/app/App.tsx`:

```tsx
import { LOGO_URL, BG_IMAGE } from "./constants";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden font-sans text-slate-900">
      <div className="absolute inset-0 z-0">
        <img src={BG_IMAGE} alt="" className="w-full h-full object-cover blur-md scale-105" />
        <div className="absolute inset-0 bg-[#0F4D92]/80" />
      </div>
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-6 flex items-center text-white border-b border-white/10">
          <img src={LOGO_URL} alt="HAVEN Free Clinic" className="h-12 w-auto" />
          <div className="h-8 w-px bg-white/20 mx-4" />
          <p className="text-sm font-medium text-blue-100 tracking-wide uppercase">
            Clinic Schedule
          </p>
        </header>
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-xl p-8 shadow-lg max-w-md w-full text-center">
            <h1 className="text-2xl font-bold text-slate-900">Hello HAVEN</h1>
            <p className="text-slate-500 mt-2">Scaffold render — replaced in next tasks.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
```

`clinic-schedule-portal/src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 4: Run the dev server and verify**

```bash
cd clinic-schedule-portal && npm run dev
```

Expected: Vite prints `Local: http://localhost:5173`. Open it in a browser → see the HAVEN blue background, white logo top-left, and the "Hello HAVEN" card. Kill the server (`Ctrl+C`) before continuing.

- [ ] **Step 5: Commit**

```bash
git add clinic-schedule-portal/src clinic-schedule-portal/index.html
git commit -m "feat(portal): render branded shell"
```

---

### Task 4: Vendor the shadcn/ui primitives the portal will use

**Files:**
- Create: `clinic-schedule-portal/src/app/components/ui/button.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/card.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/checkbox.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/dialog.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/label.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/popover.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/select.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/separator.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/sonner.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/tabs.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/tooltip.tsx`
- Create: `clinic-schedule-portal/src/app/components/ui/utils.ts`

- [ ] **Step 1: Copy from the reference portal**

```bash
for f in button card checkbox dialog label popover select separator sonner tabs tooltip utils; do
  cp "reference-portal/src/app/components/ui/${f}.tsx" "clinic-schedule-portal/src/app/components/ui/${f}.tsx" 2>/dev/null || \
  cp "reference-portal/src/app/components/ui/${f}.ts" "clinic-schedule-portal/src/app/components/ui/${f}.ts"
done
```

(The script silently falls back to `.ts` for `utils`.)

- [ ] **Step 2: Verify imports resolve**

Run `npx tsc --noEmit` inside `clinic-schedule-portal/`. Expected: no errors. If TypeScript complains about a missing module like `@radix-ui/react-toast`, drop the matching file or install the dep — but with the package list from Task 2, all listed components should resolve.

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/src/app/components/ui
git commit -m "feat(portal): vendor shadcn primitives we'll use"
```

---

## Phase 2 — Edge Function backend

### Task 5: Edge Function scaffolding and `/config` endpoints

**Files:**
- Create: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts`
- Create: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/kv_store.ts`
- Create: `clinic-schedule-portal/utils/supabase/info.tsx`

- [ ] **Step 1: Copy the KV store from the reference portal verbatim, then rename the table**

```bash
cp reference-portal/supabase/functions/server/kv_store.tsx \
   clinic-schedule-portal/supabase/functions/clinic-schedule-server/kv_store.ts
```

Open the copied file. Replace every occurrence of `kv_store_606c5969` with `kv_store_clinic_schedule`. The engineer must create this table in the Supabase project (SQL: `CREATE TABLE kv_store_clinic_schedule (key TEXT PRIMARY KEY, value JSONB NOT NULL);`). If reusing the existing `kv_store_606c5969` table from the Member Update Form portal is preferred to avoid creating a new table, keep the original name — both work, the key namespace below (`clinic_schedule_config_v1`) keeps the data separate.

- [ ] **Step 2: Write `index.ts` with `/config` routes only**

`clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts`:

```ts
import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.ts";

type Config = {
  haveNManagementBaseId: string;
  allPeopleTableId: string;
  su26RosterTableId: string;
  su26ScheduleTableId: string;
  directorAppsBaseId: string;
  directorAppsTableId: string;
  volunteerAppsBaseId: string;
  volunteerAppsTableId: string;
};

const KV_KEY = "clinic_schedule_config_v1";
const ROUTE_PREFIX = "/make-server-clinic-schedule";

const AIRTABLE_PAT = Deno.env.get("AIRTABLE_PAT") ?? "";

const app = new Hono();
app.use("*", cors());
app.use("*", logger());

async function getConfig(): Promise<Config | null> {
  const data = await kv.get(KV_KEY);
  return data ? (data as Config) : null;
}

app.get(`${ROUTE_PREFIX}/config`, async (c) => {
  const config = await getConfig();
  return c.json({ configured: !!config, config });
});

app.post(`${ROUTE_PREFIX}/config`, async (c) => {
  const body = (await c.req.json()) as Partial<Config>;
  const required: (keyof Config)[] = [
    "haveNManagementBaseId",
    "allPeopleTableId",
    "su26RosterTableId",
    "su26ScheduleTableId",
    "directorAppsBaseId",
    "directorAppsTableId",
    "volunteerAppsBaseId",
    "volunteerAppsTableId",
  ];
  for (const key of required) {
    if (!body[key]) return c.json({ error: `Missing ${key}` }, 400);
  }
  await kv.set(KV_KEY, body);
  return c.json({ success: true });
});

app.get(`${ROUTE_PREFIX}/bases`, async (c) => {
  const res = await fetch("https://api.airtable.com/v0/meta/bases", {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });
  return c.json(await res.json(), res.status as 200 | 400 | 401);
});

app.post(`${ROUTE_PREFIX}/tables`, async (c) => {
  const { baseId } = (await c.req.json()) as { baseId?: string };
  if (!baseId) return c.json({ error: "Missing baseId" }, 400);
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } },
  );
  return c.json(await res.json(), res.status as 200 | 400 | 401);
});

Deno.serve(app.fetch);
```

- [ ] **Step 3: Generate `utils/supabase/info.tsx`**

The engineer must paste their Supabase project's anon credentials here. Template:

```tsx
/* AUTOGENERATED — fill in from your Supabase project's API page. */
export const projectId = "REPLACE_WITH_PROJECT_REF";
export const publicAnonKey = "REPLACE_WITH_PUBLIC_ANON_KEY";
```

- [ ] **Step 4: Deploy the function**

```bash
cd clinic-schedule-portal
supabase functions deploy clinic-schedule-server --project-ref $YOUR_PROJECT_REF
supabase secrets set AIRTABLE_PAT=$YOUR_PAT --project-ref $YOUR_PROJECT_REF
```

Expected: `Deployed Function clinic-schedule-server`. Hit `GET https://<project-ref>.supabase.co/functions/v1/make-server-clinic-schedule/config` with the Bearer anon key — expect `{"configured": false, "config": null}`.

- [ ] **Step 5: Commit**

```bash
git add clinic-schedule-portal/supabase clinic-schedule-portal/utils
git commit -m "feat(server): scaffold edge function with config endpoints"
```

---

### Task 6: `dates.ts` module + tests

**Files:**
- Create: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/dates.ts`
- Create: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/tests/dates.test.ts`
- Create: `clinic-schedule-portal/vitest.config.ts`

The Volunteer Recruitment base uses options like `"June 6th"`. The Director Recruitment base uses `"June 6"`. The portal speaks ISO dates internally; this module normalizes.

- [ ] **Step 1: Write the test file (failing)**

`clinic-schedule-portal/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: [
      "src/tests/**/*.test.{ts,tsx}",
      "supabase/functions/**/tests/**/*.test.{ts,tsx}",
    ],
  },
});
```

`clinic-schedule-portal/supabase/functions/clinic-schedule-server/tests/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CANONICAL_DATES,
  normalizeVolunteerDate,
  normalizeDirectorDate,
  displayDate,
} from "../dates";

describe("CANONICAL_DATES", () => {
  it("has 18 entries spanning May 30 → September 26", () => {
    expect(CANONICAL_DATES.length).toBe(18);
    expect(CANONICAL_DATES[0]).toBe("2026-05-30");
    expect(CANONICAL_DATES[17]).toBe("2026-09-26");
  });

  it("is sorted ascending", () => {
    const sorted = [...CANONICAL_DATES].sort();
    expect(CANONICAL_DATES).toEqual(sorted);
  });
});

describe("normalizeVolunteerDate", () => {
  it("maps 'June 6th' to ISO", () => {
    expect(normalizeVolunteerDate("June 6th")).toBe("2026-06-06");
  });
  it("maps 'May 30th' to ISO", () => {
    expect(normalizeVolunteerDate("May 30th")).toBe("2026-05-30");
  });
  it("maps 'September 26th' to ISO", () => {
    expect(normalizeVolunteerDate("September 26th")).toBe("2026-09-26");
  });
  it("returns null for unknown input", () => {
    expect(normalizeVolunteerDate("Easter")).toBeNull();
  });
});

describe("normalizeDirectorDate", () => {
  it("maps 'June 6' to ISO", () => {
    expect(normalizeDirectorDate("June 6")).toBe("2026-06-06");
  });
  it("maps 'May 30th' to ISO too (accepts either suffix style)", () => {
    expect(normalizeDirectorDate("May 30th")).toBe("2026-05-30");
  });
  it("returns null for unknown input", () => {
    expect(normalizeDirectorDate("Halloween")).toBeNull();
  });
});

describe("displayDate", () => {
  it("formats ISO to 'May 30th'", () => {
    expect(displayDate("2026-05-30")).toBe("May 30th");
  });
  it("formats ISO to 'June 6th'", () => {
    expect(displayDate("2026-06-06")).toBe("June 6th");
  });
  it("formats ISO to 'July 1st'", () => {
    expect(displayDate("2026-07-01")).toBe("July 1st");
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd clinic-schedule-portal && npm test
```

Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement `dates.ts`**

`clinic-schedule-portal/supabase/functions/clinic-schedule-server/dates.ts`:

```ts
export const CANONICAL_DATES = [
  "2026-05-30",
  "2026-06-06",
  "2026-06-13",
  "2026-06-20",
  "2026-06-27",
  "2026-07-04",
  "2026-07-11",
  "2026-07-18",
  "2026-07-25",
  "2026-08-01",
  "2026-08-08",
  "2026-08-15",
  "2026-08-22",
  "2026-08-29",
  "2026-09-05",
  "2026-09-12",
  "2026-09-19",
  "2026-09-26",
] as const;

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function parseFlexibleDateString(input: string): string | null {
  const cleaned = input.trim().toLowerCase().replace(/(st|nd|rd|th)\b/g, "");
  const match = cleaned.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (!match) return null;
  const month = MONTHS[match[1]];
  const day = parseInt(match[2], 10);
  if (month === undefined || Number.isNaN(day)) return null;
  const iso = `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return (CANONICAL_DATES as readonly string[]).includes(iso) ? iso : null;
}

export function normalizeVolunteerDate(input: string): string | null {
  return parseFlexibleDateString(input);
}

export function normalizeDirectorDate(input: string): string | null {
  return parseFlexibleDateString(input);
}

const SUFFIX = (day: number): string => {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function displayDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}${SUFFIX(d)}`;
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
cd clinic-schedule-portal && npm test
```

Expected: all `describe` blocks green, 18 tests pass.

- [ ] **Step 5: Commit**

```bash
git add clinic-schedule-portal/supabase/functions/clinic-schedule-server/dates.ts clinic-schedule-portal/supabase/functions/clinic-schedule-server/tests/dates.test.ts clinic-schedule-portal/vitest.config.ts
git commit -m "feat(server): canonical dates + cross-base normalizers"
```

---

### Task 7: `airtable.ts` helper module

**Files:**
- Create: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/airtable.ts`

This module wraps `fetch` to Airtable with auth + pagination. The Edge Function calls only this — nothing else hits `api.airtable.com` directly.

- [ ] **Step 1: Implement `airtable.ts`**

```ts
const BASE = "https://api.airtable.com/v0";
const PAT = Deno.env.get("AIRTABLE_PAT") ?? "";

type AirtableRecord<F = Record<string, unknown>> = {
  id: string;
  createdTime: string;
  fields: F;
};

type ListResponse<F> = {
  records: AirtableRecord<F>[];
  offset?: string;
};

const headers = () => ({
  Authorization: `Bearer ${PAT}`,
  "Content-Type": "application/json",
});

async function fetchWithRetry(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    lastErr = res.status;
    await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
  }
  throw new Error(`Airtable retries exhausted (last status ${lastErr})`);
}

export async function listAll<F = Record<string, unknown>>(opts: {
  baseId: string;
  tableId: string;
  filterByFormula?: string;
  fields?: string[];
  pageSize?: number;
}): Promise<AirtableRecord<F>[]> {
  const out: AirtableRecord<F>[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams();
    params.set("pageSize", String(opts.pageSize ?? 100));
    if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
    (opts.fields ?? []).forEach((f) => params.append("fields[]", f));
    if (offset) params.set("offset", offset);
    const url = `${BASE}/${opts.baseId}/${encodeURIComponent(opts.tableId)}?${params.toString()}`;
    const res = await fetchWithRetry(url, { headers: headers() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable list failed: ${res.status} ${text}`);
    }
    const json = (await res.json()) as ListResponse<F>;
    out.push(...json.records);
    offset = json.offset;
  } while (offset);
  return out;
}

export async function createRecord<F = Record<string, unknown>>(opts: {
  baseId: string;
  tableId: string;
  fields: Record<string, unknown>;
}): Promise<AirtableRecord<F>> {
  const url = `${BASE}/${opts.baseId}/${encodeURIComponent(opts.tableId)}`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields: opts.fields }),
  });
  if (!res.ok) throw new Error(`Airtable create failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AirtableRecord<F>;
}

export async function patchRecord<F = Record<string, unknown>>(opts: {
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
}): Promise<AirtableRecord<F>> {
  const url = `${BASE}/${opts.baseId}/${encodeURIComponent(opts.tableId)}/${opts.recordId}`;
  const res = await fetchWithRetry(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields: opts.fields }),
  });
  if (!res.ok) throw new Error(`Airtable patch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AirtableRecord<F>;
}

export function escapeFormulaString(s: string): string {
  return s.replace(/'/g, "\\'");
}

export type { AirtableRecord };
```

- [ ] **Step 2: Sanity-check imports**

In `index.ts`, add `import { listAll } from "./airtable.ts";` at the top. Run `deno check supabase/functions/clinic-schedule-server/index.ts` (if Deno is installed locally) or rely on the next deploy to catch errors. Remove the placeholder import.

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/supabase/functions/clinic-schedule-server/airtable.ts
git commit -m "feat(server): airtable fetch helpers with retry"
```

---

### Task 8: `/director/:netid` identity endpoint

**Files:**
- Modify: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts`

- [ ] **Step 1: Add the route to `index.ts`**

Append below the `/tables` route:

```ts
type AllPeopleFields = {
  NetID?: string;
  "Contact Email"?: string;
  Name?: string;
};

type Su26RosterFields = {
  "Department Name"?: string;
  Directors?: { id: string; name: string }[] | string[];
  "Schedule Status"?: { id: string; name: string } | string;
  "Submitted At"?: string;
  "Submitted By"?: { id: string; name: string }[] | string[];
};

import { listAll, escapeFormulaString } from "./airtable.ts";

async function findPerson(config: Config, netid: string, email: string) {
  const safeNetid = escapeFormulaString(netid.toLowerCase());
  const safeEmail = escapeFormulaString(email.toLowerCase());
  const formula = `AND(LOWER({NetID}) = '${safeNetid}', LOWER({Contact Email}) = '${safeEmail}')`;
  const records = await listAll<AllPeopleFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
    filterByFormula: formula,
    pageSize: 1,
  });
  return records[0] ?? null;
}

async function findDepartmentsForDirector(config: Config, personId: string) {
  const allDepts = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  return allDepts.filter((d) => {
    const dirs = d.fields.Directors as { id: string }[] | undefined;
    return Array.isArray(dirs) && dirs.some((ref) => ref.id === personId);
  });
}

app.post(`${ROUTE_PREFIX}/director/:netid`, async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const netid = c.req.param("netid");
  const { email } = (await c.req.json()) as { email?: string };
  if (!netid || !email) return c.json({ error: "Missing netid or email" }, 400);

  const person = await findPerson(config, netid, email);
  if (!person) return c.json({ error: "Not found" }, 404);

  const depts = await findDepartmentsForDirector(config, person.id);
  if (depts.length === 0) {
    return c.json({ error: "Not a SU 26 director" }, 403);
  }

  return c.json({
    person: {
      id: person.id,
      name: person.fields.Name ?? "",
      netid: person.fields.NetID ?? "",
      email: person.fields["Contact Email"] ?? "",
    },
    departments: depts.map((d) => {
      const status = d.fields["Schedule Status"];
      const statusName =
        typeof status === "string" ? status : status?.name ?? "Draft";
      return {
        id: d.id,
        name: d.fields["Department Name"] ?? "",
        scheduleStatus: statusName,
        submittedAt: d.fields["Submitted At"] ?? null,
      };
    }),
  });
});
```

(Note: the `import` line must be moved to the top of the file with the other imports — duplicate it there, then remove this in-line copy.)

- [ ] **Step 2: Deploy and test manually**

```bash
cd clinic-schedule-portal
supabase functions deploy clinic-schedule-server --project-ref $YOUR_PROJECT_REF
```

In a terminal (substitute real values):

```bash
curl -X POST "https://$YOUR_PROJECT_REF.supabase.co/functions/v1/make-server-clinic-schedule/director/acn38" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"a.nelson@yale.edu"}'
```

Expected: a JSON payload with `person` and `departments` (or 403/404 if the test user isn't actually a SU 26 director).

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts
git commit -m "feat(server): director identity + department lookup"
```

---

### Task 9: `/schedule/:dept` endpoint (without conflicts)

**Files:**
- Modify: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts`

- [ ] **Step 1: Add the schedule loader**

Append to `index.ts`:

```ts
import { CANONICAL_DATES, normalizeVolunteerDate, normalizeDirectorDate, displayDate } from "./dates.ts";

type DirectorAppFields = {
  "Yale NetID"?: string;
  "What is your spring availability?"?: { id: string; name: string }[] | string[];
};

type VolunteerAppFields = {
  NetID?: string;
  "General Availability"?: { id: string; name: string }[] | string[];
};

type ScheduleRowFields = {
  Department?: { id: string; name: string }[] | string[];
  Date?: { id: string; name: string } | string;
  "Directors on Shift"?: { id: string; name: string }[] | string[];
  "Volunteers on Shift"?: { id: string; name: string }[] | string[];
};

function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : (v as { name?: string }).name ?? ""));
}

function selectName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name ?? "");
  }
  return "";
}

app.post(`${ROUTE_PREFIX}/schedule/:deptId`, async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const deptId = c.req.param("deptId");
  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
  };
  if (!deptId || !callerNetid || !callerEmail) {
    return c.json({ error: "Missing deptId / callerNetid / callerEmail" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const [allRoster, allSchedule, allDirectorApps, allVolunteerApps] = await Promise.all([
    listAll<Su26RosterFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26RosterTableId,
    }),
    listAll<ScheduleRowFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
    }),
    listAll<DirectorAppFields>({
      baseId: config.directorAppsBaseId,
      tableId: config.directorAppsTableId,
      fields: ["Yale NetID", "What is your spring availability?"],
    }),
    listAll<VolunteerAppFields>({
      baseId: config.volunteerAppsBaseId,
      tableId: config.volunteerAppsTableId,
      fields: ["NetID", "General Availability"],
    }),
  ]);

  const dept = allRoster.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);
  const deptDirectors = dept.fields.Directors as { id: string; name: string }[] | undefined;
  const callerIsDeptDirector = (deptDirectors ?? []).some((d) => d.id === caller.id);

  // build a NetID → ISO[] availability lookup, for both kinds
  const directorAvail = new Map<string, string[]>();
  for (const r of allDirectorApps) {
    const nid = (r.fields["Yale NetID"] ?? "").toLowerCase();
    if (!nid) continue;
    const dates = (r.fields["What is your spring availability?"] ?? []) as { name?: string }[];
    directorAvail.set(
      nid,
      dates.map((d) => normalizeDirectorDate(d.name ?? "")).filter((x): x is string => !!x),
    );
  }
  const volAvail = new Map<string, string[]>();
  for (const r of allVolunteerApps) {
    const nid = (r.fields.NetID ?? "").toLowerCase();
    if (!nid) continue;
    const dates = (r.fields["General Availability"] ?? []) as { name?: string }[];
    volAvail.set(
      nid,
      dates.map((d) => normalizeVolunteerDate(d.name ?? "")).filter((x): x is string => !!x),
    );
  }

  // fetch All People records for everyone on this dept's roster (one batch)
  const dirRefs = (dept.fields.Directors as { id: string }[] | undefined) ?? [];
  const volRefs = ((dept.fields as Record<string, unknown>)["Volunteers"] as { id: string }[] | undefined) ?? [];
  const allIds = [...dirRefs.map((r) => r.id), ...volRefs.map((r) => r.id)];
  const people = allIds.length
    ? await listAll<AllPeopleFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.allPeopleTableId,
        filterByFormula: `OR(${allIds.map((id) => `RECORD_ID() = '${id}'`).join(",")})`,
      })
    : [];
  const peopleById = new Map(people.map((p) => [p.id, p]));

  function buildPerson(id: string, kind: "director" | "volunteer") {
    const person = peopleById.get(id);
    const netid = (person?.fields.NetID ?? "").toLowerCase();
    const available =
      kind === "director" ? directorAvail.get(netid) ?? [] : volAvail.get(netid) ?? [];
    return {
      id,
      netid,
      name: person?.fields.Name ?? "",
      available,
      conflicts: { sameDay: [], crossTerm: [] }, // populated by Task 11
    };
  }

  const scheduleStatus = selectName(dept.fields["Schedule Status"]) || "Draft";

  const deptSchedule = allSchedule.filter((row) => {
    const refs = row.fields.Department as { id: string }[] | undefined;
    return Array.isArray(refs) && refs.some((r) => r.id === deptId);
  });

  const assignmentsByDate = new Map<string, { directorIds: string[]; volunteerIds: string[] }>();
  for (const row of deptSchedule) {
    const dateName = selectName(row.fields.Date);
    const iso = normalizeVolunteerDate(dateName);
    if (!iso) continue;
    const dirs = (row.fields["Directors on Shift"] as { id: string }[] | undefined) ?? [];
    const vols = (row.fields["Volunteers on Shift"] as { id: string }[] | undefined) ?? [];
    assignmentsByDate.set(iso, {
      directorIds: dirs.map((r) => r.id),
      volunteerIds: vols.map((r) => r.id),
    });
  }

  return c.json({
    callerIsDeptDirector,
    department: {
      id: dept.id,
      name: dept.fields["Department Name"] ?? "",
      scheduleStatus,
      submittedAt: dept.fields["Submitted At"] ?? null,
    },
    dates: CANONICAL_DATES.map((iso) => ({ iso, display: displayDate(iso) })),
    roster: {
      directors: dirRefs.map((r) => buildPerson(r.id, "director")),
      volunteers: volRefs.map((r) => buildPerson(r.id, "volunteer")),
    },
    assignments: CANONICAL_DATES.map((iso) => ({
      date: iso,
      directorIds: assignmentsByDate.get(iso)?.directorIds ?? [],
      volunteerIds: assignmentsByDate.get(iso)?.volunteerIds ?? [],
    })),
  });
});
```

- [ ] **Step 2: Deploy and verify**

```bash
cd clinic-schedule-portal
supabase functions deploy clinic-schedule-server --project-ref $YOUR_PROJECT_REF
```

```bash
curl -X POST "https://$YOUR_PROJECT_REF.supabase.co/functions/v1/make-server-clinic-schedule/schedule/$LABR_RECORD_ID" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"callerNetid":"$YOUR_TEST_NETID","callerEmail":"$YOUR_TEST_EMAIL"}'
```

Expected: a payload with `dates` (18 entries), `roster.directors[]`, `roster.volunteers[]`, and `assignments` (18 dates, all with empty arrays until something is written).

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts
git commit -m "feat(server): schedule loader (no conflicts yet)"
```

---

### Task 10: `conflicts.ts` module + tests

**Files:**
- Create: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/conflicts.ts`
- Create: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/tests/conflicts.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, expect, it } from "vitest";
import { computeConflicts, type ScheduleEntry } from "../conflicts";

const entry = (
  date: string,
  dept: string,
  directorIds: string[],
  volunteerIds: string[],
): ScheduleEntry => ({ date, departmentId: dept, departmentName: dept, directorIds, volunteerIds });

describe("computeConflicts", () => {
  it("returns empty conflicts for a person with one assignment", () => {
    const conflicts = computeConflicts({
      personId: "p1",
      thisDepartmentId: "LABR",
      allSchedule: [entry("2026-05-30", "LABR", ["p1"], [])],
    });
    expect(conflicts.sameDay).toEqual([]);
    expect(conflicts.crossTerm).toEqual([]);
  });

  it("flags same-day conflict across departments", () => {
    const conflicts = computeConflicts({
      personId: "p1",
      thisDepartmentId: "LABR",
      allSchedule: [
        entry("2026-05-30", "LABR", ["p1"], []),
        entry("2026-05-30", "JCTS", [], ["p1"]),
      ],
    });
    expect(conflicts.sameDay).toEqual([{ date: "2026-05-30", otherDept: "JCTS" }]);
    expect(conflicts.crossTerm).toEqual([]);
  });

  it("flags cross-term conflict on different dates", () => {
    const conflicts = computeConflicts({
      personId: "p1",
      thisDepartmentId: "LABR",
      allSchedule: [
        entry("2026-05-30", "LABR", ["p1"], []),
        entry("2026-06-06", "JCTS", [], ["p1"]),
      ],
    });
    expect(conflicts.sameDay).toEqual([]);
    expect(conflicts.crossTerm).toEqual([{ date: "2026-06-06", otherDept: "JCTS" }]);
  });

  it("does not flag the person's assignments in their own department", () => {
    const conflicts = computeConflicts({
      personId: "p1",
      thisDepartmentId: "LABR",
      allSchedule: [
        entry("2026-05-30", "LABR", ["p1"], []),
        entry("2026-06-06", "LABR", [], ["p1"]),
      ],
    });
    expect(conflicts.sameDay).toEqual([]);
    expect(conflicts.crossTerm).toEqual([]);
  });

  it("deduplicates multiple appearances in the same other dept", () => {
    const conflicts = computeConflicts({
      personId: "p1",
      thisDepartmentId: "LABR",
      allSchedule: [
        entry("2026-05-30", "JCTS", ["p1"], []),
        entry("2026-05-30", "JCTS", [], ["p1"]),
      ],
    });
    expect(conflicts.sameDay).toEqual([{ date: "2026-05-30", otherDept: "JCTS" }]);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd clinic-schedule-portal && npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`clinic-schedule-portal/supabase/functions/clinic-schedule-server/conflicts.ts`:

```ts
export type ScheduleEntry = {
  date: string; // ISO
  departmentId: string;
  departmentName: string;
  directorIds: string[];
  volunteerIds: string[];
};

export type Conflicts = {
  sameDay: { date: string; otherDept: string }[];
  crossTerm: { date: string; otherDept: string }[];
};

export function computeConflicts(opts: {
  personId: string;
  thisDepartmentId: string;
  allSchedule: ScheduleEntry[];
}): Conflicts {
  const { personId, thisDepartmentId, allSchedule } = opts;
  const thisDeptDates = new Set(
    allSchedule
      .filter((e) => e.departmentId === thisDepartmentId)
      .filter((e) => e.directorIds.includes(personId) || e.volunteerIds.includes(personId))
      .map((e) => e.date),
  );

  const sameDay = new Map<string, Set<string>>(); // key: date|dept
  const crossTerm = new Map<string, Set<string>>();
  for (const entry of allSchedule) {
    if (entry.departmentId === thisDepartmentId) continue;
    const present = entry.directorIds.includes(personId) || entry.volunteerIds.includes(personId);
    if (!present) continue;
    const target = thisDeptDates.has(entry.date) ? sameDay : crossTerm;
    if (!target.has(entry.date)) target.set(entry.date, new Set());
    target.get(entry.date)!.add(entry.departmentName);
  }

  const toList = (m: Map<string, Set<string>>) =>
    [...m.entries()]
      .flatMap(([date, depts]) => [...depts].map((otherDept) => ({ date, otherDept })))
      .sort((a, b) => a.date.localeCompare(b.date) || a.otherDept.localeCompare(b.otherDept));

  return { sameDay: toList(sameDay), crossTerm: toList(crossTerm) };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
cd clinic-schedule-portal && npm test
```

Expected: all `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add clinic-schedule-portal/supabase/functions/clinic-schedule-server/conflicts.ts clinic-schedule-portal/supabase/functions/clinic-schedule-server/tests/conflicts.test.ts
git commit -m "feat(server): cross-dept conflict computation"
```

---

### Task 11: Wire conflicts into `/schedule/:dept`

**Files:**
- Modify: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts`

- [ ] **Step 1: Update the schedule handler**

Find the `buildPerson` function inside the `/schedule/:deptId` handler. Replace the `conflicts: { sameDay: [], crossTerm: [] }` placeholder with a real computation.

Above the `app.post(...)` block (somewhere near the top of the file with the other imports), add:

```ts
import { computeConflicts, type ScheduleEntry } from "./conflicts.ts";
```

Inside the handler, after `allSchedule` is fetched, build a `ScheduleEntry[]`:

```ts
const scheduleEntries: ScheduleEntry[] = allSchedule
  .map((row): ScheduleEntry | null => {
    const dept = (row.fields.Department as { id: string; name?: string }[] | undefined)?.[0];
    const dateName = selectName(row.fields.Date);
    const iso = normalizeVolunteerDate(dateName);
    if (!dept || !iso) return null;
    const dirs = (row.fields["Directors on Shift"] as { id: string }[] | undefined) ?? [];
    const vols = (row.fields["Volunteers on Shift"] as { id: string }[] | undefined) ?? [];
    return {
      date: iso,
      departmentId: dept.id,
      departmentName: dept.name ?? "",
      directorIds: dirs.map((r) => r.id),
      volunteerIds: vols.map((r) => r.id),
    };
  })
  .filter((x): x is ScheduleEntry => !!x);
```

Change `buildPerson` to:

```ts
function buildPerson(id: string, kind: "director" | "volunteer") {
  const person = peopleById.get(id);
  const netid = (person?.fields.NetID ?? "").toLowerCase();
  const available =
    kind === "director" ? directorAvail.get(netid) ?? [] : volAvail.get(netid) ?? [];
  const conflicts = computeConflicts({
    personId: id,
    thisDepartmentId: deptId,
    allSchedule: scheduleEntries,
  });
  return { id, netid, name: person?.fields.Name ?? "", available, conflicts };
}
```

- [ ] **Step 2: Deploy and verify**

```bash
cd clinic-schedule-portal
supabase functions deploy clinic-schedule-server --project-ref $YOUR_PROJECT_REF
```

Re-run the `curl` from Task 9. Expected: roster entries now carry a non-empty `conflicts` block once some `SU 26 Schedule` rows exist with the same person across depts. With an empty schedule table, conflicts will all be empty — that's fine for now.

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts
git commit -m "feat(server): include cross-dept conflicts in /schedule response"
```

---

### Task 12: `/assignment` upsert endpoint

**Files:**
- Modify: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts`

- [ ] **Step 1: Add the upsert handler**

Append:

```ts
import { createRecord, patchRecord } from "./airtable.ts";

app.post(`${ROUTE_PREFIX}/assignment`, async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    departmentId?: string;
    date?: string; // ISO
    directorIds?: string[];
    volunteerIds?: string[];
  };
  const { callerNetid, callerEmail, departmentId, date } = body;
  if (!callerNetid || !callerEmail || !departmentId || !date) {
    return c.json({ error: "Missing required field" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const roster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = roster.find((r) => r.id === departmentId);
  if (!dept) return c.json({ error: "Department not found" }, 404);

  const isDir = (dept.fields.Directors as { id: string }[] | undefined)?.some(
    (d) => d.id === caller.id,
  );
  if (!isDir) return c.json({ error: "Caller not a director on this department" }, 403);

  const statusName = selectName(dept.fields["Schedule Status"]) || "Draft";
  if (statusName === "Submitted") {
    return c.json({ error: "Schedule already submitted" }, 409);
  }

  // find existing row for (dept, date)
  const all = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
  });
  const existing = all.find((row) => {
    const refs = row.fields.Department as { id: string }[] | undefined;
    if (!refs?.some((r) => r.id === departmentId)) return false;
    const dn = selectName(row.fields.Date);
    return normalizeVolunteerDate(dn) === date;
  });

  // map ISO back to the singleSelect option name (e.g. "May 30th")
  const dateName = displayDate(date);
  const deptName = dept.fields["Department Name"] ?? "";

  const fields = {
    Name: `${deptName} — ${dateName}`,
    Department: [departmentId],
    Date: dateName,
    "Directors on Shift": body.directorIds ?? [],
    "Volunteers on Shift": body.volunteerIds ?? [],
  };

  if (existing) {
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      recordId: existing.id,
      fields,
    });
  } else {
    await createRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      fields,
    });
  }

  return c.json({ success: true });
});
```

- [ ] **Step 2: Deploy and smoke-test**

```bash
cd clinic-schedule-portal
supabase functions deploy clinic-schedule-server --project-ref $YOUR_PROJECT_REF
```

```bash
curl -X POST "https://$PROJECT_REF.supabase.co/functions/v1/make-server-clinic-schedule/assignment" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "callerNetid":"'"$NETID"'",
    "callerEmail":"'"$EMAIL"'",
    "departmentId":"'"$LABR_REC_ID"'",
    "date":"2026-05-30",
    "directorIds":["'"$YOUR_REC_ID"'"],
    "volunteerIds":[]
  }'
```

Expected: `{"success":true}`. Open Airtable → `SU 26 Schedule` → confirm one row exists for `LABR — May 30th` with the right linked director.

Then re-run with `directorIds: []` to clear. Confirm the row updates (not duplicates).

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts
git commit -m "feat(server): /assignment upsert with auth + lock checks"
```

---

### Task 13: `/submit/:dept` lock endpoint

**Files:**
- Modify: `clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts`

- [ ] **Step 1: Add the handler**

```ts
app.post(`${ROUTE_PREFIX}/submit/:deptId`, async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const deptId = c.req.param("deptId");
  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
  };
  if (!deptId || !callerNetid || !callerEmail) {
    return c.json({ error: "Missing field" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const roster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = roster.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);
  const isDir = (dept.fields.Directors as { id: string }[] | undefined)?.some(
    (d) => d.id === caller.id,
  );
  if (!isDir) return c.json({ error: "Not a director on this department" }, 403);

  const statusName = selectName(dept.fields["Schedule Status"]) || "Draft";
  if (statusName === "Submitted") return c.json({ error: "Already submitted" }, 409);

  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
    recordId: dept.id,
    fields: {
      "Schedule Status": "Submitted",
      "Submitted At": new Date().toISOString(),
      "Submitted By": [caller.id],
    },
  });

  return c.json({ success: true });
});
```

- [ ] **Step 2: Deploy and test**

```bash
cd clinic-schedule-portal
supabase functions deploy clinic-schedule-server --project-ref $YOUR_PROJECT_REF
```

```bash
curl -X POST "https://$PROJECT_REF.supabase.co/functions/v1/make-server-clinic-schedule/submit/$LABR_REC_ID" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"callerNetid":"'"$NETID"'","callerEmail":"'"$EMAIL"'"}'
```

Expected: `{"success":true}`. In Airtable → `SU 26` row → LABR's `Schedule Status` flips to `Submitted`. Re-running returns `409`. After flipping back to `Draft` in Airtable manually, subsequent `/assignment` calls succeed again.

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/supabase/functions/clinic-schedule-server/index.ts
git commit -m "feat(server): /submit endpoint locks department for the term"
```

---

## Phase 3 — Frontend

### Task 14: API client + shared types

**Files:**
- Create: `clinic-schedule-portal/src/api/types.ts`
- Create: `clinic-schedule-portal/src/api/client.ts`

- [ ] **Step 1: Shared types matching the API contract**

```ts
// src/api/types.ts
export type DepartmentRef = {
  id: string;
  name: string;
  scheduleStatus: "Draft" | "Submitted";
  submittedAt: string | null;
};

export type Person = {
  id: string;
  netid: string;
  name: string;
  available: string[]; // ISO dates
  conflicts: {
    sameDay: { date: string; otherDept: string }[];
    crossTerm: { date: string; otherDept: string }[];
  };
};

export type Assignment = {
  date: string; // ISO
  directorIds: string[];
  volunteerIds: string[];
};

export type ScheduleResponse = {
  callerIsDeptDirector: boolean;
  department: { id: string; name: string; scheduleStatus: string; submittedAt: string | null };
  dates: { iso: string; display: string }[];
  roster: { directors: Person[]; volunteers: Person[] };
  assignments: Assignment[];
};

export type DirectorIdentity = {
  person: { id: string; name: string; netid: string; email: string };
  departments: DepartmentRef[];
};

export type Config = {
  haveNManagementBaseId: string;
  allPeopleTableId: string;
  su26RosterTableId: string;
  su26ScheduleTableId: string;
  directorAppsBaseId: string;
  directorAppsTableId: string;
  volunteerAppsBaseId: string;
  volunteerAppsTableId: string;
};
```

- [ ] **Step 2: API client**

```ts
// src/api/client.ts
import { projectId, publicAnonKey } from "../../utils/supabase/info";
import type {
  Config,
  DirectorIdentity,
  ScheduleResponse,
} from "./types";

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-clinic-schedule`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${publicAnonKey}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json.error ?? `HTTP ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return json as T;
}

export const api = {
  getConfig: () => request<{ configured: boolean; config: Config | null }>("/config"),
  saveConfig: (config: Config) =>
    request<{ success: true }>("/config", { method: "POST", body: JSON.stringify(config) }),
  listBases: () => request<{ bases: { id: string; name: string }[] }>("/bases"),
  listTables: (baseId: string) =>
    request<{ tables: { id: string; name: string }[] }>("/tables", {
      method: "POST",
      body: JSON.stringify({ baseId }),
    }),
  director: (netid: string, email: string) =>
    request<DirectorIdentity>(`/director/${encodeURIComponent(netid)}`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  schedule: (deptId: string, callerNetid: string, callerEmail: string) =>
    request<ScheduleResponse>(`/schedule/${encodeURIComponent(deptId)}`, {
      method: "POST",
      body: JSON.stringify({ callerNetid, callerEmail }),
    }),
  assign: (input: {
    callerNetid: string;
    callerEmail: string;
    departmentId: string;
    date: string;
    directorIds: string[];
    volunteerIds: string[];
  }) =>
    request<{ success: true }>("/assignment", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  submit: (deptId: string, callerNetid: string, callerEmail: string) =>
    request<{ success: true }>(`/submit/${encodeURIComponent(deptId)}`, {
      method: "POST",
      body: JSON.stringify({ callerNetid, callerEmail }),
    }),
};
```

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/src/api
git commit -m "feat(portal): typed API client matching server contract"
```

---

### Task 15: `App.tsx` step machine

**Files:**
- Modify: `clinic-schedule-portal/src/app/App.tsx`

- [ ] **Step 1: Replace `App.tsx` with the full step machine**

```tsx
import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/api/client";
import type { DirectorIdentity, DepartmentRef } from "@/api/types";
import { LOGO_URL, BG_IMAGE } from "./constants";
import { SetupWizard } from "./components/SetupWizard";
import { DirectorLookup } from "./components/DirectorLookup";
import { ScheduleBuilder } from "./components/ScheduleBuilder";

type Step = "loading" | "setup" | "lookup" | "schedule";

export default function App() {
  const [step, setStep] = useState<Step>("loading");
  const [identity, setIdentity] = useState<DirectorIdentity | null>(null);

  useEffect(() => {
    const slug = window.location.pathname.replace(/^\/+|\/+$/g, "");
    if (slug && !slug.includes(".") && slug !== "index.html") {
      // Slug-based direct lookup needs an email too; fall through to lookup unless we have local creds.
      bootstrap();
    } else {
      bootstrap();
    }
  }, []);

  async function bootstrap() {
    try {
      const cfg = await api.getConfig();
      setStep(cfg.configured ? "lookup" : "setup");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't reach the server. Check your connection.");
      setStep("setup");
    }
  }

  function handleIdentity(found: DirectorIdentity) {
    setIdentity(found);
    setStep("schedule");
  }

  function handleSignOut() {
    setIdentity(null);
    setStep("lookup");
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden font-sans text-slate-900">
      <Toaster position="top-center" richColors />
      <div className="absolute inset-0 z-0">
        <img src={BG_IMAGE} alt="" className="w-full h-full object-cover blur-md scale-105" />
        <div className="absolute inset-0 bg-[#0F4D92]/80" />
      </div>
      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="p-6 flex items-center justify-between text-white border-b border-white/10">
          <div className="flex items-center gap-4">
            <img src={LOGO_URL} alt="HAVEN Free Clinic" className="h-12 w-auto" />
            <div className="h-8 w-px bg-white/20" />
            <p className="text-sm font-medium text-blue-100 tracking-wide uppercase">
              Clinic Schedule
            </p>
          </div>
          {identity && (
            <button
              onClick={handleSignOut}
              className="text-sm text-blue-100 hover:text-white transition-colors"
            >
              Sign out
            </button>
          )}
        </header>

        <main className="flex-1 flex items-start justify-center p-4 sm:p-6">
          <AnimatePresence mode="wait">
            {step === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-white text-center mt-12"
              >
                <div className="animate-spin w-8 h-8 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4" />
                <p>Loading…</p>
              </motion.div>
            )}
            {step === "setup" && (
              <motion.div key="setup" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-md mt-12">
                <SetupWizard onComplete={() => setStep("lookup")} />
              </motion.div>
            )}
            {step === "lookup" && (
              <motion.div key="lookup" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-md mt-12">
                <DirectorLookup onFound={handleIdentity} />
              </motion.div>
            )}
            {step === "schedule" && identity && (
              <motion.div key="schedule" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="w-full max-w-6xl">
                <ScheduleBuilder identity={identity} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="p-6 text-center text-blue-100/40 text-sm">
          &copy; {new Date().getFullYear()} HAVEN Free Clinic. Built by the HAVEN IT Department.
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add component stubs so the file compiles**

Create three minimal stubs (we'll fill them in the next tasks):

`clinic-schedule-portal/src/app/components/SetupWizard.tsx`:

```tsx
export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="bg-white rounded-xl p-8 shadow-lg">
      <p>Setup wizard placeholder.</p>
      <button className="mt-4 underline" onClick={onComplete}>continue</button>
    </div>
  );
}
```

`clinic-schedule-portal/src/app/components/DirectorLookup.tsx`:

```tsx
import type { DirectorIdentity } from "@/api/types";

export function DirectorLookup({ onFound: _ }: { onFound: (id: DirectorIdentity) => void }) {
  return <div className="bg-white rounded-xl p-8 shadow-lg">Lookup placeholder.</div>;
}
```

`clinic-schedule-portal/src/app/components/ScheduleBuilder.tsx`:

```tsx
import type { DirectorIdentity } from "@/api/types";

export function ScheduleBuilder({ identity }: { identity: DirectorIdentity }) {
  return <div className="bg-white rounded-xl p-8 shadow-lg">Hi {identity.person.name}!</div>;
}
```

- [ ] **Step 3: Run dev server and verify**

```bash
cd clinic-schedule-portal && npm run dev
```

Visit `localhost:5173`. The header should show "Clinic Schedule" and the body should show the setup placeholder (assuming no `/config` exists yet). Once you've run `POST /config` manually, refreshing should drop you onto the lookup placeholder.

- [ ] **Step 4: Commit**

```bash
git add clinic-schedule-portal/src/app/App.tsx clinic-schedule-portal/src/app/components
git commit -m "feat(portal): step machine + component stubs"
```

---

### Task 16: `SetupWizard` component

**Files:**
- Modify: `clinic-schedule-portal/src/app/components/SetupWizard.tsx`

- [ ] **Step 1: Replace the placeholder**

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/api/client";
import type { Config } from "@/api/types";

const PRESETS: Pick<Config, "haveNManagementBaseId" | "directorAppsBaseId" | "volunteerAppsBaseId"> = {
  haveNManagementBaseId: "appkxTQ19GmaHgW1O",
  directorAppsBaseId: "app6MHzSA1yPej2zX",
  volunteerAppsBaseId: "appOq1yOiA1Lfzq8L",
};

type TableOption = { id: string; name: string };

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [loading, setLoading] = useState(false);
  const [haveNTables, setHaveNTables] = useState<TableOption[]>([]);
  const [directorTables, setDirectorTables] = useState<TableOption[]>([]);
  const [volunteerTables, setVolunteerTables] = useState<TableOption[]>([]);
  const [config, setConfig] = useState<Config>({
    ...PRESETS,
    allPeopleTableId: "tblnHgBpknuqWvx9c",
    su26RosterTableId: "tbl2VrP1uqwFt7QNQ",
    su26ScheduleTableId: "",
    directorAppsTableId: "tbluFoybFPBjBAXyk",
    volunteerAppsTableId: "tblV3UrQQvIIZzFTU",
  });

  useEffect(() => {
    async function loadAllTables() {
      try {
        const [h, d, v] = await Promise.all([
          api.listTables(PRESETS.haveNManagementBaseId),
          api.listTables(PRESETS.directorAppsBaseId),
          api.listTables(PRESETS.volunteerAppsBaseId),
        ]);
        setHaveNTables(h.tables);
        setDirectorTables(d.tables);
        setVolunteerTables(v.tables);
      } catch (e) {
        console.error(e);
        toast.error("Couldn't fetch table lists — check the PAT scopes.");
      }
    }
    loadAllTables();
  }, []);

  async function save() {
    if (!config.su26ScheduleTableId) {
      toast.error("Pick the SU 26 Schedule table.");
      return;
    }
    setLoading(true);
    try {
      await api.saveConfig(config);
      toast.success("Configuration saved.");
      onComplete();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function tableSelect(
    label: string,
    value: string,
    onChange: (id: string) => void,
    options: TableOption[],
  ) {
    return (
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full p-2 border border-slate-300 rounded-md bg-white"
        >
          <option value="">— select —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-lg border border-slate-100 space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Set up the Schedule Portal</h2>
        <p className="text-slate-500 mt-2">Pick the Airtable tables this portal will read and write.</p>
      </div>

      {tableSelect("All People (HAVEN Mgmt)", config.allPeopleTableId, (v) => update("allPeopleTableId", v), haveNTables)}
      {tableSelect("SU 26 Roster (HAVEN Mgmt)", config.su26RosterTableId, (v) => update("su26RosterTableId", v), haveNTables)}
      {tableSelect("SU 26 Schedule (HAVEN Mgmt)", config.su26ScheduleTableId, (v) => update("su26ScheduleTableId", v), haveNTables)}
      {tableSelect("Director Applications", config.directorAppsTableId, (v) => update("directorAppsTableId", v), directorTables)}
      {tableSelect("Volunteer Applications", config.volunteerAppsTableId, (v) => update("volunteerAppsTableId", v), volunteerTables)}

      <button
        onClick={save}
        disabled={loading}
        className="w-full bg-[#0F4D92] text-white p-3 rounded-lg font-medium hover:bg-[#0B3D75] disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Save &amp; continue
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

In a fresh state (no config yet), visit `localhost:5173`. The wizard renders, table dropdowns populate, defaults are preselected, "Save & continue" goes through and refreshes the app into the lookup placeholder.

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/src/app/components/SetupWizard.tsx
git commit -m "feat(portal): setup wizard"
```

---

### Task 17: `DirectorLookup` component

**Files:**
- Modify: `clinic-schedule-portal/src/app/components/DirectorLookup.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { Search, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import type { DirectorIdentity } from "@/api/types";

export function DirectorLookup({ onFound }: { onFound: (id: DirectorIdentity) => void }) {
  const [email, setEmail] = useState("");
  const [netid, setNetid] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !netid) {
      toast.error("Please provide both NetID and email.");
      return;
    }
    setLoading(true);
    try {
      const id = await api.director(netid.trim().toLowerCase(), email.trim().toLowerCase());
      onFound(id);
      toast.success(`Welcome, ${id.person.name.split(" ")[0] || "director"}!`);
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status === 403) {
        toast.error("You're not listed as a SU 26 director. Contact the IT department.");
      } else if (status === 404) {
        toast.error("We couldn't find a HAVEN record matching that NetID + email.");
      } else {
        toast.error((e as Error).message || "Lookup failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-lg border border-slate-100">
      <h2 className="text-2xl font-bold">Sign in</h2>
      <p className="text-slate-500 mt-2">NetID + email — same as on your HAVEN record.</p>

      <form onSubmit={submit} className="space-y-4 mt-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">NetID</label>
          <input
            value={netid}
            onChange={(e) => setNetid(e.target.value)}
            placeholder="abc1234"
            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0F4D92] focus:outline-none transition-all"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yale.edu"
            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0F4D92] focus:outline-none transition-all"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#0F4D92] text-white p-3 rounded-lg font-medium hover:bg-[#0B3D75] disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
          Continue
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Restart dev server (`npm run dev`). After config exists, the lookup form renders. Submitting valid director credentials advances to the schedule placeholder; invalid credentials show the appropriate toast.

- [ ] **Step 3: Commit**

```bash
git add clinic-schedule-portal/src/app/components/DirectorLookup.tsx
git commit -m "feat(portal): director identity lookup"
```

---

### Task 18: `ScheduleBuilder` shell with department switcher, stats bar, view toggle

**Files:**
- Modify: `clinic-schedule-portal/src/app/components/ScheduleBuilder.tsx`
- Create: `clinic-schedule-portal/src/app/components/schedule/DepartmentSwitcher.tsx`
- Create: `clinic-schedule-portal/src/app/components/schedule/StatsBar.tsx`
- Create: `clinic-schedule-portal/src/app/components/schedule/ViewToggle.tsx`
- Create: `clinic-schedule-portal/src/app/components/SubmittedView.tsx`

- [ ] **Step 1: `DepartmentSwitcher`**

```tsx
// src/app/components/schedule/DepartmentSwitcher.tsx
import type { DepartmentRef } from "@/api/types";

export function DepartmentSwitcher({
  departments,
  selectedId,
  onSelect,
}: {
  departments: DepartmentRef[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (departments.length === 1) {
    return (
      <div className="text-lg font-semibold">
        {departments[0].name}
      </div>
    );
  }
  return (
    <select
      value={selectedId}
      onChange={(e) => onSelect(e.target.value)}
      className="p-2 border border-slate-300 rounded-md bg-white text-lg font-semibold"
    >
      {departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: `StatsBar`**

```tsx
// src/app/components/schedule/StatsBar.tsx
import type { Assignment } from "@/api/types";

export function StatsBar({
  assignments,
  doubleBookedCount,
}: {
  assignments: Assignment[];
  doubleBookedCount: number;
}) {
  const total = assignments.reduce(
    (sum, a) => sum + a.directorIds.length + a.volunteerIds.length,
    0,
  );
  const emptyDays = assignments.filter(
    (a) => a.directorIds.length === 0 && a.volunteerIds.length === 0,
  ).length;
  const avg = (total / assignments.length).toFixed(1);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
      <Stat label="Shifts assigned" value={String(total)} />
      <Stat label="Avg per Saturday" value={avg} />
      <Stat label="Saturdays with 0 assignments" value={String(emptyDays)} />
      <Stat label="People double-booked" value={String(doubleBookedCount)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-slate-500">{label}</div>
    </div>
  );
}
```

- [ ] **Step 3: `ViewToggle`**

```tsx
// src/app/components/schedule/ViewToggle.tsx
export type ViewMode = "saturday" | "grid";

export function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="inline-flex border border-slate-300 rounded-lg overflow-hidden">
      {(["saturday", "grid"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === m ? "bg-[#0F4D92] text-white" : "bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {m === "saturday" ? "Saturday" : "Full grid"}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `SubmittedView`**

```tsx
// src/app/components/SubmittedView.tsx
import { Lock } from "lucide-react";

export function SubmittedView({ deptName, submittedAt }: { deptName: string; submittedAt: string | null }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 text-amber-900">
      <Lock className="w-5 h-5 mt-0.5" />
      <div>
        <div className="font-semibold">Schedule locked</div>
        <div className="text-sm">
          {deptName} was submitted {submittedAt ? new Date(submittedAt).toLocaleString() : "earlier"}. Edits are read-only — contact the IT department to unlock.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire it all into `ScheduleBuilder`**

```tsx
// src/app/components/ScheduleBuilder.tsx
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { DirectorIdentity, ScheduleResponse } from "@/api/types";
import { DepartmentSwitcher } from "./schedule/DepartmentSwitcher";
import { StatsBar } from "./schedule/StatsBar";
import { ViewToggle, type ViewMode } from "./schedule/ViewToggle";
import { SubmittedView } from "./SubmittedView";

export function ScheduleBuilder({ identity }: { identity: DirectorIdentity }) {
  const [selectedDeptId, setSelectedDeptId] = useState(identity.departments[0]?.id ?? "");
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("saturday");

  useEffect(() => {
    if (!selectedDeptId) return;
    setLoading(true);
    api
      .schedule(selectedDeptId, identity.person.netid, identity.person.email)
      .then(setData)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedDeptId, identity.person.netid, identity.person.email]);

  const doubleBookedCount = useMemo(() => {
    if (!data) return 0;
    const set = new Set<string>();
    for (const p of [...data.roster.directors, ...data.roster.volunteers]) {
      if (p.conflicts.sameDay.length > 0 || p.conflicts.crossTerm.length > 0) {
        set.add(p.id);
      }
    }
    return set.size;
  }, [data]);

  if (loading || !data) {
    return (
      <div className="bg-white rounded-xl p-8 shadow-lg">
        <p className="text-slate-500">Loading {selectedDeptId}…</p>
      </div>
    );
  }

  const submitted = data.department.scheduleStatus === "Submitted";

  return (
    <div className="bg-white rounded-xl p-6 sm:p-8 shadow-lg space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-sm">Department:</span>
          <DepartmentSwitcher
            departments={identity.departments}
            selectedId={selectedDeptId}
            onSelect={setSelectedDeptId}
          />
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              submitted ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {data.department.scheduleStatus}
          </span>
        </div>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <StatsBar assignments={data.assignments} doubleBookedCount={doubleBookedCount} />

      {submitted && <SubmittedView deptName={data.department.name} submittedAt={data.department.submittedAt} />}

      <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center text-slate-400">
        {mode === "saturday" ? "Saturday view goes here (next task)" : "Grid view goes here (next task)"}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Manual verification**

Run `npm run dev`. Sign in as a director. The schedule shell renders: dept switcher (single-dept directors see plain text), stats bar with zeros, view toggle. No actual schedule yet.

- [ ] **Step 7: Commit**

```bash
git add clinic-schedule-portal/src/app/components
git commit -m "feat(portal): schedule shell with switcher, stats, view toggle"
```

---

### Task 19: `SaturdayView` with checkbox lists + override section

**Files:**
- Create: `clinic-schedule-portal/src/app/components/schedule/SaturdayView.tsx`
- Create: `clinic-schedule-portal/src/app/components/schedule/PersonRow.tsx`
- Create: `clinic-schedule-portal/src/app/components/schedule/ConflictBadge.tsx`
- Modify: `clinic-schedule-portal/src/app/components/ScheduleBuilder.tsx`

- [ ] **Step 1: `ConflictBadge`**

```tsx
// src/app/components/schedule/ConflictBadge.tsx
import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import type { Person } from "@/api/types";

export function ConflictBadge({ person }: { person: Person }) {
  const { sameDay, crossTerm } = person.conflicts;
  if (!sameDay.length && !crossTerm.length) return null;
  const color = sameDay.length ? "bg-red-500" : "bg-amber-400";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-block w-2.5 h-2.5 rounded-full ${color}`}
          aria-label="conflict details"
        />
      </PopoverTrigger>
      <PopoverContent className="text-sm w-64">
        {sameDay.length > 0 && (
          <div className="text-red-700">
            <div className="font-semibold mb-1">Same-day conflict</div>
            <ul>
              {sameDay.map((c, i) => (
                <li key={i}>
                  {c.date} → {c.otherDept}
                </li>
              ))}
            </ul>
          </div>
        )}
        {crossTerm.length > 0 && (
          <div className="text-amber-700 mt-2">
            <div className="font-semibold mb-1">Cross-term conflict</div>
            <ul>
              {crossTerm.map((c, i) => (
                <li key={i}>
                  {c.date} → {c.otherDept}
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: `PersonRow`**

```tsx
// src/app/components/schedule/PersonRow.tsx
import type { Person } from "@/api/types";
import { ConflictBadge } from "./ConflictBadge";

export function PersonRow({
  person,
  isAvailable,
  isAssigned,
  disabled,
  onToggle,
}: {
  person: Person;
  isAvailable: boolean;
  isAssigned: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-slate-50"
      } ${!isAvailable ? "text-slate-500" : ""}`}
    >
      <input
        type="checkbox"
        checked={isAssigned}
        disabled={disabled}
        onChange={onToggle}
        className="w-4 h-4 accent-[#0F4D92]"
      />
      <span className="flex-1">{person.name || person.netid}</span>
      {!isAvailable && (
        <span className="text-xs text-slate-400">not avail</span>
      )}
      <ConflictBadge person={person} />
    </label>
  );
}
```

- [ ] **Step 3: `SaturdayView`**

```tsx
// src/app/components/schedule/SaturdayView.tsx
import { useMemo, useState } from "react";
import type { Person, Assignment } from "@/api/types";
import { PersonRow } from "./PersonRow";

export function SaturdayView({
  dates,
  directors,
  volunteers,
  assignments,
  disabled,
  onToggle,
}: {
  dates: { iso: string; display: string }[];
  directors: Person[];
  volunteers: Person[];
  assignments: Assignment[];
  disabled: boolean;
  onToggle: (date: string, kind: "director" | "volunteer", personId: string) => void;
}) {
  const [activeIso, setActiveIso] = useState(dates[0]?.iso ?? "");
  const assignmentByIso = useMemo(
    () => Object.fromEntries(assignments.map((a) => [a.date, a])),
    [assignments],
  );
  const active = assignmentByIso[activeIso] ?? { date: activeIso, directorIds: [], volunteerIds: [] };

  function tabHasAssignments(iso: string) {
    const a = assignmentByIso[iso];
    return !!a && (a.directorIds.length + a.volunteerIds.length > 0);
  }

  function column(
    title: string,
    people: Person[],
    kind: "director" | "volunteer",
    assignedIds: string[],
  ) {
    const available = people.filter((p) => p.available.includes(activeIso));
    const unavailable = people.filter((p) => !p.available.includes(activeIso));

    return (
      <div>
        <h3 className="font-semibold text-slate-700 mb-2">
          {title} ({available.length} of {people.length} available)
        </h3>
        <div className="space-y-1">
          {available.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              isAvailable
              isAssigned={assignedIds.includes(p.id)}
              disabled={disabled}
              onToggle={() => onToggle(activeIso, kind, p.id)}
            />
          ))}
        </div>
        {unavailable.length > 0 && (
          <details className="mt-3">
            <summary className="text-sm text-slate-500 cursor-pointer">
              {unavailable.length} not available this date
            </summary>
            <div className="space-y-1 mt-2">
              {unavailable.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  isAvailable={false}
                  isAssigned={assignedIds.includes(p.id)}
                  disabled={disabled}
                  onToggle={() => onToggle(activeIso, kind, p.id)}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto pb-2">
        {dates.map((d) => (
          <button
            key={d.iso}
            onClick={() => setActiveIso(d.iso)}
            className={`flex-shrink-0 px-3 py-1.5 text-sm rounded-full border transition-colors ${
              activeIso === d.iso
                ? "bg-[#0F4D92] text-white border-[#0F4D92]"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {d.display}
            {tabHasAssignments(d.iso) && (
              <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {column("Directors", directors, "director", active.directorIds)}
        {column("Volunteers", volunteers, "volunteer", active.volunteerIds)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `ScheduleBuilder` to render `SaturdayView`**

In `ScheduleBuilder.tsx`, replace the dashed-border placeholder with:

```tsx
import { SaturdayView } from "./schedule/SaturdayView";

// inside the component, near the bottom:
const handleToggle = (_date: string, _kind: "director" | "volunteer", _personId: string) => {
  // wired in Task 20
};

return (
  // ... existing JSX above
  mode === "saturday" ? (
    <SaturdayView
      dates={data.dates}
      directors={data.roster.directors}
      volunteers={data.roster.volunteers}
      assignments={data.assignments}
      disabled={submitted || !data.callerIsDeptDirector}
      onToggle={handleToggle}
    />
  ) : (
    <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center text-slate-400">
      Grid view goes here (next task)
    </div>
  )
);
```

- [ ] **Step 5: Manual verification**

Run `npm run dev`. Sign in. The Saturday view renders date tabs, two columns, and checkboxes (clicking them does nothing yet — wired next).

- [ ] **Step 6: Commit**

```bash
git add clinic-schedule-portal/src/app/components
git commit -m "feat(portal): saturday view with conflict badges"
```

---

### Task 20: Wire `SaturdayView` toggles to `/assignment` with debounce + optimistic UI

**Files:**
- Modify: `clinic-schedule-portal/src/app/components/ScheduleBuilder.tsx`
- Create: `clinic-schedule-portal/src/lib/useDebouncedSaver.ts`

- [ ] **Step 1: Write the debounced-saver hook**

```ts
// src/lib/useDebouncedSaver.ts
import { useEffect, useRef } from "react";

export function useDebouncedSaver<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
  delayMs = 400,
) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, Args>());

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
    };
  }, []);

  return function schedule(key: string, ...args: Args) {
    pending.current.set(key, args);
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(
      key,
      setTimeout(async () => {
        const args = pending.current.get(key);
        if (!args) return;
        pending.current.delete(key);
        timers.current.delete(key);
        await fn(...args);
      }, delayMs),
    );
  };
}
```

- [ ] **Step 2: Use it in `ScheduleBuilder`**

Replace the entire `ScheduleBuilder` component body with this fuller version:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Assignment, DirectorIdentity, ScheduleResponse } from "@/api/types";
import { DepartmentSwitcher } from "./schedule/DepartmentSwitcher";
import { StatsBar } from "./schedule/StatsBar";
import { ViewToggle, type ViewMode } from "./schedule/ViewToggle";
import { SaturdayView } from "./schedule/SaturdayView";
import { SubmittedView } from "./SubmittedView";
import { useDebouncedSaver } from "@/lib/useDebouncedSaver";

export function ScheduleBuilder({ identity }: { identity: DirectorIdentity }) {
  const [selectedDeptId, setSelectedDeptId] = useState(identity.departments[0]?.id ?? "");
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("saturday");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    if (!selectedDeptId) return;
    setLoading(true);
    api
      .schedule(selectedDeptId, identity.person.netid, identity.person.email)
      .then(setData)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedDeptId, identity.person.netid, identity.person.email]);

  useEffect(() => {
    reload();
  }, [reload]);

  // refresh on focus
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") reload();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reload]);

  const persist = useDebouncedSaver(async (assignment: Assignment, deptId: string) => {
    setSaving(true);
    try {
      await api.assign({
        callerNetid: identity.person.netid,
        callerEmail: identity.person.email,
        departmentId: deptId,
        date: assignment.date,
        directorIds: assignment.directorIds,
        volunteerIds: assignment.volunteerIds,
      });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
      reload(); // revert by reloading server truth
    } finally {
      setSaving(false);
    }
  });

  const doubleBookedCount = useMemo(() => {
    if (!data) return 0;
    const set = new Set<string>();
    for (const p of [...data.roster.directors, ...data.roster.volunteers]) {
      if (p.conflicts.sameDay.length || p.conflicts.crossTerm.length) set.add(p.id);
    }
    return set.size;
  }, [data]);

  function handleToggle(date: string, kind: "director" | "volunteer", personId: string) {
    if (!data) return;
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ScheduleResponse;
      const a = next.assignments.find((x) => x.date === date);
      if (!a) return prev;
      const list = kind === "director" ? a.directorIds : a.volunteerIds;
      const idx = list.indexOf(personId);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(personId);
      persist(`${date}`, { ...a }, next.department.id);

      // same-day conflict warning
      const person = [...next.roster.directors, ...next.roster.volunteers].find((p) => p.id === personId);
      const newlyAdded = idx < 0;
      if (newlyAdded && person) {
        const sameDay = person.conflicts.sameDay.find((c) => c.date === date);
        if (sameDay) {
          toast.warning(`Conflict — ${person.name} is already on ${sameDay.otherDept} this Saturday.`);
        } else if (!person.available.includes(date)) {
          toast.message(`Heads up — ${person.name} didn't mark ${date} available.`);
        }
      }
      return next;
    });
  }

  if (loading || !data) {
    return <div className="bg-white rounded-xl p-8 shadow-lg text-slate-500">Loading…</div>;
  }

  const submitted = data.department.scheduleStatus === "Submitted";

  return (
    <div className="bg-white rounded-xl p-6 sm:p-8 shadow-lg space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-sm">Department:</span>
          <DepartmentSwitcher
            departments={identity.departments}
            selectedId={selectedDeptId}
            onSelect={setSelectedDeptId}
          />
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              submitted ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {data.department.scheduleStatus}
          </span>
          {saving && <span className="text-xs text-slate-500">Saving…</span>}
        </div>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <StatsBar assignments={data.assignments} doubleBookedCount={doubleBookedCount} />

      {submitted && (
        <SubmittedView deptName={data.department.name} submittedAt={data.department.submittedAt} />
      )}

      {mode === "saturday" ? (
        <SaturdayView
          dates={data.dates}
          directors={data.roster.directors}
          volunteers={data.roster.volunteers}
          assignments={data.assignments}
          disabled={submitted || !data.callerIsDeptDirector}
          onToggle={handleToggle}
        />
      ) : (
        <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center text-slate-400">
          Grid view goes here (next task)
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Sign in. Toggle a checkbox. Within ~400ms a "Saving…" indicator appears, then disappears. Reload the page — your toggle persists. Confirm the row appears in `SU 26 Schedule` in Airtable.

Toggle off the same checkbox — observe the same row update (no duplicates). Confirm conflict toast fires when assigning a person already booked elsewhere on the same date.

- [ ] **Step 4: Commit**

```bash
git add clinic-schedule-portal/src/lib clinic-schedule-portal/src/app/components/ScheduleBuilder.tsx
git commit -m "feat(portal): debounced auto-save with optimistic updates"
```

---

### Task 21: `GridView` component

**Files:**
- Create: `clinic-schedule-portal/src/app/components/schedule/GridView.tsx`
- Modify: `clinic-schedule-portal/src/app/components/ScheduleBuilder.tsx`

- [ ] **Step 1: Implement `GridView`**

```tsx
// src/app/components/schedule/GridView.tsx
import { useMemo } from "react";
import type { Assignment, Person } from "@/api/types";

type Props = {
  dates: { iso: string; display: string }[];
  directors: Person[];
  volunteers: Person[];
  assignments: Assignment[];
  disabled: boolean;
  onToggle: (date: string, kind: "director" | "volunteer", personId: string) => void;
};

export function GridView({ dates, directors, volunteers, assignments, disabled, onToggle }: Props) {
  const byDate = useMemo(
    () => Object.fromEntries(assignments.map((a) => [a.date, a])),
    [assignments],
  );

  function cell(person: Person, kind: "director" | "volunteer", iso: string) {
    const a = byDate[iso];
    const assignedIds = kind === "director" ? a?.directorIds ?? [] : a?.volunteerIds ?? [];
    const assigned = assignedIds.includes(person.id);
    const available = person.available.includes(iso);
    const sameDayConflict = person.conflicts.sameDay.some((c) => c.date === iso);
    const sym = assigned ? "●" : available ? "○" : "—";
    const color = sameDayConflict
      ? "text-red-600"
      : assigned
      ? "text-emerald-600"
      : available
      ? "text-slate-700"
      : "text-slate-300";

    return (
      <button
        key={`${person.id}-${iso}`}
        disabled={disabled}
        onClick={() => onToggle(iso, kind, person.id)}
        className={`w-8 h-8 flex items-center justify-center text-sm rounded hover:bg-slate-100 disabled:cursor-not-allowed ${color}`}
        title={
          sameDayConflict
            ? "Same-day conflict in another dept"
            : assigned
            ? "Assigned"
            : available
            ? "Available"
            : "Not available"
        }
      >
        {sym}
      </button>
    );
  }

  function row(person: Person, kind: "director" | "volunteer") {
    return (
      <tr key={person.id}>
        <th scope="row" className="text-left sticky left-0 bg-white pr-3 py-1 text-sm font-normal">
          {person.name || person.netid}
        </th>
        {dates.map((d) => (
          <td key={d.iso} className="text-center">
            {cell(person, kind, d.iso)}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left sticky left-0 bg-white pr-3 pb-2"></th>
            {dates.map((d) => (
              <th key={d.iso} className="px-1 pb-2 font-medium text-slate-500">
                <div className="rotate-[-60deg] origin-bottom-left w-8 whitespace-nowrap">
                  {d.display}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-xs font-semibold text-slate-500 pt-2 pb-1" colSpan={dates.length + 1}>
              Directors
            </td>
          </tr>
          {directors.map((p) => row(p, "director"))}
          <tr>
            <td className="text-xs font-semibold text-slate-500 pt-3 pb-1" colSpan={dates.length + 1}>
              Volunteers
            </td>
          </tr>
          {volunteers.map((p) => row(p, "volunteer"))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 mt-3">
        ● assigned &nbsp; ○ available &nbsp; — not available &nbsp; <span className="text-red-600">●/○ in red</span> = same-day conflict in another dept
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Wire it up in `ScheduleBuilder`**

Replace the grid placeholder in `ScheduleBuilder.tsx` with:

```tsx
import { GridView } from "./schedule/GridView";

// in the JSX:
mode === "grid" ? (
  <GridView
    dates={data.dates}
    directors={data.roster.directors}
    volunteers={data.roster.volunteers}
    assignments={data.assignments}
    disabled={submitted || !data.callerIsDeptDirector}
    onToggle={handleToggle}
  />
) : null;
```

(Adjust the JSX from Task 20 so it conditionally renders `SaturdayView` *or* `GridView` based on `mode`.)

- [ ] **Step 3: Manual verification**

Toggle the view → "Full grid". Confirm matrix renders with the right symbols, conflicts highlight in red, clicking cells produces the same upsert behavior as the Saturday view.

- [ ] **Step 4: Commit**

```bash
git add clinic-schedule-portal/src/app/components
git commit -m "feat(portal): grid view sharing the same toggle handler"
```

---

### Task 22: `SubmitModal` + submit flow

**Files:**
- Create: `clinic-schedule-portal/src/app/components/schedule/SubmitModal.tsx`
- Modify: `clinic-schedule-portal/src/app/components/ScheduleBuilder.tsx`

- [ ] **Step 1: Implement `SubmitModal`**

```tsx
// src/app/components/schedule/SubmitModal.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";

export function SubmitModal({
  open,
  deptName,
  totalShifts,
  emptyDays,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  deptName: string;
  totalShifts: number;
  emptyDays: number;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit {deptName} schedule for SU 26?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            You're about to lock all 18 Saturdays for <strong>{deptName}</strong>. After this,
            the schedule becomes read-only — IT can unlock if needed.
          </p>
          <ul className="bg-slate-50 rounded-md p-3 list-disc list-inside text-slate-700">
            <li>{totalShifts} total shifts assigned</li>
            <li>{emptyDays} Saturdays with no assignments</li>
          </ul>
          {emptyDays > 0 && (
            <p className="text-amber-700 text-sm">
              Heads up — you have {emptyDays} Saturday{emptyDays === 1 ? "" : "s"} with no assignments. You can still submit.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-[#0F4D92] text-white rounded-md hover:bg-[#0B3D75] disabled:opacity-50"
          >
            {loading ? "Submitting…" : "Submit and lock"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire it into `ScheduleBuilder`**

Add to the imports:

```tsx
import { SubmitModal } from "./schedule/SubmitModal";
```

Add state and a handler:

```tsx
const [submitOpen, setSubmitOpen] = useState(false);
const [submitLoading, setSubmitLoading] = useState(false);
const totalShifts = data.assignments.reduce(
  (sum, a) => sum + a.directorIds.length + a.volunteerIds.length,
  0,
);
const emptyDays = data.assignments.filter(
  (a) => a.directorIds.length === 0 && a.volunteerIds.length === 0,
).length;

async function handleSubmit() {
  setSubmitLoading(true);
  try {
    await api.submit(data!.department.id, identity.person.netid, identity.person.email);
    toast.success("Schedule submitted.");
    setSubmitOpen(false);
    reload();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    setSubmitLoading(false);
  }
}
```

Add a submit button at the bottom of the JSX (above the closing `</div>`):

```tsx
{!submitted && data.callerIsDeptDirector && (
  <div className="flex justify-end pt-4 border-t border-slate-200">
    <button
      onClick={() => setSubmitOpen(true)}
      className="px-4 py-2 bg-[#0F4D92] text-white rounded-md font-medium hover:bg-[#0B3D75]"
    >
      Submit term schedule
    </button>
  </div>
)}
<SubmitModal
  open={submitOpen}
  deptName={data.department.name}
  totalShifts={totalShifts}
  emptyDays={emptyDays}
  loading={submitLoading}
  onCancel={() => setSubmitOpen(false)}
  onConfirm={handleSubmit}
/>
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Sign in to a Draft dept. The submit button shows. Click it → modal appears with stats. Click "Submit and lock" → modal closes, toast fires, schedule reloads in locked state. The Airtable `SU 26` row's `Schedule Status` flips to `Submitted`.

After unlocking manually in Airtable (set status back to `Draft`), the portal re-enables on next reload.

- [ ] **Step 4: Commit**

```bash
git add clinic-schedule-portal/src/app/components
git commit -m "feat(portal): submit modal + lock flow"
```

---

## Phase 4 — End-to-end verification

### Task 23: Manual end-to-end smoke protocol

**Files:** None — this is a documented run-through.

- [ ] **Step 1: Provision a clean test department in Airtable**

In `SU 26`, create a temporary department `TEST-Z` with two directors (yourself + one teammate) and 4-6 linked volunteers from `All People` who have submitted availability in the volunteer base. Reset `Schedule Status` to `Draft`.

- [ ] **Step 2: Walk through each step**

For each item, verify the listed expected behavior:

1. Visit the portal URL in an incognito window → setup wizard appears (if first run).
2. Save config → lookup screen appears.
3. Submit your NetID + email → schedule screen loads for `TEST-Z`.
4. Stats bar shows zero shifts assigned, 18 empty Saturdays, zero double-booked.
5. Saturday view shows date tabs and two columns. Click "May 30th".
6. Check 2 directors and 3 volunteers → toasts confirm saves; Airtable row appears in `SU 26 Schedule`.
7. Toggle to "Full grid" → cells reflect assignments.
8. Click a volunteer's empty cell on `June 6th` in the grid → toast/save; Airtable row created.
9. Open Airtable manually and assign one of the volunteers to another department's schedule on `May 30th` → reload the portal → red conflict dot appears next to that volunteer's name; popover shows the other dept.
10. Click "Submit term schedule" → modal opens; confirm; schedule flips to locked state.
11. Try toggling a checkbox in locked state → toast: "Schedule already submitted."
12. Manually flip `Schedule Status` back to `Draft` in Airtable → reload → portal re-enables.

- [ ] **Step 3: Clean up**

Delete the `TEST-Z` department row, the related `SU 26 Schedule` rows, and (if used) any test entries you made on real departments. Reset `Schedule Status` on touched departments back to `Draft`.

- [ ] **Step 4: Commit a short "verified" note**

```bash
git commit --allow-empty -m "chore: e2e smoke test passed against live Airtable"
```

---

## Self-review checklist

After all 23 tasks are complete, the engineer should confirm:

- [ ] Every spec section maps to at least one task. Review `docs/superpowers/specs/2026-05-20-clinic-schedule-portal-design.md` side by side. The expected mapping:
  - Auth model → Tasks 8, 9, 12, 13 (re-verification on every mutating call).
  - Live cross-base join → Tasks 7, 9.
  - Saturday view + grid view → Tasks 19, 21.
  - Cross-dept conflicts → Tasks 10, 11, plus UI in Tasks 19, 21.
  - Submission lock → Tasks 1 (schema), 13 (server), 22 (UI).
  - Failure modes table → Task 7 (retry), Task 20 (revert on save fail).
- [ ] `npm test` passes inside `clinic-schedule-portal/`.
- [ ] `npm run build` produces a `dist/` with no TypeScript errors.
- [ ] The Edge Function endpoints respond as expected when hit with curl (Task 23 smoke).
- [ ] No `TODO` / `FIXME` comments left in the source.

---

## Risks and follow-ups (informational, not part of this plan)

These are noted in the spec under "Out of scope" but worth re-iterating so the implementer doesn't get blindsided:

- **No admin / board override role.** If a department's directors never log in, an admin has to unlock the row in Airtable directly to make changes. Acceptable for v1.
- **Trust-based auth.** Anyone with a valid director's NetID + email can edit their schedule. If this becomes a problem, add a signed session token in v2.
- **Cross-base PAT.** A single PAT must have read scopes on all three bases. If the recruitment bases are owned by different workspaces, this may require a token from someone with broader access than the portal's deployer.
