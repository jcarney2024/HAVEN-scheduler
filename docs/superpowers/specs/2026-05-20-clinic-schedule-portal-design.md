# SU 26 Clinic Schedule Portal — Design

**Date:** 2026-05-20
**Status:** Approved for implementation plan

## Purpose

A web portal that lets HAVEN Free Clinic department directors build their summer 2026 (SU 26) Saturday clinic schedule. Volunteers and directors already submitted their term availability via separate Airtable application forms. The portal's job is to surface that availability and let directors assign people to specific clinic Saturdays, with results written back to a new schedule table in HAVEN Management Airtable.

It is the second HAVEN staff-facing portal; it shares the architecture and visual language of the existing Member Information Update Form portal (React + Vite + Tailwind + shadcn/ui frontend, Supabase Edge Function backend, Airtable as the system of record).

## Scope

### In scope (v1)
- NetID + email authentication against the existing `All People` table.
- Per-director access scoping: a director can **edit** their own department's schedule and **view** every other department's schedule read-only.
- Assignment of directors and volunteers to specific clinic Saturdays (flat list, no internal shift slots, no per-Saturday quotas).
- Live cross-base availability join: read directly from Director Recruitment + Volunteer Recruitment bases at session start (no precomputed sync into All People).
- Two views over the same data: Saturday-by-Saturday card stack (primary) and full-term grid (toggle).
- Per-department single-submission lock for the whole term.
- Cross-department conflict detection (same-day red flag + cross-term amber flag).
- Setup wizard for initial configuration (Airtable base IDs and table names).

### Out of scope (v1)
- Admin-level override role (e.g., president edits any dept).
- Email notifications on submit (can be bolted on via an Airtable automation later).
- Mutating availability through the portal — applicants own that data in the application bases.
- Multi-term reuse — table names are hard-coded to SU 26 for this build; the next term will be a quick rename.

## Data sources

Three Airtable bases participate. The portal's Edge Function has a single Airtable PAT with read access to all three; write access only to HAVEN Management.

### HAVEN Management — `appkxTQ19GmaHgW1O` (read + write)

- **`All People`** (`tblnHgBpknuqWvx9c`) — master person registry. The portal reads `Name`, `NetID`, `Contact Email`, `Role`, `Department`. It does not modify this table.
- **`SU 26`** (`tbl2VrP1uqwFt7QNQ`) — one row per department. Fields used: `Department Name` (primary), `Directors` (linked → All People), `Volunteers` (linked → All People). The portal will add three new fields: `Schedule Status` (singleSelect: `Draft`/`Submitted`), `Submitted At` (dateTime), `Submitted By` (linked → All People).
- **`SU 26 Schedule`** (new table — needs to be created) — one row per (department × Saturday). Schema:

  | Field | Type | Notes |
  |---|---|---|
  | Name | formula | `{Department} & " — " & {Date}` |
  | Department | linked → `SU 26` | the dept |
  | Date | singleSelect | the 18 Saturdays (`May 30th` … `September 26th`) |
  | Directors on Shift | linked → `All People` (multi) | who's directing |
  | Volunteers on Shift | linked → `All People` (multi) | who's volunteering |
  | Last Modified | lastModifiedTime | audit |
  | Last Modified By | lastModifiedBy | audit |

  The existing `SU 26 (Director)` and `SU 26 (Volunteer)` link fields on All People reverse-link into this table.

### Director Recruitment — `app6MHzSA1yPej2zX` (read-only)

- **`Applications`** (`tbluFoybFPBjBAXyk`) — `Yale NetID`, `What is your spring availability?` (multipleSelects, 15 dates May 30 → Sept 5). Join key: lowercased NetID.

### Volunteer Recruitment — `appOq1yOiA1Lfzq8L` (read-only)

- **`SU-26 Volunteer Applicants`** (`tblV3UrQQvIIZzFTU`) — `NetID`, `General Availability` (multipleSelects, 18 dates May 30 → Sept 26). Join key: lowercased NetID.

### Canonical date list

Both feeds map to a single backend list of 18 ISO dates:
`2026-05-30, 2026-06-06, 2026-06-13, 2026-06-20, 2026-06-27, 2026-07-04, 2026-07-11, 2026-07-18, 2026-07-25, 2026-08-01, 2026-08-08, 2026-08-15, 2026-08-22, 2026-08-29, 2026-09-05, 2026-09-12, 2026-09-19, 2026-09-26`.

- The volunteer feed's `"June 6th"` and the director feed's `"June 6"` both normalize to `2026-06-06`.
- The director feed has no options past Sept 5, so backend treats Sept 12/19/26 as "no director availability data" rather than "unavailable" — UI flags those dates explicitly.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React + Vite + Tailwind + shadcn/ui)              │
│  ┌─────────┐ ┌─────────┐ ┌────────────────┐ ┌────────────┐ │
│  │ Setup   │ │ Lookup  │ │ Schedule       │ │ Submitted/ │ │
│  │ Wizard  │ │         │ │ Builder        │ │ Locked     │ │
│  └─────────┘ └─────────┘ └────────────────┘ └────────────┘ │
└────────────────────────────────┬────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase Edge Function  (make-server-clinic-schedule)      │
│   GET  /director/:netid                                     │
│   GET  /schedule/:dept                                      │
│   POST /assignment                                          │
│   POST /submit/:dept                                        │
│   GET  /config            POST /config                      │
│   GET  /bases             POST /tables                      │
│                                                             │
│  Holds Airtable PAT (env var) — client never sees it.       │
│  Computes availability join once per /schedule request.     │
└──┬──────────────────────────┬──────────────────────────────┬┘
   │                          │                              │
   ▼                          ▼                              ▼
┌──────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│ HAVEN Management │  │ Director        │  │ Volunteer           │
│ (read + write)   │  │ Recruitment     │  │ Recruitment         │
│                  │  │ (read-only)     │  │ (read-only)         │
└──────────────────┘  └─────────────────┘  └─────────────────────┘
```

The client is stateless aside from the current step + selected dept + cached schedule. All identity, availability, and assignment logic lives in the Edge Function — the browser never holds an Airtable PAT and never makes a cross-base join.

## API contract

All endpoints are under `/make-server-clinic-schedule/`. Auth header: `Bearer <SUPABASE_PUBLIC_ANON_KEY>` (matches the reference portal's pattern).

**Security model:** identical to the reference portal — the Supabase anon key gates the function, NetID + email lookup gates the UX, but mutating endpoints (`/assignment`, `/submit`) trust the client to send the caller's `netid` + `email` and re-verify against All People on every request. There is no session token. Anyone with the URL and a valid NetID/email pair for a SU 26 director can write to that director's department. This matches the reference portal's threat model; stronger auth (signed session, SSO) is explicitly deferred.

### `GET /config` / `POST /config`
Setup wizard for one-time configuration. Stores `{ haveNManagementBaseId, allPeopleTableId, su26RosterTableId, su26ScheduleTableId, directorAppsBaseId, directorAppsTableId, volunteerAppsBaseId, volunteerAppsTableId }` in a Supabase KV key. Mirrors the reference portal's wizard verbatim.

### `GET /director/:netid`
Identity lookup. Body: `{ email }` for verification (matches reference portal's "NetID + email" two-factor lookup).

Returns:
```json
{
  "person": { "id": "rec...", "name": "Amanda Girod", "netid": "ag123", "email": "..." },
  "departments": [
    { "id": "rec...", "name": "LABR", "scheduleStatus": "Draft", "submittedAt": null }
  ]
}
```

Returns `404` if NetID/email don't match an All People row, `403` if the person is not on any `SU 26.Directors` list.

### `GET /schedule/:dept`
Returns everything needed to render one department's schedule builder.

```json
{
  "department": { "id": "rec...", "name": "LABR", "scheduleStatus": "Draft" },
  "dates": [
    { "iso": "2026-05-30", "display": "May 30th" },
    ...18 entries...
  ],
  "roster": {
    "directors": [
      {
        "id": "rec...", "netid": "ag123", "name": "Amanda Girod",
        "available": ["2026-05-30", "2026-06-06", ...],
        "conflicts": {
          "sameDay": [{ "date": "2026-06-13", "otherDept": "SCTS" }],
          "crossTerm": [{ "date": "2026-07-18", "otherDept": "JCTS" }]
        }
      }
    ],
    "volunteers": [ /* same shape */ ]
  },
  "assignments": [
    { "date": "2026-05-30", "directorIds": ["rec..."], "volunteerIds": ["rec...", "rec..."] }
  ]
}
```

`conflicts` is computed by scanning all `SU 26 Schedule` rows for each person's NetID outside this department.

### `POST /assignment`
Upsert one (dept, date) row in `SU 26 Schedule`.

Request:
```json
{
  "callerNetid": "ag123",
  "callerEmail": "amanda.girod@yale.edu",
  "departmentId": "rec...",
  "date": "2026-06-13",
  "directorIds": ["rec...", "rec..."],
  "volunteerIds": ["rec...", "rec...", "rec..."]
}
```

Behavior: re-verify caller against All People → re-verify caller is on `SU 26.LABR.Directors` → PATCH if a row already exists for this (dept, date), else CREATE.
- Returns `403` if the caller can't be verified or isn't on the department's `Directors`.
- Returns `409` if the department's `Schedule Status = Submitted`.

### `POST /submit/:dept`
Body: `{ callerNetid, callerEmail }`. Re-verifies caller is a director on this dept; sets `Schedule Status = Submitted`, `Submitted At`, `Submitted By` on the `SU 26` roster row. Returns `403` on verify failure, `409` if already submitted.

## UI design

### Shell (all screens)

- Blue/white HAVEN branding from the reference portal: bg image with `#0F4D92` overlay at 80%, white logo header, Sonner toaster top-center, motion `AnimatePresence` page transitions.
- Footer matches reference portal verbatim.

### Screens

**Loading** — same as reference portal (spinner + "Loading…"). Checks `/config`; if URL path has a slug, attempts `/director/:slug` directly.

**Setup wizard** — three preset base IDs (HAVEN Management, Director Recruitment, Volunteer Recruitment) filled in by default, with table dropdowns populated by `/tables`. Save button → switches to normal mode. Visible only when no config exists.

**Lookup** — NetID + email form. On submit, calls `/director/:netid` with `{ email }`. On 404/403 shows appropriate error toast.

**Schedule Builder** — the main screen. Layout (top → bottom):

1. **Header strip**: department dropdown (visible only if director has more than one dept), schedule status pill (`Draft` / `Submitted`), "Hi, {firstName}" with sign-out.
2. **Stats bar**: total shifts assigned this term, average per Saturday, count of Saturdays with zero assignments, count of people double-booked across depts.
3. **View toggle**: `Saturday` (default) / `Full grid`.
4. **Saturday view**:
   - Horizontal scrolling date tabs (18 dates). Active date highlighted. Dot indicator on dates with ≥1 assignment.
   - Two columns: "Directors available (N of M)" with checkbox list, "Volunteers available (N of M)" with checkbox list.
   - Unavailable people appear in a collapsed `Not available this date` section with an "override" button per person — clicking moves them above and ticks the checkbox.
   - Person rows show a conflict icon (red dot = same-day, amber dot = cross-term) when applicable; clicking shows the conflict detail in a popover.
5. **Grid view**: rows = roster (directors first), columns = 18 Saturdays. Cells: filled circle (assigned), hollow circle (available, not assigned), em-dash (unavailable). Click a cell to toggle. Conflict dots overlay the cell on same-day clashes.
6. **Submit button** at the bottom: enabled when `Schedule Status = Draft`. Opens a confirmation modal ("Submit LABR schedule for the term? This will lock all 18 Saturdays — admin can unlock"). On confirm, calls `/submit/:dept`.

**Submitted / locked** — same layout as schedule builder but checkboxes are disabled and a banner explains the lock state.

### Auto-save and concurrency

- Toggling a checkbox triggers an optimistic UI update + a `POST /assignment` debounced per (dept, date) at ~400 ms. Rapid toggles on the same Saturday coalesce into one write; toggles on different Saturdays flush independently.
- A small "Saved" / "Saving…" indicator appears next to the stats bar.
- On network failure, the optimistic update reverts and a toast fires (`"Couldn't save — try again."`).
- On window focus or visibility change, refetch `/schedule/:dept` so co-directors' edits become visible within a few seconds.
- Concurrent edits are last-write-wins on a per-(dept, date) row basis. Each `POST /assignment` writes the complete director/volunteer list for that row, so two co-directors editing the same Saturday will resolve to whoever clicked most recently. This is acceptable for the expected volume (a single dept has 2–4 directors, edits are infrequent).

## Cross-department conflict detection

Definitions:
- **Same-day conflict (red)**: one person assigned on the same date in two or more departments. Treated as actionable — a real scheduling collision.
- **Cross-term conflict (amber)**: one person assigned to clinic shifts in two or more departments on different dates. Worth flagging; most people commit to one department.

Backend computation lives in `GET /schedule/:dept`. For each person on the dept's roster, scan every other row in `SU 26 Schedule`:
- If any row has the same `Date` and lists this person as director/volunteer → record a same-day conflict.
- Otherwise, if any row lists this person at all (different date) → record a cross-term conflict.

Returned in the `conflicts` block on each person. One extra Airtable list call per `/schedule` load.

UI:
- Conflict dots adjacent to person names; click for a popover with date + other dept.
- When toggling a checkbox creates a *new* same-day conflict, fire a warning toast but allow the write.
- Stats bar shows a running double-booked count.

## Failure modes

| Failure | Handling |
|---|---|
| Airtable 429 rate limit | Edge Function retries with exponential backoff (3 tries, 200/500/1000 ms). |
| Airtable 5xx | Surface a generic "Airtable is unavailable" toast; UI remains usable with cached data. |
| Edge Function cold start | Lookup screen shows existing spinner state — no special handling needed. |
| Network drop mid-toggle | Optimistic update reverts; toast fires; user can retry. |
| Empty roster (no `Directors` linked) | Schedule builder loads with "No directors on this department's roster yet" message. |
| NetID/email mismatch | 404 → "We couldn't find your record. Contact the IT department." |
| Person not a SU 26 director | 403 → "We couldn't find you as a director on any SU 26 department." |
| Submit attempt after lock | 409 → "This schedule is already submitted." |

## File layout

Following the reference portal's structure exactly:

```
clinic-schedule-portal/
├── index.html
├── package.json
├── vite.config.ts
├── postcss.config.mjs
├── README.md
├── ATTRIBUTIONS.md
├── guidelines/Guidelines.md
├── src/
│   ├── main.tsx
│   ├── lib/utils.ts
│   ├── styles/{tailwind,index,fonts,theme}.css
│   └── app/
│       ├── App.tsx                          # top-level step machine
│       └── components/
│           ├── SetupWizard.tsx              # ~clone of reference
│           ├── DirectorLookup.tsx           # ~clone of MemberLookup
│           ├── ScheduleBuilder.tsx          # main screen
│           ├── ScheduleBuilder/
│           │   ├── DepartmentSwitcher.tsx
│           │   ├── StatsBar.tsx
│           │   ├── ViewToggle.tsx
│           │   ├── SaturdayView.tsx
│           │   ├── GridView.tsx
│           │   ├── PersonRow.tsx            # used by both views
│           │   ├── ConflictBadge.tsx
│           │   └── SubmitModal.tsx
│           ├── SubmittedView.tsx            # locked read-only state
│           └── ui/                          # shadcn/ui — same set as reference
├── supabase/
│   └── functions/server/
│       ├── index.tsx                        # Hono routes
│       ├── airtable.ts                      # PAT-authed fetch helpers
│       ├── conflicts.ts                     # cross-dept conflict computation
│       ├── dates.ts                         # canonical date list + normalizers
│       └── kv_store.tsx                     # config persistence
└── utils/supabase/info.tsx                  # projectId + publicAnonKey
```

## Sequence: a director loads and edits one shift

```
Browser                Edge Function           Airtable
   │                        │                     │
   │  GET /config           │                     │
   │ ─────────────────────► │                     │
   │ ◄ configured: true     │                     │
   │                        │                     │
   │  POST /director/ag123  │                     │
   │  {email}               │                     │
   │ ─────────────────────► │  list All People    │
   │                        │ ──────────────────► │
   │                        │  filterByFormula    │
   │                        │ ◄ 1 record          │
   │                        │  list SU 26 roster  │
   │                        │ ──────────────────► │
   │                        │ ◄ depts where dir   │
   │ ◄ {person, depts: [LABR]}                    │
   │                        │                     │
   │  GET /schedule/LABR    │                     │
   │ ─────────────────────► │  list SU 26 roster  │
   │                        │  (LABR row)         │
   │                        │ ──────────────────► │
   │                        │  list Dir Apps      │
   │                        │  (by NetID set)     │
   │                        │ ──────────────────► │
   │                        │  list Vol Apps      │
   │                        │ ──────────────────► │
   │                        │  list SU 26 Sched   │
   │                        │  (all rows)         │
   │                        │ ──────────────────► │
   │                        │  compute conflicts  │
   │ ◄ full schedule payload                      │
   │                        │                     │
   │  User toggles checkbox │                     │
   │  POST /assignment      │                     │
   │ ─────────────────────► │  PATCH or POST      │
   │                        │  SU 26 Schedule row │
   │                        │ ──────────────────► │
   │ ◄ {ok}                 │                     │
```

## Open questions and decisions deferred to plan

- Exact shadcn/ui components to vendor. Default: the same superset the reference portal vendors (~40 components) for visual consistency; the build is tree-shaken so the cost is negligible. Plan can prune if desired.
- Whether to add an admin/board override role in v1.5 — explicitly deferred.
- Whether to surface a "draft saved" indicator beyond the existing "Saving…" / "Saved" microcopy — design says no, plan can revisit if user testing shows confusion.
