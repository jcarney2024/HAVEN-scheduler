# Public Schedule View + Shift Change Requests — Design

**Date:** 2026-05-20
**Status:** Draft (awaiting user review)
**Builds on:** [`2026-05-20-clinic-schedule-portal-design.md`](./2026-05-20-clinic-schedule-portal-design.md)

## Purpose

Extend the SU 26 Clinic Schedule Portal with two new surfaces:

1. A **public, no-login read of a submitted schedule** so anyone with a link can see who's working which clinic Saturday for a given department.
2. A **logged-in self-service flow** that lets any person on the schedule — director or volunteer — submit a request to drop or swap one of their own shifts. Requests are reviewed by the directors who manage that department.

The new requests live in a new Airtable table; Airtable automations on that table will send the corresponding emails (out of scope for the app).

## Scope

### In scope (v2)

- Public, anonymous read-only view of any submitted department schedule at `/view`, with a dropdown to switch between submitted departments. Names + role (director/volunteer) per Saturday only.
- A landing page with two cards: existing director sign-in (unchanged) and a new "View schedules & request a swap" entry to `/view`.
- A new "My Assignments" panel inside `/view` that reveals after NetID + email sign-in, showing the caller's scheduled Saturdays across every department.
- A request form (drop, open swap, or named swap) launched from any of the caller's own assignments.
- A new `SU 26 Shift Requests` table in HAVEN Management, with the schema in *Data sources* below.
- Server-side validation of every request (assigned-on-that-date, role-match for named swaps, no duplicate pending, etc.).
- A "Pending Requests" tab inside the existing director schedule builder, scoped to the active department.
- An "Approve" action that **atomically applies the schedule change** to `SU 26 Schedule` before flipping the request status, and a "Reject" action that just flips status.
- Discovery cues for directors: pending count next to each manageable department in the existing dept switcher, and a count badge on the Pending Requests tab.

### Out of scope (v2)

- Email sending — Airtable automations handle this.
- Sessions/cookies — the caller re-enters NetID + email each visit, same as today.
- A cross-department inbox for admins (ITCM/EXEC) — they still review per-dept via the existing dept switcher.
- A user-visible history of resolved requests — the requester sees their own pending requests only; resolved requests live in Airtable.
- Named-partner email confirmation — the director decides without an explicit partner click-through.
- Cross-department named swaps and cross-role named swaps (volunteer↔director).
- Bulk approve/reject — one request at a time.
- A new authentication mechanism — same `findPerson` (NetID + Contact Email) check as today.

## Data sources

The two existing bases are unchanged. One new table is added to HAVEN Management.

### HAVEN Management — `appkxTQ19GmaHgW1O` (read + write)

Existing tables (`All People`, `SU 26`, `SU 26 Schedule`) are unchanged. Add:

- **`SU 26 Shift Requests`** (new — needs creation; ID exposed as `SU26_SHIFT_REQUESTS_TABLE_ID` env var). One row per request.

  | Field | Type | Notes |
  |---|---|---|
  | `Request ID` | Autonumber | Primary field. Display only. |
  | `Department` | Link → `SU 26` | The department the shift belongs to. |
  | `Requester` | Link → `All People` | The person asking off. |
  | `Requester Email` | Email | Captured at submit time so Airtable automations can address the requester directly. |
  | `Requester Date` | Single select | The Saturday the requester wants to give up. Choices = the clinic Saturday list (same options as `SU 26 Schedule.Date`). |
  | `Target` | Link → `All People` | Optional. Empty = drop / open swap. Present = named swap. |
  | `Target Date` | Single select | Optional. Only meaningful when `Target` is set — the partner's Saturday the requester would take in exchange. |
  | `Type` | Formula | `IF({Target}, "Named swap", "Drop")`. Computed in Airtable for filtering and automation conditions. The app does not write this field. |
  | `Note` | Long text | Optional reason from requester. |
  | `Status` | Single select | `Pending` / `Approved` / `Rejected` / `Withdrawn`. Defaults to `Pending`. |
  | `Resolver` | Link → `All People` | Director who acted. Set on resolve. |
  | `Resolution Note` | Long text | Optional director note on approve/reject. |
  | `Submitted At` | Created time | Auto. |
  | `Resolved At` | Date/time | Set by the app on resolve. |

  Email automations on this table (Airtable side) are configured by the user; the app does not orchestrate them.

### Invariants enforced by the app (not Airtable)

These run server-side at request-creation and request-resolve time:

1. `Requester` must be a current assignee of `Department` on `Requester Date` in `SU 26 Schedule`.
2. For a named swap (`Target` present): `Target` must be a current assignee of `Department` on `Target Date`, and `Target` must share the requester's role on those shifts (director↔director, volunteer↔volunteer).
3. No two `Pending` rows may share `(Requester, Requester Date)` — second submission returns `409`.
4. On `Approve`: re-check #1 and #2 against the **current** `SU 26 Schedule` (the assignment may have changed since submission). Reject the approval with `409 {"error":"Already resolved"}` (or a more specific message) if the underlying schedule has drifted.

## Architecture

No structural changes to the existing stack: Vite SPA + Hono on Vercel + Airtable. The new endpoints are added to the existing Hono `app` in `server/app.ts`; the new UI is added under `src/app/components/view/` and `src/app/components/schedule/`. We do not introduce a router library — the existing `step` state in `App.tsx` is extended with a `"view"` value, and the URL is kept in sync via `history.pushState` so `/` and `/view` are real shareable URLs.

The frontend / backend boundary stays the same: server validates identity per request via `callerNetid` + `callerEmail` in the POST body. The one new public endpoint (`/api/view/...`) is the project's first **unauthenticated** route — it is read-only and exposes only names + role.

## API contract

All new endpoints live under `/api`. Responses are JSON. Error responses use `{ error: string }` to match the existing app's conventions.

### Public (no auth)

#### `GET /api/view`

Returns the list of departments whose `Schedule Status === "Submitted"`. Powers the `/view` dropdown.

```ts
Response 200: Array<{ id: string; name: string }>
```

#### `GET /api/view/:deptId`

Returns the submitted schedule for a department, redacted to names + role per Saturday.

```ts
Response 200: {
  deptName: string;
  submittedAt: string;  // ISO timestamp
  dates: Array<{
    date: string;       // canonical Saturday key (matches existing dates module)
    directors: Array<{ name: string }>;
    volunteers: Array<{ name: string }>;
  }>;
}

Response 403: { error: "Schedule not published" }  // dept exists but Schedule Status !== "Submitted"
Response 404: { error: "Not found" }               // unknown deptId
```

No NetIDs, emails, or applicant IDs in the response. Drafts are not previewable by URL guessing.

### Self-service (caller proves identity via callerNetid + callerEmail)

#### `POST /api/me/assignments`

Returns the caller's scheduled Saturdays across every department, plus any of their own pending requests so the UI can show "pending" badges and "withdraw" affordances.

```ts
Request: { callerNetid: string; callerEmail: string }

Response 200: {
  person: { id: string; name: string; netid: string; email: string };
  assignments: Array<{
    deptId: string;
    deptName: string;
    date: string;        // canonical Saturday key
    role: "director" | "volunteer";
    pendingRequestId: string | null;  // if this person already has a pending request for this exact (deptId, date)
  }>;
}

Response 401: { error: "Unauthorized" }  // findPerson failed
```

#### `POST /api/requests`

Creates a new shift request. Validates all invariants from *Data sources*.

```ts
Request: {
  callerNetid: string;
  callerEmail: string;
  deptId: string;            // must be one of the caller's assigned depts on requesterDate
  requesterDate: string;     // canonical Saturday key
  targetNetid?: string;      // optional — named swap
  targetDate?: string;       // optional, required iff targetNetid is set
  note?: string;
}

Response 201: { id: string; status: "Pending" }

Response 401: { error: "Unauthorized" }
Response 409: { error: "Not assigned to that shift" }
            | { error: "Pending request already exists" }
            | { error: "Partner is not eligible" }
```

#### `POST /api/requests/:id/withdraw`

Only the requester can withdraw, and only while the request is `Pending`. Sets `Status = "Withdrawn"` and `Resolved At = now`.

```ts
Request: { callerNetid: string; callerEmail: string }

Response 200: { id: string; status: "Withdrawn" }
Response 401: { error: "Unauthorized" }
Response 403: { error: "Not your request" }
Response 409: { error: "Already resolved" }
```

### Director-only

#### `POST /api/requests/for-dept/:deptId`

Returns pending requests for a department, plus a short tail of recently-resolved ones (last 14 days) for context. Auth reuses the existing `manageableDeptIdsFor` logic — cross-department managers and ITCM/EXEC admins see what they already manage today.

```ts
Request: { callerNetid: string; callerEmail: string }

Response 200: {
  pending: Array<RequestRow>;
  recent: Array<RequestRow>;
}

// RequestRow shape:
{
  id: string;
  type: "Drop" | "Named swap";
  requester: { id: string; name: string; netid: string; role: "director" | "volunteer" };
  requesterDate: string;
  target: { id: string; name: string; netid: string } | null;
  targetDate: string | null;
  note: string;
  status: "Pending" | "Approved" | "Rejected" | "Withdrawn";
  submittedAt: string;
  resolvedAt: string | null;
  resolver: { id: string; name: string } | null;
}

Response 401: { error: "Unauthorized" }
Response 403: { error: "Not authorized" }
```

#### `POST /api/requests/:id/resolve`

Director approves or rejects a request. On approve, the app applies the schedule change first, then flips status. On reject, just flips status.

```ts
Request: {
  callerNetid: string;
  callerEmail: string;
  action: "approve" | "reject";
  note?: string;
}

Response 200: { id: string; status: "Approved" | "Rejected" }

Response 401: { error: "Unauthorized" }
Response 403: { error: "Not authorized" }
Response 409: { error: "Already resolved" }
            | { error: "Schedule has changed since request was submitted" }
            | { error: "Apply failed"; partial: object }   // see Failure modes
```

### Piggyback on existing endpoint

`POST /api/director/:netid` already returns the director's manageable departments. We extend each entry with a count:

```ts
departments: Array<{
  id: string;
  name: string;
  scheduleStatus: string;
  submittedAt: string | null;
  pendingRequestCount: number;   // NEW — feeds the dept switcher "(N pending)" suffix
}>;
```

This avoids a separate round-trip on portal load.

## UI design

### Landing page (`/`)

Two cards, side by side on desktop, stacked on mobile. Same shell, header, and background as today.

- **Card 1 — Director sign-in** — wraps the existing `DirectorLookup` verbatim. No copy changes.
- **Card 2 — View schedules & request a swap** — single button. Click → `step = "view"` and `history.pushState("/view")`.

The router-light approach: on cold load the URL is read once. `/view` boots straight into `step = "view"`. Anything else (including `/`) renders the existing lookup step.

### `/view`

Two stacked sections inside the existing main shell.

1. **Browse a submitted schedule** (always visible)
   - A `Department` dropdown populated from `GET /api/view` (submitted depts only).
   - On select, calls `GET /api/view/:deptId` and renders the schedule using the existing `SaturdayView` component in a `readOnly` mode (see *File layout*).
   - Empty state when no department is selected.
   - Friendly error state on 403 (`"This schedule hasn't been published yet"`) or 404 (`"Department not found"`).

2. **Need to drop or swap a shift?** (always visible below the public viewer)
   - When signed out: a "Sign in with your NetID + email" affordance — clicking expands a small form. On success, calls `POST /api/me/assignments` and replaces this section with the **My Assignments** panel below.
   - When signed in: shows **My Assignments** — a list of the caller's scheduled Saturdays grouped by department. Each row renders date + role + dept name + a primary `Request swap` button.
   - If the row already has a pending request (`pendingRequestId !== null`), the button changes to `Pending — withdraw` and `View details`.

### Request swap modal

Opened from any My Assignments row. The selected row's date and dept are pre-filled and non-editable in the modal header.

Body:

- Radio group: **"Just drop this shift"** vs **"Swap with a specific person"**.
- If **swap**: a partner picker (Select component) filtered to same dept + same role + has at least one scheduled future Saturday that isn't the requester's date; followed by a partner-date picker showing only that partner's assigned Saturdays.
- Optional note (textarea).
- Submit posts `POST /api/requests`. On success: toast and close modal; My Assignments refetches.

Client-side validation rules: at minimum a partner must be chosen for the named-swap mode; partner date is required when partner is set; partner can't equal self.

### Director portal — Pending Requests tab

Lives inside the existing schedule builder, beside the existing schedule editor tabs. Visible only when the signed-in director manages the active department.

- The tab label shows the count when non-zero: `Pending Requests (3)`.
- The dept switcher shows `(N pending)` next to any department the director manages with at least one pending request.
- Body: list of pending requests for the active dept, each with:
  - Requester name + role.
  - The shift in plain English: "Drop their Sat 10/12 shift" / "Swap their Sat 10/12 for {Partner}'s Sat 10/19".
  - The note, if any.
  - Two buttons: `Approve` (primary) and `Reject` (secondary). Reject opens an inline textarea for an optional resolution note before confirming.
- Empty state: "No pending requests for this department."
- Below the pending list, a small "Recently resolved" section shows the last 14 days' approved/rejected/withdrawn requests for context — read-only, no actions.

After `Approve`, the app refetches `POST /api/schedule/:deptId` so the schedule editor reflects the applied change without reload.

## Approve-applies-edit semantics

This is the only non-trivial server logic.

The approve flow walks `SU 26 Schedule` rows for `(Department, Requester Date)` and (if named) `(Department, Target Date)`, then performs the right sequence of `patchRecord` calls on the `Directors on Shift` / `Volunteers on Shift` linked-record fields:

- **Drop** (`Target` empty): remove `Requester` from the `(Department, Requester Date)` row. Leave the spot empty — the director will fill it later via the normal builder.
- **Named swap** (`Target` and `Target Date` present): remove `Requester` from `(Department, Requester Date)`, add `Target` to that same row, remove `Target` from `(Department, Target Date)`, add `Requester` to that row.

Order of writes matters for rollback. On any failure mid-sequence, the apply step attempts to reverse the prior writes in reverse order. Airtable has no transactions, so this is best-effort. On rollback failure, the request stays in `Pending` and the response includes a structured `partial` object listing which rows were touched and which step failed; the director re-runs after fixing the underlying schedule.

The "apply" function is pure-ish — it takes the in-memory schedule rows and the request shape, returns a planned sequence of `patchRecord` calls, then executes them. This separation makes it trivially unit-testable.

## Failure modes

| Failure | Response | Notes |
|---|---|---|
| Public view of non-existent dept | `404 {"error":"Not found"}` | |
| Public view of non-submitted dept | `403 {"error":"Schedule not published"}` | |
| Caller fails identity check | `401 {"error":"Unauthorized"}` | |
| Request for a date the caller isn't on | `409 {"error":"Not assigned to that shift"}` | |
| Duplicate pending request | `409 {"error":"Pending request already exists"}` | |
| Named partner is not on `Target Date` or wrong role | `409 {"error":"Partner is not eligible"}` | |
| Non-director calls dept endpoints | `403 {"error":"Not authorized"}` | Uses `manageableDeptIdsFor`. |
| Resolver acts on resolved request | `409 {"error":"Already resolved"}` | Lost-update guard. |
| Schedule drifted between submit and approve | `409 {"error":"Schedule has changed since request was submitted"}` | The director sees the message and re-runs. |
| Apply-approved-swap fails partway | `500 {"error":"Apply failed"; "partial": {...}}` plus a structured `console.error` log line | Request stays `Pending`. The director re-approves after fixing the data. |
| Network failure on client | sonner toast with `error.message` | Matches existing pattern. |

## File layout

New files only; existing files are touched but not restructured.

```
api/[...route].ts                                  (no change)
server/
  app.ts                                           (+ 7 new POST/GET routes, + pendingRequestCount on director payload)
  requests.ts                                      NEW — pure validation + apply-plan + apply-executor
  tests/
    requests.validate.test.ts                      NEW
    requests.apply.test.ts                         NEW
    requests.auth.test.ts                          NEW
src/
  api/types.ts                                     (+ types: ShiftRequest, MyAssignment, PublicSchedule)
  api/client.ts                                    (+ wrappers for the new endpoints)
  app/App.tsx                                      (+ "view" step, URL sync)
  app/components/
    LandingCards.tsx                               NEW — two-card landing
    view/
      PublicScheduleView.tsx                      NEW
      SignInToRequest.tsx                         NEW
      MyAssignments.tsx                           NEW
      RequestSwapModal.tsx                        NEW
    schedule/
      PendingRequestsTab.tsx                      NEW
      DepartmentSwitcher.tsx                      (+ "(N pending)" suffix)
      SaturdayView.tsx                            (+ optional readOnly prop)
      PersonRow.tsx                               (+ optional readOnly prop)
```

## Sequence: a volunteer drops a shift, a director approves

1. Volunteer visits `/`, clicks the "View schedules & request a swap" card → URL becomes `/view`.
2. They sign in with NetID + email; the client posts to `/api/me/assignments` and renders their list of scheduled Saturdays.
3. They click `Request swap` on their Sat 10/12 SCTS row → modal opens with date + dept pre-filled.
4. They select "Just drop this shift", optionally type a note, and submit. Client posts `POST /api/requests`.
5. Server validates: the volunteer is on `SU 26 Schedule[(SCTS, 10/12)].Volunteers on Shift`; no existing pending row. Creates the record with `Status = "Pending"`. Returns `{id, status:"Pending"}`.
6. Airtable automation (configured by the user) emails the SCTS director(s) and the requester.
7. SCTS director signs in via the existing director flow. Their director payload now shows `SCTS (1 pending)` in the dept switcher.
8. Director switches to SCTS; the Pending Requests tab label reads `Pending Requests (1)`. They open the tab and read the request.
9. Director clicks `Approve`. Client posts `POST /api/requests/:id/resolve` with `action: "approve"`.
10. Server: re-validates assignment is still true; runs the apply plan — single `patchRecord` removing the volunteer from `SU 26 Schedule[(SCTS, 10/12)].Volunteers on Shift`; then patches the request row with `Status = "Approved"`, `Resolver`, `Resolved At`, optional note. Returns `{id, status:"Approved"}`.
11. Client refetches the schedule for SCTS — the volunteer is no longer on that Saturday. Toast confirms.
12. Airtable automation emails the requester that their request was approved.

## Open questions and decisions deferred to plan

- **Date list source.** The new table's `Requester Date` / `Target Date` single-select fields need the same option list as `SU 26 Schedule.Date`. The plan should specify whether the user creates the options manually in Airtable (matching the existing `Date` choices), or whether we add a small "sync date options" utility. Recommendation: manual, one-time, to avoid build-time Airtable writes.
- **Sign-in persistence inside `/view`.** Currently a refresh wipes the session. If the volunteer flow becomes noisy ("had to re-enter NetID every time"), we may add a short-lived localStorage cache later — but **out of scope for v2**.
- **Concurrency on approve.** Two directors approving simultaneously is theoretically possible. The `Already resolved` check makes this safe — second approver sees `409`. No locking primitive needed.
- **Public view caching.** The `/api/view/:deptId` response is safe to cache for ~60s at the Vercel edge (`Cache-Control: public, max-age=60, must-revalidate`) since submitted schedules change rarely. We'll add this header in the plan but it's a perf nice-to-have, not load-bearing.
