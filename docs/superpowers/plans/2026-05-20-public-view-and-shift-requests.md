# Public Schedule View + Shift Change Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (a) a public read-only view of submitted department schedules at `/view` and (b) a self-service flow for any scheduled person to request a drop or named swap on their own shifts, with directors reviewing and applying the change in the existing portal.

**Architecture:** Two phases. Phase 1 adds two unauthenticated `GET` endpoints (`/api/view`, `/api/view/:deptId`) and a new top-level `view` step in the SPA; no schema changes. Phase 2 adds a new `SU 26 Shift Requests` Airtable table, five authenticated POST endpoints (`/me/assignments`, `/requests`, `/requests/:id/withdraw`, `/requests/for-dept/:deptId`, `/requests/:id/resolve`), and the UI for sign-in / request form / director review. Request validation and the "apply approved swap" sequencer live in a new pure module `server/requests.ts` so they're unit-testable in isolation.

**Tech Stack:** React 18, Vite 6, TypeScript, Tailwind v4, shadcn/ui, Sonner, motion, Hono on Vercel Node.js runtime, Airtable REST API, Vitest.

**Source of truth for design choices:** [`docs/superpowers/specs/2026-05-20-public-view-and-shift-requests-design.md`](../specs/2026-05-20-public-view-and-shift-requests-design.md). If anything below contradicts the spec, the spec wins — flag it and ask before deviating.

**Baseline assumptions:**
- The Vercel function adapter and routing are healthy as of commit `8b57a3c`. This plan does not touch `api/[...route].ts` or the `vercel.json` rewrite. If they need changes, surface that as a blocker rather than editing them blind.
- The engineer has write access to the HAVEN Management base (`appkxTQ19GmaHgW1O`) and can create a new table there.
- The engineer has the same `AIRTABLE_PAT` already configured in Vercel project settings; no new secrets are needed.
- Working directory is `/Users/jcarney/Documents/Code-Projects/HAVEN-scheduler` unless a step says otherwise.

If any of these fail, pause and confirm with the user before proceeding.

---

## Phasing

Phase 1 ships standalone — no new table, no Airtable schema change, frontend can be merged as soon as the public endpoints work.

Phase 2 depends on Phase 1's frontend scaffolding (the `view` step in `App.tsx`) but is otherwise independent. Phase 2 has its own deploy checkpoint.

Treat the gap between phases as a deploy + sanity-check moment, not a long pause.

---

## File structure

```
api/[...route].ts                                    (untouched)
server/
  app.ts                                             (modified — new routes; existing /director/:netid extended)
  config.ts                                          (modified — add su26ShiftRequestsTableId)
  requests.ts                                        NEW (pure validation + apply-plan + executor)
  tests/
    requests.validate.test.ts                       NEW
    requests.apply.test.ts                          NEW
src/
  api/
    types.ts                                         (modified — new types)
    client.ts                                        (modified — new wrappers)
  app/
    App.tsx                                          (modified — "view" step, URL sync)
    components/
      LandingCards.tsx                              NEW
      view/
        PublicScheduleView.tsx                      NEW
        SignInToRequest.tsx                         NEW
        MyAssignments.tsx                           NEW
        RequestSwapModal.tsx                        NEW
      schedule/
        SaturdayView.tsx                             (modified — readOnly prop)
        PersonRow.tsx                                (modified — readOnly prop)
        DepartmentSwitcher.tsx                       (modified — pending count suffix)
        PendingRequestsTab.tsx                      NEW
      ScheduleBuilder.tsx                            (modified — wires PendingRequestsTab)
.env.example                                         (modified — add SU26_SHIFT_REQUESTS_TABLE_ID)
docs/superpowers/specs/.../...-design.md            (untouched)
docs/superpowers/plans/.../...-plan.md              (this file)
```

---

# Phase 1 — Public read view

Six tasks. End state: anyone hitting `/view` can pick a submitted department and see its schedule as a read-only grid. No new env vars, no Airtable schema changes.

---

### Task P1.1: Add public schedule data-shaper to server (pure)

**Files:**
- Create: `server/public.ts`
- Test: `server/tests/public.test.ts`

The `/api/view/:deptId` endpoint reads two Airtable tables (`SU 26` + `SU 26 Schedule`) plus the `All People` lookup, then redacts the result to names + roles only. Pull the redaction shape into a pure function so it's easy to unit-test without mocking Airtable end-to-end.

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/public.test.ts
import { describe, it, expect } from "vitest";
import { shapePublicSchedule } from "../public";

describe("shapePublicSchedule", () => {
  const dept = {
    id: "dep1",
    name: "SCTS",
    scheduleStatus: "Submitted" as const,
    submittedAt: "2026-05-19T15:00:00.000Z",
  };
  const people = new Map([
    ["p1", { id: "p1", name: "Alice Director" }],
    ["p2", { id: "p2", name: "Bob Volunteer" }],
    ["p3", { id: "p3", name: "Cara Volunteer" }],
  ]);
  const scheduleRows = [
    { date: "2026-05-30", directorIds: ["p1"], volunteerIds: ["p2", "p3"] },
    { date: "2026-06-06", directorIds: ["p1"], volunteerIds: [] },
  ];

  it("returns dept name, submittedAt, and dates with only names per role", () => {
    const out = shapePublicSchedule({ dept, peopleById: people, scheduleRows });

    expect(out).toEqual({
      deptName: "SCTS",
      submittedAt: "2026-05-19T15:00:00.000Z",
      dates: [
        {
          date: "2026-05-30",
          directors: [{ name: "Alice Director" }],
          volunteers: [{ name: "Bob Volunteer" }, { name: "Cara Volunteer" }],
        },
        {
          date: "2026-06-06",
          directors: [{ name: "Alice Director" }],
          volunteers: [],
        },
      ],
    });
  });

  it("skips assignees whose id is not in the people map (deleted person)", () => {
    const out = shapePublicSchedule({
      dept,
      peopleById: people,
      scheduleRows: [
        { date: "2026-05-30", directorIds: ["p1", "ghost"], volunteerIds: ["p2"] },
      ],
    });
    expect(out.dates[0].directors).toEqual([{ name: "Alice Director" }]);
  });

  it("sorts dates chronologically by ISO key", () => {
    const out = shapePublicSchedule({
      dept,
      peopleById: people,
      scheduleRows: [
        { date: "2026-06-06", directorIds: ["p1"], volunteerIds: [] },
        { date: "2026-05-30", directorIds: ["p1"], volunteerIds: [] },
      ],
    });
    expect(out.dates.map((d) => d.date)).toEqual(["2026-05-30", "2026-06-06"]);
  });

  it("omits a person with empty name", () => {
    const peopleWithBlank = new Map([
      ["p1", { id: "p1", name: "Alice" }],
      ["p2", { id: "p2", name: "" }],
    ]);
    const out = shapePublicSchedule({
      dept,
      peopleById: peopleWithBlank,
      scheduleRows: [
        { date: "2026-05-30", directorIds: ["p1"], volunteerIds: ["p2"] },
      ],
    });
    expect(out.dates[0].volunteers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run server/tests/public.test.ts
```

Expected: FAIL with "Cannot find module '../public'".

- [ ] **Step 3: Implement `shapePublicSchedule`**

```ts
// server/public.ts
export type PublicScheduleInput = {
  dept: { id: string; name: string; scheduleStatus: "Draft" | "Submitted"; submittedAt: string | null };
  peopleById: Map<string, { id: string; name: string }>;
  scheduleRows: Array<{ date: string; directorIds: string[]; volunteerIds: string[] }>;
};

export type PublicSchedule = {
  deptName: string;
  submittedAt: string | null;
  dates: Array<{
    date: string;
    directors: Array<{ name: string }>;
    volunteers: Array<{ name: string }>;
  }>;
};

export function shapePublicSchedule(input: PublicScheduleInput): PublicSchedule {
  const { dept, peopleById, scheduleRows } = input;

  const lookup = (id: string): { name: string } | null => {
    const p = peopleById.get(id);
    if (!p) return null;
    if (!p.name) return null;
    return { name: p.name };
  };

  const dates = [...scheduleRows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: row.date,
      directors: row.directorIds.map(lookup).filter((x): x is { name: string } => x !== null),
      volunteers: row.volunteerIds.map(lookup).filter((x): x is { name: string } => x !== null),
    }));

  return {
    deptName: dept.name,
    submittedAt: dept.submittedAt,
    dates,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run server/tests/public.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add server/public.ts server/tests/public.test.ts
git commit -m "feat(server): public schedule data-shaper with redaction"
```

---

### Task P1.2: Add public endpoints to Hono app

**Files:**
- Modify: `server/app.ts`

Add two new routes — `GET /view` (list of submitted depts) and `GET /view/:deptId` (one dept's submitted schedule, redacted). No auth. Returns `403` if `Schedule Status !== "Submitted"` to prevent draft preview by URL guessing.

- [ ] **Step 1: Open `server/app.ts` and find the existing route handlers**

The existing routes start around line 172 (`app.post('/director/:netid', ...)`). The new GET handlers go just above those — public endpoints first, then auth'd ones.

- [ ] **Step 2: Add the public endpoints just before the existing POST routes**

Insert these two routes after the `app.use("*", logger())` block, before the first `app.post`:

```ts
import { shapePublicSchedule } from "./public.js";

// ---------- Public endpoints (no auth) -----------------------------------

app.get("/view", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const rows = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const submitted = rows
    .filter((r) => selectName(r.fields["Schedule Status"]) === "Submitted")
    .map((r) => ({ id: r.id, name: r.fields["Department Name"] ?? "" }))
    .filter((d) => !!d.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return c.json(submitted);
});

app.get("/view/:deptId", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const deptId = c.req.param("deptId");
  const allDepts = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = allDepts.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Not found" }, 404);

  const status = selectName(dept.fields["Schedule Status"]);
  if (status !== "Submitted") return c.json({ error: "Schedule not published" }, 403);

  const scheduleRows = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
    filterByFormula: `{Department} = '${escapeFormulaString(dept.fields["Department Name"] ?? "")}'`,
  });

  const allPeople = await listAll<AllPeopleFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
  });
  const peopleById = new Map(
    allPeople.map((p) => [p.id, { id: p.id, name: p.fields.Name ?? "" }] as const),
  );

  const normalizedRows = scheduleRows
    .map((row) => {
      const iso = normalizeVolunteerDate(selectName(row.fields.Date));
      if (!iso) return null;
      return {
        date: iso,
        directorIds: toIdList(row.fields["Directors on Shift"]),
        volunteerIds: toIdList(row.fields["Volunteers on Shift"]),
      };
    })
    .filter((r): r is { date: string; directorIds: string[]; volunteerIds: string[] } => r !== null);

  const shaped = shapePublicSchedule({
    dept: {
      id: dept.id,
      name: dept.fields["Department Name"] ?? "",
      scheduleStatus: "Submitted",
      submittedAt: dept.fields["Submitted At"] ?? null,
    },
    peopleById,
    scheduleRows: normalizedRows,
  });

  c.header("Cache-Control", "public, max-age=60, must-revalidate");
  return c.json(shaped);
});
```

- [ ] **Step 3: Verify the file typechecks**

```bash
npx tsc --noEmit
```

Expected: exit 0, no errors.

- [ ] **Step 4: Hit the endpoints in dev**

In one terminal:

```bash
npm run dev
```

In another:

```bash
curl -s http://localhost:3001/api/view | head -c 200
curl -s http://localhost:3001/api/view/recXXXXXXXX | head -c 200   # replace with a real submitted dept id
curl -s -i http://localhost:3001/api/view/rec_not_a_real_id | head -10
```

Expected: list endpoint returns a JSON array; valid dept returns `{deptName, submittedAt, dates: [...]}`; bogus id returns `404 {"error":"Not found"}`. If you have no submitted dept yet, mark one as Submitted in Airtable (or via the existing `/submit/:deptId` flow) and re-test.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts
git commit -m "feat(server): public GET /view and /view/:deptId endpoints"
```

---

### Task P1.3: Add public API client + types

**Files:**
- Modify: `src/api/types.ts`
- Modify: `src/api/client.ts`

- [ ] **Step 1: Add the public types**

Append to `src/api/types.ts`:

```ts
export type PublicDeptListItem = {
  id: string;
  name: string;
};

export type PublicSchedule = {
  deptName: string;
  submittedAt: string | null;
  dates: Array<{
    date: string; // ISO Saturday key
    directors: Array<{ name: string }>;
    volunteers: Array<{ name: string }>;
  }>;
};
```

- [ ] **Step 2: Extend the API client with `viewList` and `viewSchedule`**

Edit `src/api/client.ts`. Add imports near the top:

```ts
import type {
  DirectorIdentity,
  ScheduleResponse,
  PublicDeptListItem,
  PublicSchedule,
} from "./types";
```

Add the new methods inside `export const api = { ... }` (alphabetic order is fine — put them near the bottom):

```ts
viewList: () => request<PublicDeptListItem[]>("/view", { method: "GET" }),
viewSchedule: (deptId: string) =>
  request<PublicSchedule>(`/view/${encodeURIComponent(deptId)}`, { method: "GET" }),
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/api/types.ts src/api/client.ts
git commit -m "feat(client): typed wrappers for public view endpoints"
```

---

### Task P1.4: Add `readOnly` prop to SaturdayView + PersonRow

**Files:**
- Modify: `src/app/components/schedule/SaturdayView.tsx`
- Modify: `src/app/components/schedule/PersonRow.tsx`

We want to reuse the existing visual layout for the public read-only view. Add a `readOnly` flag that disables the checkboxes and remove buttons but keeps the layout identical.

- [ ] **Step 1: Add `readOnly` to `PersonRow`**

In `src/app/components/schedule/PersonRow.tsx`, add `readOnly` to the prop type and short-circuit interactions when true. Replace the component body:

```tsx
import type { Person } from "@/api/types";
import { X } from "lucide-react";
import { ConflictBadge } from "./ConflictBadge";

export function PersonRow({
  person,
  isAvailable,
  isAssigned,
  disabled,
  editMode = "assign",
  readOnly = false,
  onToggle,
  onRemove,
}: {
  person: Person;
  isAvailable: boolean;
  isAssigned: boolean;
  disabled: boolean;
  editMode?: "assign" | "availability";
  readOnly?: boolean;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  const accent = editMode === "availability" ? "accent-amber-500" : "accent-[#0F4D92]";
  const interactive = !readOnly && !disabled;

  return (
    <label
      className={`group flex items-center gap-3 p-2 rounded-md transition-colors ${
        interactive ? "cursor-pointer hover:bg-slate-50" : "cursor-default"
      } ${editMode === "assign" && !isAvailable && !readOnly ? "text-slate-500" : ""}`}
    >
      {!readOnly && (
        <input
          type="checkbox"
          checked={isAssigned}
          disabled={disabled}
          onChange={onToggle}
          className={`w-4 h-4 ${accent}`}
        />
      )}
      <span className="flex-1">{person.name || person.netid}</span>
      {!readOnly && editMode === "assign" && !isAvailable && (
        <span className="text-xs text-slate-400">not avail</span>
      )}
      {!readOnly && <ConflictBadge person={person} />}
      {!readOnly && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onRemove();
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-600"
          title="Remove from this department"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </label>
  );
}
```

If the previous file had any logic not visible here, preserve it — only add the `readOnly` short-circuits.

- [ ] **Step 2: Add `readOnly` to `SaturdayView`**

In `src/app/components/schedule/SaturdayView.tsx`, add to the prop type, default false, pass through to `PersonRow`, and disable the on-click handlers when set:

Add `readOnly = false` to the props, and update the `PersonRow` render(s) to pass `readOnly={readOnly}` and pass `onToggle={() => {}}` when read-only (the prop is required on `PersonRow`).

```tsx
export function SaturdayView({
  dates,
  directors,
  volunteers,
  assignments,
  disabled,
  editMode,
  onToggle,
  onRemoveVolunteer,
  readOnly = false,
}: {
  dates: { iso: string; display: string }[];
  directors: Person[];
  volunteers: Person[];
  assignments: Assignment[];
  disabled: boolean;
  editMode: "assign" | "availability";
  onToggle: (date: string, kind: Kind, personId: string) => void;
  onRemoveVolunteer?: (person: Person) => void;
  readOnly?: boolean;
}) {
```

In the `column(...)` helper inside the same file, where it renders `<PersonRow ...>`, add `readOnly={readOnly}` to the props, and if `readOnly` is true, pass `onToggle={() => {}}` and don't pass `onRemove`. Concretely, change the `PersonRow` JSX to:

```tsx
<PersonRow
  key={p.id}
  person={p}
  isAvailable={readOnly ? true : p.available.includes(activeIso)}
  isAssigned={assignedIds.includes(p.id)}
  disabled={disabled}
  editMode={editMode}
  readOnly={readOnly}
  onToggle={readOnly ? () => {} : () => onToggle(activeIso, kind, p.id)}
  onRemove={readOnly ? undefined : removeHandler}
/>
```

(Adjust `isAvailable` so the "not avail" hint doesn't show in read-only mode — public viewers don't know about availability.)

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Verify existing director flow still works**

```bash
npm run dev
```

Open `http://localhost:5173`, sign in as a director, open a department schedule. The checkboxes should still toggle assignments (i.e., `readOnly={false}` is the default and the existing flow is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/components/schedule/SaturdayView.tsx src/app/components/schedule/PersonRow.tsx
git commit -m "feat(schedule): readOnly prop on SaturdayView + PersonRow"
```

---

### Task P1.5: Build `LandingCards` and add the `view` step to App

**Files:**
- Create: `src/app/components/LandingCards.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Create the two-card landing layout**

```tsx
// src/app/components/LandingCards.tsx
import { motion } from "motion/react";
import type { DirectorIdentity } from "@/api/types";
import { DirectorLookup } from "./DirectorLookup";

export function LandingCards({
  onIdentity,
  onOpenView,
}: {
  onIdentity: (id: DirectorIdentity) => void;
  onOpenView: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full max-w-3xl mt-12 grid gap-6 md:grid-cols-2"
    >
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Director sign-in</h2>
        <p className="text-sm text-slate-600 mb-4">
          Build or edit your department's clinic schedule.
        </p>
        <DirectorLookup onFound={onIdentity} />
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6 flex flex-col">
        <h2 className="text-lg font-semibold mb-2">View schedules &amp; request a swap</h2>
        <p className="text-sm text-slate-600 mb-4">
          See a submitted department schedule, or sign in to request a drop or swap
          on one of your own shifts.
        </p>
        <button
          type="button"
          onClick={onOpenView}
          className="mt-auto bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] transition-colors"
        >
          Open
        </button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Extend `App.tsx` with the `view` step + URL sync**

Replace the body of `src/app/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import type { DirectorIdentity } from "@/api/types";
import { LOGO_URL, BG_IMAGE } from "./constants";
import { LandingCards } from "./components/LandingCards";
import { ScheduleBuilder } from "./components/ScheduleBuilder";
import { PublicScheduleView } from "./components/view/PublicScheduleView";

type Step = "loading" | "lookup" | "schedule" | "view";

function initialStepFromUrl(): Step {
  if (typeof window === "undefined") return "loading";
  return window.location.pathname === "/view" ? "view" : "loading";
}

export default function App() {
  const [step, setStep] = useState<Step>(initialStepFromUrl());
  const [identity, setIdentity] = useState<DirectorIdentity | null>(null);

  useEffect(() => {
    if (step === "loading") {
      const t = setTimeout(() => setStep("lookup"), 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [step]);

  // Keep URL in sync so /view is shareable + back button works.
  useEffect(() => {
    const target = step === "view" ? "/view" : "/";
    if (window.location.pathname !== target) {
      window.history.pushState({}, "", target);
    }
  }, [step]);

  // Respond to browser back/forward.
  useEffect(() => {
    function onPop() {
      const next: Step = window.location.pathname === "/view" ? "view" : "lookup";
      setStep(next);
      if (next === "lookup") setIdentity(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function handleIdentity(found: DirectorIdentity) {
    setIdentity(found);
    setStep("schedule");
  }

  function handleSignOut() {
    setIdentity(null);
    setStep("lookup");
  }

  function handleOpenView() {
    setStep("view");
  }

  function handleBackToLanding() {
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
          <button
            type="button"
            onClick={handleBackToLanding}
            className="flex items-center gap-4 text-left"
          >
            <img src={LOGO_URL} alt="HAVEN Free Clinic" className="h-12 w-auto" />
            <div className="h-8 w-px bg-white/20" />
            <p className="text-sm font-medium text-blue-100 tracking-wide uppercase">
              Clinic Schedule
            </p>
          </button>
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
            {step === "lookup" && (
              <LandingCards
                key="landing"
                onIdentity={handleIdentity}
                onOpenView={handleOpenView}
              />
            )}
            {step === "schedule" && identity && (
              <ScheduleBuilder
                key="schedule"
                identity={identity}
                onSignOut={handleSignOut}
              />
            )}
            {step === "view" && <PublicScheduleView key="view" />}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Stub `PublicScheduleView` so the app compiles**

The next task implements it fully. Create a stub for now:

```tsx
// src/app/components/view/PublicScheduleView.tsx
export function PublicScheduleView() {
  return <div className="text-white mt-12">View screen (coming next)</div>;
}
```

- [ ] **Step 4: Typecheck and verify the landing flow works**

```bash
npx tsc --noEmit
npm run dev
```

Open `http://localhost:5173`. You should see two cards. Click "Open" on the right card → URL becomes `/view` → placeholder appears. Use browser back → URL returns to `/` → two cards reappear. Click "Sign in" in the left card → existing director flow works as before.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/LandingCards.tsx src/app/App.tsx src/app/components/view/PublicScheduleView.tsx
git commit -m "feat(portal): two-card landing + view step with URL sync"
```

---

### Task P1.6: Build `PublicScheduleView`

**Files:**
- Modify: `src/app/components/view/PublicScheduleView.tsx`

Renders the dept dropdown + the chosen schedule. Reuses `SaturdayView` in `readOnly` mode.

- [ ] **Step 1: Replace the stub with the full implementation**

```tsx
// src/app/components/view/PublicScheduleView.tsx
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { PublicDeptListItem, PublicSchedule } from "@/api/types";
import { SaturdayView } from "../schedule/SaturdayView";
import { displayDate } from "./displayDate";

export function PublicScheduleView() {
  const [depts, setDepts] = useState<PublicDeptListItem[] | null>(null);
  const [deptId, setDeptId] = useState<string>("");
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [notPublished, setNotPublished] = useState(false);

  // Load dept list on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .viewList()
      .then((list) => {
        if (cancelled) return;
        setDepts(list);
        if (list.length > 0) setDeptId(list[0].id);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.message ?? "Failed to load departments");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the selected dept's schedule.
  useEffect(() => {
    if (!deptId) {
      setSchedule(null);
      setNotPublished(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotPublished(false);
    api
      .viewSchedule(deptId)
      .then((s) => {
        if (!cancelled) setSchedule(s);
      })
      .catch((err: Error & { status?: number }) => {
        if (cancelled) return;
        if (err.status === 403) {
          setNotPublished(true);
          setSchedule(null);
        } else if (err.status === 404) {
          toast.error("Department not found");
          setSchedule(null);
        } else {
          toast.error(err.message ?? "Failed to load schedule");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deptId]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full max-w-4xl mt-8 space-y-6"
    >
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-3">Browse a submitted schedule</h2>
        {depts === null ? (
          <p className="text-sm text-slate-500">Loading departments…</p>
        ) : depts.length === 0 ? (
          <p className="text-sm text-slate-500">No schedules have been published yet.</p>
        ) : (
          <select
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            className="p-2 border border-slate-300 rounded-md bg-white text-base font-semibold"
          >
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div className="bg-white rounded-xl shadow-lg p-6 text-sm text-slate-500">
          Loading schedule…
        </div>
      )}

      {notPublished && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900">
          This schedule hasn't been published yet.
        </div>
      )}

      {schedule && !loading && !notPublished && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="mb-4">
            <h3 className="text-xl font-semibold">{schedule.deptName}</h3>
            {schedule.submittedAt && (
              <p className="text-sm text-slate-500">
                Published {new Date(schedule.submittedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          <SaturdayView
            dates={schedule.dates.map((d) => ({ iso: d.date, display: displayDate(d.date) }))}
            directors={schedule.dates.flatMap((d) => d.directors).map(toPseudoPerson("director"))}
            volunteers={schedule.dates.flatMap((d) => d.volunteers).map(toPseudoPerson("volunteer"))}
            assignments={schedule.dates.map((d) => ({
              date: d.date,
              directorIds: d.directors.map((p) => pseudoId("director", p.name)),
              volunteerIds: d.volunteers.map((p) => pseudoId("volunteer", p.name)),
            }))}
            disabled
            editMode="assign"
            onToggle={() => {}}
            readOnly
          />
        </div>
      )}
    </motion.div>
  );
}

function pseudoId(kind: "director" | "volunteer", name: string): string {
  return `${kind}:${name}`;
}

function toPseudoPerson(kind: "director" | "volunteer") {
  return (p: { name: string }) => ({
    id: pseudoId(kind, p.name),
    netid: "",
    name: p.name,
    available: [], // ignored in readOnly mode
    conflicts: { sameDay: [], crossTerm: [] },
  });
}
```

- [ ] **Step 2: Add a small client-side `displayDate` helper**

`server/dates.ts` is server-side; mirror its tiny `displayDate` function on the client. Create:

```tsx
// src/app/components/view/displayDate.ts
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SUFFIX = (day: number): string => {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
};

export function displayDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}${SUFFIX(d)}`;
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0. If `SaturdayView` complains about the synthetic `Person` shape (missing optional `availabilityOverridden`), it's fine — the field is optional and unused in read-only.

- [ ] **Step 4: Visual verification in dev**

```bash
npm run dev
```

Go to `http://localhost:5173/view`. Expect: dept dropdown populated with submitted depts; selecting a dept shows the read-only schedule grid; no checkboxes or remove buttons; no "(not avail)" hints; bogus URLs handled gracefully.

If no submitted depts exist yet, mark one as Submitted via the existing director portal flow.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/view/PublicScheduleView.tsx src/app/components/view/displayDate.ts
git commit -m "feat(view): public schedule viewer with dept dropdown"
```

---

### Phase 1 deploy checkpoint

- [ ] **Push and verify on Vercel**

```bash
git push origin main
```

After Vercel deploys, hit `https://schedule.havenfreeclinic.com/view` in a private/incognito window (no cookies). Confirm:
1. The two-card landing appears at `/`.
2. The "Open" button takes you to `/view`.
3. A submitted dept renders correctly.
4. A non-submitted dept (force by tweaking its status in Airtable, or visit `/api/view/<draft-dept-id>`) returns 403, and the UI shows the "not published" banner.
5. The director flow at `/` is unchanged — sign in still works, schedule editor still loads.

If everything looks good, Phase 1 is shipped. Proceed to Phase 2.

---

# Phase 2 — Shift change requests

Fifteen tasks. End state: a scheduled person can sign in inside `/view`, see their assignments, submit a drop or named-swap request; directors see pending requests for the dept they're viewing, approve them (which applies the schedule edit) or reject them.

---

### Task P2.1: Manual — create the `SU 26 Shift Requests` table in Airtable

**Files:** none in repo. This is an Airtable schema task.

The schema is in the spec under *Data sources*. Reproduce it here as a one-time setup checklist.

- [ ] **Step 1: In the HAVEN Management base, create a new table named `SU 26 Shift Requests`**

Choose `Request ID` (Autonumber) as the primary field.

- [ ] **Step 2: Add the fields, exactly as named below**

| Field name | Type | Notes |
|---|---|---|
| `Request ID` | Autonumber | Primary (already set). |
| `Department` | Link to another record → `SU 26` | Allow linking to only one record. |
| `Requester` | Link to another record → `All People` | Allow linking to only one record. |
| `Requester Email` | Email | |
| `Requester Date` | Single select | Add the SAME option list as `SU 26 Schedule.Date` (display strings — "May 30th", "June 6th", …, "September 26th"). Copy the existing options exactly. |
| `Target` | Link to another record → `All People` | Allow linking to only one record. |
| `Target Date` | Single select | Same option list as `Requester Date`. |
| `Type` | Formula | `IF({Target}, "Named swap", "Drop")` |
| `Note` | Long text | |
| `Status` | Single select | Options (in this order, defaults to first): `Pending`, `Approved`, `Rejected`, `Withdrawn`. Set the default to `Pending`. |
| `Resolver` | Link to another record → `All People` | Allow linking to only one record. |
| `Resolution Note` | Long text | |
| `Submitted At` | Created time | Use the record creation timestamp. |
| `Resolved At` | Date | Include time. Will be set by the app on resolve/withdraw. |

- [ ] **Step 3: Copy the table ID for the next task**

In Airtable, open the table → click the table name → "Get API help" or use the URL: the table ID is the `tbl…` segment. Note it — you'll add it to `.env.local` and Vercel env settings in the next task.

- [ ] **Step 4: Wire up email automations** (out of scope for the app, but do it now)

In Airtable Automations, set up the email triggers your team wants on `Status` changes — e.g., "When a record is created (Status = Pending) → email Requester + dept directors" and "When Status changes from Pending to Approved/Rejected → email Requester". The app does not orchestrate these.

- [ ] **Step 5: Nothing to commit**

This is an Airtable-side change; no code commit. Proceed to the next task with the table ID handy.

---

### Task P2.2: Add the table ID to config

**Files:**
- Modify: `server/config.ts`
- Modify: `.env.example`
- Modify: `.env.local` (locally, not committed)

- [ ] **Step 1: Add the env var to `server/config.ts`**

In the `loadConfig()` `required` object, add:

```ts
    su26ShiftRequestsTableId: process.env.SU26_SHIFT_REQUESTS_TABLE_ID,
```

And in the exported `Config` type, add the matching field:

```ts
  su26ShiftRequestsTableId: string;
```

- [ ] **Step 2: Add the variable to `.env.example` (with no value)**

Append to `.env.example`:

```
SU26_SHIFT_REQUESTS_TABLE_ID=
```

- [ ] **Step 3: Put the real value in `.env.local`**

Open `.env.local` and add:

```
SU26_SHIFT_REQUESTS_TABLE_ID=tblXXXXXXXXXXXXX
```

(Replace with the ID from P2.1.)

- [ ] **Step 4: Set it in Vercel project settings**

Vercel dashboard → project `haven-scheduler` → Settings → Environment Variables → add `SU26_SHIFT_REQUESTS_TABLE_ID` with the same value for the `Production` environment (and `Preview` if you want preview deploys to work).

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit (only `.env.example` and `server/config.ts` — `.env.local` is gitignored)**

```bash
git add server/config.ts .env.example
git commit -m "feat(config): add SU26_SHIFT_REQUESTS_TABLE_ID"
```

---

### Task P2.3: Create `server/requests.ts` — request validation (pure)

**Files:**
- Create: `server/requests.ts`
- Test: `server/tests/requests.validate.test.ts`

The validation function takes in-memory schedule rows + a proposed request, returns either `{ ok: true }` or `{ ok: false, error: "…" }`. No Airtable access — pure.

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/requests.validate.test.ts
import { describe, it, expect } from "vitest";
import { validateRequest, type ScheduleRowForValidation } from "../requests";

const rows: ScheduleRowForValidation[] = [
  { date: "2026-05-30", directorIds: ["dA"], volunteerIds: ["vA", "vB"] },
  { date: "2026-06-06", directorIds: ["dB"], volunteerIds: ["vA"] },
];

describe("validateRequest", () => {
  it("accepts a drop where the requester is assigned to that date", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a drop where the requester is not on that date", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vC",
        requesterDate: "2026-05-30",
      }),
    ).toEqual({ ok: false, error: "Not assigned to that shift" });
  });

  it("accepts a named swap with same role on both ends (volunteer↔volunteer)", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "vA",     // partner picker would never let same person, but role check is separate
        targetDate: "2026-06-06",
      }),
    ).toEqual({ ok: false, error: "Partner is not eligible" }); // self-target — partner must differ
  });

  it("accepts a named swap between two different volunteers", () => {
    const r: ScheduleRowForValidation[] = [
      { date: "2026-05-30", directorIds: [], volunteerIds: ["vA"] },
      { date: "2026-06-06", directorIds: [], volunteerIds: ["vB"] },
    ];
    expect(
      validateRequest({
        scheduleRows: r,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "vB",
        targetDate: "2026-06-06",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a named swap where the target is not on the target date", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "vB",
        targetDate: "2026-06-06",
      }),
    ).toEqual({ ok: false, error: "Partner is not eligible" });
  });

  it("rejects a named swap with mismatched roles (volunteer requester, director target)", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "dB",
        targetDate: "2026-06-06",
      }),
    ).toEqual({ ok: false, error: "Partner is not eligible" });
  });

  it("rejects when targetId is provided without targetDate", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "vB",
      }),
    ).toEqual({ ok: false, error: "Partner is not eligible" });
  });

  it("treats request as a drop when targetId and targetDate are both omitted", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
      }),
    ).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run server/tests/requests.validate.test.ts
```

Expected: FAIL with "Cannot find module '../requests'".

- [ ] **Step 3: Implement `validateRequest`**

```ts
// server/requests.ts
export type ScheduleRowForValidation = {
  date: string; // ISO Saturday key
  directorIds: string[];
  volunteerIds: string[];
};

export type ValidateInput = {
  scheduleRows: ScheduleRowForValidation[];
  requesterId: string;
  requesterDate: string;
  targetId?: string;
  targetDate?: string;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

type Role = "director" | "volunteer";

function findRoleOnDate(
  rows: ScheduleRowForValidation[],
  personId: string,
  date: string,
): Role | null {
  const row = rows.find((r) => r.date === date);
  if (!row) return null;
  if (row.directorIds.includes(personId)) return "director";
  if (row.volunteerIds.includes(personId)) return "volunteer";
  return null;
}

export function validateRequest(input: ValidateInput): ValidationResult {
  const { scheduleRows, requesterId, requesterDate, targetId, targetDate } = input;

  const requesterRole = findRoleOnDate(scheduleRows, requesterId, requesterDate);
  if (!requesterRole) return { ok: false, error: "Not assigned to that shift" };

  const hasTargetId = !!targetId;
  const hasTargetDate = !!targetDate;

  if (!hasTargetId && !hasTargetDate) return { ok: true };           // drop
  if (hasTargetId !== hasTargetDate)
    return { ok: false, error: "Partner is not eligible" };          // half-set is invalid

  if (targetId === requesterId)                                       // self-target
    return { ok: false, error: "Partner is not eligible" };

  const targetRole = findRoleOnDate(scheduleRows, targetId as string, targetDate as string);
  if (!targetRole) return { ok: false, error: "Partner is not eligible" };
  if (targetRole !== requesterRole) return { ok: false, error: "Partner is not eligible" };

  return { ok: true };
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run server/tests/requests.validate.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add server/requests.ts server/tests/requests.validate.test.ts
git commit -m "feat(server): pure validateRequest for shift-change requests"
```

---

### Task P2.4: Add the apply-plan generator (pure)

**Files:**
- Modify: `server/requests.ts`
- Test: `server/tests/requests.apply.test.ts`

`planApply` takes a validated request and the current schedule rows, returns a sequence of patch operations against `SU 26 Schedule` rows. No Airtable access yet — pure.

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/requests.apply.test.ts
import { describe, it, expect } from "vitest";
import { planApply, type ScheduleRowForApply } from "../requests";

const baseRows: ScheduleRowForApply[] = [
  { id: "rec530", date: "2026-05-30", directorIds: ["dA"], volunteerIds: ["vA", "vB"] },
  { id: "rec606", date: "2026-06-06", directorIds: ["dA"], volunteerIds: ["vC"] },
];

describe("planApply", () => {
  it("for a drop, removes requester from the (Department, Requester Date) row", () => {
    const plan = planApply({
      scheduleRows: baseRows,
      requesterId: "vA",
      requesterDate: "2026-05-30",
    });
    expect(plan).toEqual([
      {
        recordId: "rec530",
        fields: { "Volunteers on Shift": ["vB"] },
      },
    ]);
  });

  it("for a named swap, produces two patches in deterministic order", () => {
    const plan = planApply({
      scheduleRows: baseRows,
      requesterId: "vA",
      requesterDate: "2026-05-30",
      targetId: "vC",
      targetDate: "2026-06-06",
    });
    expect(plan).toEqual([
      {
        recordId: "rec530",
        fields: { "Volunteers on Shift": ["vB", "vC"] },
      },
      {
        recordId: "rec606",
        fields: { "Volunteers on Shift": ["vA"] },
      },
    ]);
  });

  it("for a director-director swap, patches Directors on Shift instead", () => {
    const rows: ScheduleRowForApply[] = [
      { id: "r1", date: "2026-05-30", directorIds: ["dA", "dB"], volunteerIds: [] },
      { id: "r2", date: "2026-06-06", directorIds: ["dC"], volunteerIds: [] },
    ];
    expect(
      planApply({
        scheduleRows: rows,
        requesterId: "dA",
        requesterDate: "2026-05-30",
        targetId: "dC",
        targetDate: "2026-06-06",
      }),
    ).toEqual([
      {
        recordId: "r1",
        fields: { "Directors on Shift": ["dB", "dC"] },
      },
      {
        recordId: "r2",
        fields: { "Directors on Shift": ["dA"] },
      },
    ]);
  });

  it("throws if the requester's row is missing (caller should re-validate first)", () => {
    expect(() =>
      planApply({
        scheduleRows: baseRows,
        requesterId: "vZ",
        requesterDate: "2026-05-30",
      }),
    ).toThrow(/not assigned/i);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run server/tests/requests.apply.test.ts
```

Expected: FAIL because `planApply` is undefined.

- [ ] **Step 3: Implement `planApply`**

Append to `server/requests.ts`:

```ts
export type ScheduleRowForApply = {
  id: string;
  date: string;
  directorIds: string[];
  volunteerIds: string[];
};

export type PatchOp = {
  recordId: string;
  fields: Record<string, string[]>;
};

export type ApplyInput = {
  scheduleRows: ScheduleRowForApply[];
  requesterId: string;
  requesterDate: string;
  targetId?: string;
  targetDate?: string;
};

function roleOf(row: ScheduleRowForApply, personId: string): "director" | "volunteer" | null {
  if (row.directorIds.includes(personId)) return "director";
  if (row.volunteerIds.includes(personId)) return "volunteer";
  return null;
}

function fieldForRole(role: "director" | "volunteer"): string {
  return role === "director" ? "Directors on Shift" : "Volunteers on Shift";
}

function withRemoved(row: ScheduleRowForApply, role: "director" | "volunteer", personId: string): string[] {
  const list = role === "director" ? row.directorIds : row.volunteerIds;
  return list.filter((id) => id !== personId);
}

function withAdded(row: ScheduleRowForApply, role: "director" | "volunteer", personId: string): string[] {
  const list = role === "director" ? row.directorIds : row.volunteerIds;
  return list.includes(personId) ? list : [...list, personId];
}

export function planApply(input: ApplyInput): PatchOp[] {
  const { scheduleRows, requesterId, requesterDate, targetId, targetDate } = input;

  const requesterRow = scheduleRows.find((r) => r.date === requesterDate);
  if (!requesterRow) throw new Error("Requester's row not found");
  const requesterRole = roleOf(requesterRow, requesterId);
  if (!requesterRole) throw new Error("Requester not assigned to requester date");

  if (!targetId || !targetDate) {
    return [
      {
        recordId: requesterRow.id,
        fields: {
          [fieldForRole(requesterRole)]: withRemoved(requesterRow, requesterRole, requesterId),
        },
      },
    ];
  }

  const targetRow = scheduleRows.find((r) => r.date === targetDate);
  if (!targetRow) throw new Error("Target's row not found");

  // After requester is removed, target is added on requester's date.
  const requesterPatch: PatchOp = {
    recordId: requesterRow.id,
    fields: {
      [fieldForRole(requesterRole)]: withAdded(
        { ...requesterRow, [requesterRole === "director" ? "directorIds" : "volunteerIds"]:
            withRemoved(requesterRow, requesterRole, requesterId) },
        requesterRole,
        targetId,
      ),
    },
  };

  // After target is removed, requester is added on target's date.
  const targetPatch: PatchOp = {
    recordId: targetRow.id,
    fields: {
      [fieldForRole(requesterRole)]: withAdded(
        { ...targetRow, [requesterRole === "director" ? "directorIds" : "volunteerIds"]:
            withRemoved(targetRow, requesterRole, targetId) },
        requesterRole,
        requesterId,
      ),
    },
  };

  return [requesterPatch, targetPatch];
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run server/tests/requests.apply.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add server/requests.ts server/tests/requests.apply.test.ts
git commit -m "feat(server): planApply for shift-change requests"
```

---

### Task P2.5: Add the apply-executor with best-effort rollback

**Files:**
- Modify: `server/requests.ts`
- Modify: `server/tests/requests.apply.test.ts`

`executeApply` walks a `PatchOp[]` and calls `patchRecord` for each. On any failure, attempts to reverse the prior patches by re-applying the rows' original linked-record lists. Best-effort — Airtable has no transactions.

- [ ] **Step 1: Append the rollback test**

Add to `server/tests/requests.apply.test.ts`:

```ts
import { executeApply } from "../requests";

describe("executeApply", () => {
  it("calls patchRecord for each op in order", async () => {
    const calls: Array<{ tableId: string; recordId: string; fields: Record<string, unknown> }> = [];
    const patchRecord = async (opts: { tableId: string; recordId: string; fields: Record<string, unknown> }) => {
      calls.push({ tableId: opts.tableId, recordId: opts.recordId, fields: opts.fields });
      return { id: opts.recordId, createdTime: "", fields: opts.fields } as any;
    };

    await executeApply({
      baseId: "appX",
      scheduleTableId: "tblS",
      ops: [
        { recordId: "r1", fields: { "Volunteers on Shift": ["vB"] } },
        { recordId: "r2", fields: { "Volunteers on Shift": ["vA"] } },
      ],
      originalRows: new Map([
        ["r1", { id: "r1", date: "x", directorIds: [], volunteerIds: ["vA", "vB"] }],
        ["r2", { id: "r2", date: "y", directorIds: [], volunteerIds: ["vC"] }],
      ]),
      patchRecord,
    });

    expect(calls.map((c) => c.recordId)).toEqual(["r1", "r2"]);
  });

  it("attempts rollback when a later op fails", async () => {
    const calls: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
    let opIndex = 0;
    const patchRecord = async (opts: { tableId: string; recordId: string; fields: Record<string, unknown> }) => {
      calls.push({ recordId: opts.recordId, fields: opts.fields });
      opIndex++;
      if (opIndex === 2) throw new Error("Airtable boom");
      return { id: opts.recordId, createdTime: "", fields: opts.fields } as any;
    };

    await expect(
      executeApply({
        baseId: "appX",
        scheduleTableId: "tblS",
        ops: [
          { recordId: "r1", fields: { "Volunteers on Shift": ["vB"] } },
          { recordId: "r2", fields: { "Volunteers on Shift": ["vA"] } },
        ],
        originalRows: new Map([
          ["r1", { id: "r1", date: "x", directorIds: [], volunteerIds: ["vA", "vB"] }],
          ["r2", { id: "r2", date: "y", directorIds: [], volunteerIds: ["vC"] }],
        ]),
        patchRecord,
      }),
    ).rejects.toThrow(/Airtable boom/);

    // We saw 3 patch calls: forward(r1), forward(r2)=FAIL, rollback(r1) restoring original.
    expect(calls.length).toBe(3);
    expect(calls[0].recordId).toBe("r1");
    expect(calls[1].recordId).toBe("r2");
    expect(calls[2].recordId).toBe("r1");
    expect(calls[2].fields).toEqual({ "Volunteers on Shift": ["vA", "vB"] });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npx vitest run server/tests/requests.apply.test.ts
```

Expected: 2 new tests fail (`executeApply is not defined`).

- [ ] **Step 3: Implement `executeApply`**

Append to `server/requests.ts`:

```ts
import type { AirtableRecord } from "./airtable.js";

export type PatchRecordFn = (opts: {
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
}) => Promise<AirtableRecord>;

export type ExecuteApplyInput = {
  baseId: string;
  scheduleTableId: string;
  ops: PatchOp[];
  /** Maps recordId → its row as it was BEFORE this apply. Used for rollback. */
  originalRows: Map<string, ScheduleRowForApply>;
  patchRecord: PatchRecordFn;
};

function rollbackFieldsFor(
  row: ScheduleRowForApply,
  changedField: string,
): Record<string, string[]> {
  // Restore whichever role list was changed.
  if (changedField === "Directors on Shift") return { "Directors on Shift": row.directorIds };
  if (changedField === "Volunteers on Shift") return { "Volunteers on Shift": row.volunteerIds };
  return {}; // safety — shouldn't happen
}

export async function executeApply(input: ExecuteApplyInput): Promise<void> {
  const { baseId, scheduleTableId, ops, originalRows, patchRecord } = input;

  const applied: Array<{ recordId: string; field: string }> = [];

  for (const op of ops) {
    try {
      // We only ever patch one field per op (Directors or Volunteers on Shift).
      const [field] = Object.keys(op.fields);
      await patchRecord({
        baseId,
        tableId: scheduleTableId,
        recordId: op.recordId,
        fields: op.fields,
      });
      applied.push({ recordId: op.recordId, field });
    } catch (err) {
      // Roll back the patches we've already applied, in reverse order.
      for (const a of applied.reverse()) {
        const original = originalRows.get(a.recordId);
        if (!original) continue;
        try {
          await patchRecord({
            baseId,
            tableId: scheduleTableId,
            recordId: a.recordId,
            fields: rollbackFieldsFor(original, a.field),
          });
        } catch (rollbackErr) {
          // Best-effort: log and continue. Caller will see the original error.
          console.error("rollback failed for", a.recordId, rollbackErr);
        }
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run server/tests/requests.apply.test.ts
```

Expected: 6 passed total in that file (4 plan tests + 2 execute tests).

- [ ] **Step 5: Commit**

```bash
git add server/requests.ts server/tests/requests.apply.test.ts
git commit -m "feat(server): executeApply with best-effort rollback"
```

---

### Task P2.6: Add `POST /me/assignments` endpoint

**Files:**
- Modify: `server/app.ts`

Returns the caller's scheduled Saturdays across every department, plus any of their own pending requests. Uses the existing `findPerson` helper.

- [ ] **Step 1: Find the `findPerson` helper in `server/app.ts`**

Search for `async function findPerson(` — it's used by `/director/:netid`. Skip if you don't see one with that exact shape; the helpers may have slightly different names. The key thing is the existing identity check pattern: load `All People`, match on NetID + Contact Email.

- [ ] **Step 2: Add the new route**

Place near the other authenticated routes (e.g., after `/availability`). The endpoint:

```ts
app.post("/me/assignments", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
  };
  if (!callerNetid || !callerEmail) {
    return c.json({ error: "Missing callerNetid / callerEmail" }, 400);
  }

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  // All depts + all schedule rows.
  const [allDepts, allScheduleRows, pendingRequests] = await Promise.all([
    listAll<Su26RosterFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26RosterTableId,
    }),
    listAll<ScheduleRowFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
    }),
    listAll<ShiftRequestFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ShiftRequestsTableId,
      filterByFormula: `AND({Status} = 'Pending', FIND('${escapeFormulaString(person.id)}', ARRAYJOIN({Requester})) > 0)`,
    }),
  ]);

  const deptIdByName = new Map<string, { id: string; name: string }>();
  for (const d of allDepts) {
    const name = d.fields["Department Name"] ?? "";
    if (name) deptIdByName.set(name, { id: d.id, name });
  }

  const myAssignments: Array<{
    deptId: string;
    deptName: string;
    date: string;
    role: "director" | "volunteer";
    pendingRequestId: string | null;
  }> = [];

  // Pending requests indexed by (deptId, date)
  const pendingByKey = new Map<string, string>();
  for (const r of pendingRequests) {
    const deptLink = toIdList(r.fields.Department)[0];
    const dateDisplay = selectName(r.fields["Requester Date"]);
    const iso = normalizeVolunteerDate(dateDisplay);
    if (deptLink && iso) pendingByKey.set(`${deptLink}|${iso}`, r.id);
  }

  for (const row of allScheduleRows) {
    const deptName = selectName(row.fields.Department);
    const dept = deptIdByName.get(deptName);
    if (!dept) continue;
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    if (!iso) continue;
    const directorIds = toIdList(row.fields["Directors on Shift"]);
    const volunteerIds = toIdList(row.fields["Volunteers on Shift"]);
    const role: "director" | "volunteer" | null =
      directorIds.includes(person.id) ? "director" :
      volunteerIds.includes(person.id) ? "volunteer" : null;
    if (!role) continue;
    myAssignments.push({
      deptId: dept.id,
      deptName: dept.name,
      date: iso,
      role,
      pendingRequestId: pendingByKey.get(`${dept.id}|${iso}`) ?? null,
    });
  }

  myAssignments.sort((a, b) =>
    a.date === b.date ? a.deptName.localeCompare(b.deptName) : a.date.localeCompare(b.date),
  );

  return c.json({
    person: {
      id: person.id,
      name: person.fields.Name ?? "",
      netid: person.fields.NetID ?? "",
      email: person.fields["Contact Email"] ?? "",
    },
    assignments: myAssignments,
  });
});
```

- [ ] **Step 3: Add the `ShiftRequestFields` type near the other field types at the top of `app.ts`**

```ts
type ShiftRequestFields = {
  Department?: unknown;
  Requester?: unknown;
  "Requester Email"?: string;
  "Requester Date"?: unknown;
  Target?: unknown;
  "Target Date"?: unknown;
  Type?: string;
  Note?: string;
  Status?: unknown;
  Resolver?: unknown;
  "Resolution Note"?: string;
  "Submitted At"?: string;
  "Resolved At"?: string;
};
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Smoke-test in dev**

```bash
npm run dev
```

In another terminal:

```bash
curl -s -X POST http://localhost:3001/api/me/assignments \
  -H "Content-Type: application/json" \
  -d '{"callerNetid":"YOUR_NETID","callerEmail":"YOUR_EMAIL"}'
```

Expected: JSON with `person` and `assignments` arrays. If you're not actually scheduled, `assignments` will be `[]` — that's fine.

- [ ] **Step 6: Commit**

```bash
git add server/app.ts
git commit -m "feat(server): POST /me/assignments"
```

---

### Task P2.7: Add `POST /requests` endpoint

**Files:**
- Modify: `server/app.ts`

Creates a new shift request after `validateRequest` passes and after we confirm no `Pending` row exists for `(Requester, Requester Date)`.

- [ ] **Step 1: Add the route just after `/me/assignments`**

```ts
import { validateRequest } from "./requests.js";

app.post("/requests", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    deptId?: string;
    requesterDate?: string;  // ISO Saturday key
    targetNetid?: string;
    targetDate?: string;     // ISO
    note?: string;
  };
  const { callerNetid, callerEmail, deptId, requesterDate, targetNetid, targetDate, note } = body;
  if (!callerNetid || !callerEmail || !deptId || !requesterDate) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  // Resolve dept + schedule rows for this dept.
  const allDepts = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = allDepts.find((d) => d.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);

  const scheduleRows = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
    filterByFormula: `{Department} = '${escapeFormulaString(dept.fields["Department Name"] ?? "")}'`,
  });

  const rowsForValidate = scheduleRows
    .map((r) => {
      const iso = normalizeVolunteerDate(selectName(r.fields.Date));
      if (!iso) return null;
      return {
        date: iso,
        directorIds: toIdList(r.fields["Directors on Shift"]),
        volunteerIds: toIdList(r.fields["Volunteers on Shift"]),
      };
    })
    .filter((r): r is { date: string; directorIds: string[]; volunteerIds: string[] } => r !== null);

  // If targetNetid was given, resolve to an All People id.
  let targetPersonId: string | undefined;
  if (targetNetid) {
    const allPeople = await listAll<AllPeopleFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.allPeopleTableId,
      filterByFormula: `{NetID} = '${escapeFormulaString(targetNetid)}'`,
    });
    targetPersonId = allPeople[0]?.id;
    if (!targetPersonId) return c.json({ error: "Partner is not eligible" }, 409);
  }

  const v = validateRequest({
    scheduleRows: rowsForValidate,
    requesterId: person.id,
    requesterDate,
    targetId: targetPersonId,
    targetDate,
  });
  if (!v.ok) return c.json({ error: v.error }, 409);

  // Check for duplicate pending request on (person, requesterDate).
  const duplicates = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `AND({Status} = 'Pending', FIND('${escapeFormulaString(person.id)}', ARRAYJOIN({Requester})) > 0, {Requester Date} = '${escapeFormulaString(displayDate(requesterDate))}')`,
  });
  if (duplicates.length > 0) return c.json({ error: "Pending request already exists" }, 409);

  // Create the record. Single-select values are display strings, not ISO.
  const fields: Record<string, unknown> = {
    Department: [dept.id],
    Requester: [person.id],
    "Requester Email": callerEmail,
    "Requester Date": displayDate(requesterDate),
    Status: "Pending",
  };
  if (targetPersonId && targetDate) {
    fields.Target = [targetPersonId];
    fields["Target Date"] = displayDate(targetDate);
  }
  if (note) fields.Note = note;

  const created = await createRecord<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    fields,
  });

  return c.json({ id: created.id, status: "Pending" }, 201);
});
```

- [ ] **Step 2: Typecheck and smoke-test**

```bash
npx tsc --noEmit
npm run dev
```

```bash
# Replace placeholders. requesterDate must be ISO; you must be scheduled on that date.
curl -s -X POST http://localhost:3001/api/requests \
  -H "Content-Type: application/json" \
  -d '{"callerNetid":"YOUR_NETID","callerEmail":"YOUR_EMAIL","deptId":"recXXXX","requesterDate":"2026-05-30"}'
```

Expected: `{"id":"rec…", "status":"Pending"}` on success; 409 with a helpful error otherwise.

Verify the new row appears in Airtable with `Type` = `Drop` and `Status` = `Pending`.

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "feat(server): POST /requests creates pending shift change"
```

---

### Task P2.8: Add `POST /requests/:id/withdraw`

**Files:**
- Modify: `server/app.ts`

Only the requester can withdraw, and only while `Pending`.

- [ ] **Step 1: Add the route**

```ts
app.post("/requests/:id/withdraw", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const id = c.req.param("id");
  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string; callerEmail?: string;
  };
  if (!callerNetid || !callerEmail) return c.json({ error: "Missing callerNetid / callerEmail" }, 400);

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  // Load the request row.
  const matches = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `RECORD_ID() = '${escapeFormulaString(id)}'`,
  });
  const req = matches[0];
  if (!req) return c.json({ error: "Not found" }, 404);

  if (toIdList(req.fields.Requester)[0] !== person.id)
    return c.json({ error: "Not your request" }, 403);

  if (selectName(req.fields.Status) !== "Pending")
    return c.json({ error: "Already resolved" }, 409);

  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    recordId: id,
    fields: { Status: "Withdrawn", "Resolved At": new Date().toISOString() },
  });

  return c.json({ id, status: "Withdrawn" });
});
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add server/app.ts
git commit -m "feat(server): POST /requests/:id/withdraw"
```

---

### Task P2.9: Add `POST /requests/for-dept/:deptId`

**Files:**
- Modify: `server/app.ts`

Director-only. Reuses `manageableDeptIdsFor` for auth. Returns pending + last-14-days recent.

- [ ] **Step 1: Add the route**

```ts
app.post("/requests/for-dept/:deptId", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const deptId = c.req.param("deptId");
  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string; callerEmail?: string;
  };
  if (!callerNetid || !callerEmail) return c.json({ error: "Missing callerNetid / callerEmail" }, 400);

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  const allRoster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const manageable = manageableDeptIdsFor(allRoster, person.id);
  if (!manageable.has(deptId)) return c.json({ error: "Not authorized" }, 403);

  // All requests for this dept; we'll split client-side.
  const requests = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `FIND('${escapeFormulaString(deptId)}', ARRAYJOIN({Department})) > 0`,
  });

  // Load people referenced for name display.
  const ids = new Set<string>();
  for (const r of requests) {
    toIdList(r.fields.Requester).forEach((x) => ids.add(x));
    toIdList(r.fields.Target).forEach((x) => ids.add(x));
    toIdList(r.fields.Resolver).forEach((x) => ids.add(x));
  }
  const allPeople = await listAll<AllPeopleFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
  });
  const peopleById = new Map<string, AllPeopleFields & { id: string }>();
  for (const p of allPeople) {
    if (ids.has(p.id)) peopleById.set(p.id, { ...p.fields, id: p.id });
  }

  // We need to know each request's role for context. Cheapest way: load this
  // dept's schedule rows and look up requester role per (date).
  const dept = allRoster.find((r) => r.id === deptId);
  const scheduleRows = dept ? await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
    filterByFormula: `{Department} = '${escapeFormulaString(dept.fields["Department Name"] ?? "")}'`,
  }) : [];
  const scheduleByDate = new Map<string, { directors: string[]; volunteers: string[] }>();
  for (const row of scheduleRows) {
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    if (!iso) continue;
    scheduleByDate.set(iso, {
      directors: toIdList(row.fields["Directors on Shift"]),
      volunteers: toIdList(row.fields["Volunteers on Shift"]),
    });
  }

  function shape(r: AirtableRecord<ShiftRequestFields>) {
    const requesterId = toIdList(r.fields.Requester)[0] ?? "";
    const targetId = toIdList(r.fields.Target)[0] ?? null;
    const resolverId = toIdList(r.fields.Resolver)[0] ?? null;
    const requesterIso = normalizeVolunteerDate(selectName(r.fields["Requester Date"]));
    const targetIso = r.fields["Target Date"] ? normalizeVolunteerDate(selectName(r.fields["Target Date"])) : null;

    let role: "director" | "volunteer" = "volunteer";
    if (requesterIso) {
      const row = scheduleByDate.get(requesterIso);
      if (row?.directors.includes(requesterId)) role = "director";
    }

    const requesterPerson = peopleById.get(requesterId);
    const targetPerson = targetId ? peopleById.get(targetId) : null;
    const resolverPerson = resolverId ? peopleById.get(resolverId) : null;

    return {
      id: r.id,
      type: targetId ? "Named swap" as const : "Drop" as const,
      requester: {
        id: requesterId,
        name: requesterPerson?.Name ?? "",
        netid: requesterPerson?.NetID ?? "",
        role,
      },
      requesterDate: requesterIso ?? "",
      target: targetPerson ? {
        id: targetId as string,
        name: targetPerson.Name ?? "",
        netid: targetPerson.NetID ?? "",
      } : null,
      targetDate: targetIso,
      note: r.fields.Note ?? "",
      status: selectName(r.fields.Status) as "Pending" | "Approved" | "Rejected" | "Withdrawn",
      submittedAt: r.fields["Submitted At"] ?? "",
      resolvedAt: r.fields["Resolved At"] ?? null,
      resolver: resolverPerson ? { id: resolverId as string, name: resolverPerson.Name ?? "" } : null,
    };
  }

  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const pending = requests.filter((r) => selectName(r.fields.Status) === "Pending").map(shape);
  const recent = requests
    .filter((r) => {
      const s = selectName(r.fields.Status);
      if (s === "Pending") return false;
      const t = r.fields["Resolved At"];
      return t ? new Date(t).getTime() >= fourteenDaysAgo : false;
    })
    .map(shape)
    .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));

  return c.json({ pending, recent });
});
```

- [ ] **Step 2: Typecheck and smoke-test**

```bash
npx tsc --noEmit
npm run dev

curl -s -X POST http://localhost:3001/api/requests/for-dept/recXXXX \
  -H "Content-Type: application/json" \
  -d '{"callerNetid":"DIRECTOR_NETID","callerEmail":"DIRECTOR_EMAIL"}' | head -c 400
```

Expected: `{"pending":[...],"recent":[...]}`.

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "feat(server): POST /requests/for-dept/:deptId"
```

---

### Task P2.10: Add `POST /requests/:id/resolve` — the apply-on-approve path

**Files:**
- Modify: `server/app.ts`

The big one. Approve → re-validate against live schedule, build plan, execute, then flip status. Reject → just flip status.

- [ ] **Step 1: Add the route**

```ts
import { planApply, executeApply } from "./requests.js";

app.post("/requests/:id/resolve", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const id = c.req.param("id");
  const { callerNetid, callerEmail, action, note } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    action?: "approve" | "reject";
    note?: string;
  };
  if (!callerNetid || !callerEmail || (action !== "approve" && action !== "reject")) {
    return c.json({ error: "Missing or invalid fields" }, 400);
  }

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  // Load the request and confirm authorization.
  const reqMatches = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `RECORD_ID() = '${escapeFormulaString(id)}'`,
  });
  const req = reqMatches[0];
  if (!req) return c.json({ error: "Not found" }, 404);
  if (selectName(req.fields.Status) !== "Pending")
    return c.json({ error: "Already resolved" }, 409);

  const deptId = toIdList(req.fields.Department)[0];
  if (!deptId) return c.json({ error: "Invalid request: no department" }, 409);

  const allRoster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const manageable = manageableDeptIdsFor(allRoster, person.id);
  if (!manageable.has(deptId)) return c.json({ error: "Not authorized" }, 403);

  const requesterId = toIdList(req.fields.Requester)[0] ?? "";
  const targetId = toIdList(req.fields.Target)[0] ?? undefined;
  const requesterIso = normalizeVolunteerDate(selectName(req.fields["Requester Date"]));
  const targetIso = req.fields["Target Date"] ? normalizeVolunteerDate(selectName(req.fields["Target Date"])) : undefined;
  if (!requesterIso) return c.json({ error: "Invalid request: bad date" }, 409);

  // Reject path — short-circuit.
  if (action === "reject") {
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ShiftRequestsTableId,
      recordId: id,
      fields: {
        Status: "Rejected",
        Resolver: [person.id],
        "Resolved At": new Date().toISOString(),
        ...(note ? { "Resolution Note": note } : {}),
      },
    });
    return c.json({ id, status: "Rejected" });
  }

  // Approve path — re-validate against current schedule.
  const dept = allRoster.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);

  const scheduleRows = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
    filterByFormula: `{Department} = '${escapeFormulaString(dept.fields["Department Name"] ?? "")}'`,
  });

  const rowsForApply = scheduleRows
    .map((r) => {
      const iso = normalizeVolunteerDate(selectName(r.fields.Date));
      if (!iso) return null;
      return {
        id: r.id,
        date: iso,
        directorIds: toIdList(r.fields["Directors on Shift"]),
        volunteerIds: toIdList(r.fields["Volunteers on Shift"]),
      };
    })
    .filter((r): r is { id: string; date: string; directorIds: string[]; volunteerIds: string[] } => r !== null);

  const v = validateRequest({
    scheduleRows: rowsForApply,
    requesterId,
    requesterDate: requesterIso,
    targetId,
    targetDate: targetIso,
  });
  if (!v.ok) return c.json({ error: "Schedule has changed since request was submitted" }, 409);

  let ops;
  try {
    ops = planApply({
      scheduleRows: rowsForApply,
      requesterId,
      requesterDate: requesterIso,
      targetId,
      targetDate: targetIso,
    });
  } catch (err) {
    return c.json({ error: "Schedule has changed since request was submitted" }, 409);
  }

  const originalRows = new Map(rowsForApply.map((r) => [r.id, r] as const));

  try {
    await executeApply({
      baseId: config.haveNManagementBaseId,
      scheduleTableId: config.su26ScheduleTableId,
      ops,
      originalRows,
      patchRecord: (opts) => patchRecord(opts),
    });
  } catch (err) {
    console.error("Apply failed", err);
    return c.json({ error: "Apply failed", partial: { ops } }, 500);
  }

  // Flip status last so a partial apply doesn't leave us in a "resolved but un-applied" state.
  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    recordId: id,
    fields: {
      Status: "Approved",
      Resolver: [person.id],
      "Resolved At": new Date().toISOString(),
      ...(note ? { "Resolution Note": note } : {}),
    },
  });

  return c.json({ id, status: "Approved" });
});
```

- [ ] **Step 2: Typecheck and smoke-test**

```bash
npx tsc --noEmit
npm run dev
```

Create a real pending request first (you can use the curl from P2.7 against your own assignment), then approve it:

```bash
curl -s -X POST http://localhost:3001/api/requests/rec_REQUEST_ID/resolve \
  -H "Content-Type: application/json" \
  -d '{"callerNetid":"DIR_NETID","callerEmail":"DIR_EMAIL","action":"approve"}'
```

Expected: `{"id":"rec…","status":"Approved"}`. The corresponding `SU 26 Schedule` row in Airtable should now have the requester removed.

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "feat(server): POST /requests/:id/resolve with atomic schedule apply"
```

---

### Task P2.11: Extend `/director/:netid` with `pendingRequestCount`

**Files:**
- Modify: `server/app.ts`

Adds one count per manageable dept. Powers the "(N pending)" suffix.

- [ ] **Step 1: Find the existing `/director/:netid` handler and locate where it builds the `departments` array**

It's around line 172. There's a `sorted.map(...)` block that emits `{ id, name, scheduleStatus, submittedAt }`.

- [ ] **Step 2: Load pending counts per dept before the map**

Just before the `return c.json(...)` of that handler, fetch all pending requests in one query and group by dept:

```ts
const pendingForCounts = await listAll<ShiftRequestFields>({
  baseId: config.haveNManagementBaseId,
  tableId: config.su26ShiftRequestsTableId,
  filterByFormula: `{Status} = 'Pending'`,
});
const pendingCountByDept = new Map<string, number>();
for (const r of pendingForCounts) {
  const d = toIdList(r.fields.Department)[0];
  if (d) pendingCountByDept.set(d, (pendingCountByDept.get(d) ?? 0) + 1);
}
```

- [ ] **Step 3: Add the count to each department entry in the response**

Update the existing `departments` map to include `pendingRequestCount`:

```ts
departments: sorted.map((d) => ({
  id: d.id,
  name: d.fields["Department Name"] ?? "",
  scheduleStatus: selectName(d.fields["Schedule Status"]) || "Draft",
  submittedAt: d.fields["Submitted At"] ?? null,
  pendingRequestCount: pendingCountByDept.get(d.id) ?? 0,
})),
```

- [ ] **Step 4: Update `DepartmentRef` on the frontend**

In `src/api/types.ts`, add to `DepartmentRef`:

```ts
export type DepartmentRef = {
  id: string;
  name: string;
  scheduleStatus: "Draft" | "Submitted";
  submittedAt: string | null;
  pendingRequestCount: number;
};
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

The existing `DepartmentSwitcher` and any code that consumes `DepartmentRef` should still compile (we're adding a field, not breaking one).

- [ ] **Step 6: Commit**

```bash
git add server/app.ts src/api/types.ts
git commit -m "feat(server): include pendingRequestCount in /director payload"
```

---

### Task P2.12: Add frontend types + client wrappers

**Files:**
- Modify: `src/api/types.ts`
- Modify: `src/api/client.ts`

- [ ] **Step 1: Add the new types**

Append to `src/api/types.ts`:

```ts
export type MyAssignment = {
  deptId: string;
  deptName: string;
  date: string; // ISO
  role: "director" | "volunteer";
  pendingRequestId: string | null;
};

export type MyAssignmentsResponse = {
  person: { id: string; name: string; netid: string; email: string };
  assignments: MyAssignment[];
};

export type ShiftRequest = {
  id: string;
  type: "Drop" | "Named swap";
  requester: { id: string; name: string; netid: string; role: "director" | "volunteer" };
  requesterDate: string; // ISO
  target: { id: string; name: string; netid: string } | null;
  targetDate: string | null;
  note: string;
  status: "Pending" | "Approved" | "Rejected" | "Withdrawn";
  submittedAt: string;
  resolvedAt: string | null;
  resolver: { id: string; name: string } | null;
};

export type RequestsForDept = {
  pending: ShiftRequest[];
  recent: ShiftRequest[];
};
```

- [ ] **Step 2: Add the client wrappers**

Update `src/api/client.ts` imports:

```ts
import type {
  DirectorIdentity,
  ScheduleResponse,
  PublicDeptListItem,
  PublicSchedule,
  MyAssignmentsResponse,
  RequestsForDept,
} from "./types";
```

Add the methods to the `api` object:

```ts
myAssignments: (callerNetid: string, callerEmail: string) =>
  request<MyAssignmentsResponse>("/me/assignments", {
    method: "POST",
    body: JSON.stringify({ callerNetid, callerEmail }),
  }),

createRequest: (input: {
  callerNetid: string;
  callerEmail: string;
  deptId: string;
  requesterDate: string;
  targetNetid?: string;
  targetDate?: string;
  note?: string;
}) => request<{ id: string; status: "Pending" }>("/requests", {
  method: "POST",
  body: JSON.stringify(input),
}),

withdrawRequest: (id: string, callerNetid: string, callerEmail: string) =>
  request<{ id: string; status: "Withdrawn" }>(`/requests/${encodeURIComponent(id)}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ callerNetid, callerEmail }),
  }),

requestsForDept: (deptId: string, callerNetid: string, callerEmail: string) =>
  request<RequestsForDept>(`/requests/for-dept/${encodeURIComponent(deptId)}`, {
    method: "POST",
    body: JSON.stringify({ callerNetid, callerEmail }),
  }),

resolveRequest: (id: string, input: {
  callerNetid: string;
  callerEmail: string;
  action: "approve" | "reject";
  note?: string;
}) => request<{ id: string; status: "Approved" | "Rejected" }>(`/requests/${encodeURIComponent(id)}/resolve`, {
  method: "POST",
  body: JSON.stringify(input),
}),
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/api/types.ts src/api/client.ts
git commit -m "feat(client): types + wrappers for shift-request endpoints"
```

---

### Task P2.13: Build `SignInToRequest` + extend `PublicScheduleView` with it

**Files:**
- Create: `src/app/components/view/SignInToRequest.tsx`
- Modify: `src/app/components/view/PublicScheduleView.tsx`

A small NetID + email form below the public viewer. On success, exposes the caller via `onSignedIn`.

- [ ] **Step 1: Create the component**

```tsx
// src/app/components/view/SignInToRequest.tsx
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { MyAssignmentsResponse } from "@/api/types";

export function SignInToRequest({
  onSignedIn,
}: {
  onSignedIn: (data: MyAssignmentsResponse, credentials: { netid: string; email: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [netid, setNetid] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!netid.trim() || !email.trim()) return;
    setSubmitting(true);
    try {
      const data = await api.myAssignments(netid.trim(), email.trim());
      onSignedIn(data, { netid: netid.trim(), email: email.trim() });
    } catch (err) {
      toast.error((err as Error).message ?? "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Need to drop or swap a shift?</h2>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] transition-colors"
        >
          Sign in with NetID + email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl shadow-lg p-6 space-y-3">
      <h2 className="text-lg font-semibold">Sign in</h2>
      <input
        type="text"
        placeholder="NetID"
        value={netid}
        onChange={(e) => setNetid(e.target.value)}
        className="w-full p-2 border border-slate-300 rounded-md"
        autoComplete="username"
        required
      />
      <input
        type="email"
        placeholder="Yale email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full p-2 border border-slate-300 rounded-md"
        autoComplete="email"
        required
      />
      <button
        type="submit"
        disabled={submitting}
        className="bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] transition-colors disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Wire it into `PublicScheduleView`**

In `src/app/components/view/PublicScheduleView.tsx`:

```tsx
// at top of file
import { SignInToRequest } from "./SignInToRequest";
import { MyAssignments } from "./MyAssignments";
import type { MyAssignmentsResponse } from "@/api/types";

// add state inside the component:
const [signedIn, setSignedIn] = useState<{
  data: MyAssignmentsResponse;
  credentials: { netid: string; email: string };
} | null>(null);

function refetchAssignments() {
  if (!signedIn) return;
  api.myAssignments(signedIn.credentials.netid, signedIn.credentials.email)
    .then((data) => setSignedIn({ ...signedIn, data }))
    .catch((err) => toast.error(err.message ?? "Failed to refresh"));
}

// at the end of the JSX, after the schedule card:
{signedIn ? (
  <MyAssignments
    data={signedIn.data}
    credentials={signedIn.credentials}
    onChanged={refetchAssignments}
  />
) : (
  <SignInToRequest
    onSignedIn={(data, credentials) => setSignedIn({ data, credentials })}
  />
)}
```

- [ ] **Step 3: Stub `MyAssignments` so the file compiles**

```tsx
// src/app/components/view/MyAssignments.tsx
import type { MyAssignmentsResponse } from "@/api/types";

export function MyAssignments({
  data,
}: {
  data: MyAssignmentsResponse;
  credentials: { netid: string; email: string };
  onChanged: () => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-lg font-semibold mb-2">My assignments</h2>
      <pre className="text-xs">{JSON.stringify(data.assignments, null, 2)}</pre>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and verify in dev**

```bash
npx tsc --noEmit
npm run dev
```

At `/view`, sign in with a real NetID + email — your assignments should appear as raw JSON.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/view/SignInToRequest.tsx src/app/components/view/MyAssignments.tsx src/app/components/view/PublicScheduleView.tsx
git commit -m "feat(view): sign-in below public viewer with my-assignments stub"
```

---

### Task P2.14: Build the real `MyAssignments` + `RequestSwapModal`

**Files:**
- Modify: `src/app/components/view/MyAssignments.tsx`
- Create: `src/app/components/view/RequestSwapModal.tsx`

`MyAssignments` lists each Saturday with role + dept + a Request swap (or Withdraw) button. The modal is the form.

- [ ] **Step 1: Replace `MyAssignments` with the full version**

```tsx
// src/app/components/view/MyAssignments.tsx
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { MyAssignment, MyAssignmentsResponse } from "@/api/types";
import { RequestSwapModal } from "./RequestSwapModal";
import { displayDate } from "./displayDate";

export function MyAssignments({
  data,
  credentials,
  onChanged,
}: {
  data: MyAssignmentsResponse;
  credentials: { netid: string; email: string };
  onChanged: () => void;
}) {
  const [openFor, setOpenFor] = useState<MyAssignment | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  async function withdraw(requestId: string) {
    setWithdrawing(requestId);
    try {
      await api.withdrawRequest(requestId, credentials.netid, credentials.email);
      toast.success("Request withdrawn");
      onChanged();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to withdraw");
    } finally {
      setWithdrawing(null);
    }
  }

  if (data.assignments.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-2">My assignments</h2>
        <p className="text-sm text-slate-500">You're not currently scheduled for any clinic Saturdays.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-lg p-6 space-y-3">
        <h2 className="text-lg font-semibold">My assignments</h2>
        {data.assignments.map((a, idx) => (
          <div
            key={`${a.deptId}|${a.date}|${idx}`}
            className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-b-0"
          >
            <div>
              <div className="font-medium">
                {displayDate(a.date)} — {a.deptName}
              </div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">
                {a.role}
              </div>
            </div>
            {a.pendingRequestId ? (
              <button
                type="button"
                onClick={() => withdraw(a.pendingRequestId!)}
                disabled={withdrawing === a.pendingRequestId}
                className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {withdrawing === a.pendingRequestId ? "Withdrawing…" : "Pending — withdraw"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setOpenFor(a)}
                className="text-sm bg-[#0F4D92] text-white rounded-md px-3 py-1.5 hover:bg-[#0B3D75]"
              >
                Request swap
              </button>
            )}
          </div>
        ))}
      </div>

      {openFor && (
        <RequestSwapModal
          assignment={openFor}
          credentials={credentials}
          onClose={() => setOpenFor(null)}
          onSubmitted={() => {
            setOpenFor(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create the modal**

```tsx
// src/app/components/view/RequestSwapModal.tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { MyAssignment, PublicSchedule } from "@/api/types";
import { displayDate } from "./displayDate";

type Mode = "drop" | "named";

export function RequestSwapModal({
  assignment,
  credentials,
  onClose,
  onSubmitted,
}: {
  assignment: MyAssignment;
  credentials: { netid: string; email: string };
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [mode, setMode] = useState<Mode>("drop");
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null);
  const [targetName, setTargetName] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Load the dept's schedule so we can show the partner picker.
  useEffect(() => {
    api.viewSchedule(assignment.deptId)
      .then(setSchedule)
      .catch((err) => toast.error((err as Error).message ?? "Failed to load dept schedule"));
  }, [assignment.deptId]);

  // Map "name" → list of dates that person is on (same role, not our own date).
  const peopleWithDates = (() => {
    if (!schedule) return new Map<string, string[]>();
    const roleKey = assignment.role === "director" ? "directors" : "volunteers";
    const out = new Map<string, string[]>();
    for (const d of schedule.dates) {
      if (d.date === assignment.date) continue;
      for (const p of d[roleKey]) {
        if (!out.has(p.name)) out.set(p.name, []);
        out.get(p.name)!.push(d.date);
      }
    }
    return out;
  })();

  const partnerOptions = [...peopleWithDates.keys()].sort();
  const partnerDateOptions = targetName ? peopleWithDates.get(targetName) ?? [] : [];

  async function submit() {
    if (mode === "named" && (!targetName || !targetDate)) {
      toast.error("Pick a partner and their date");
      return;
    }
    setSubmitting(true);
    try {
      // The partner picker selects by display name; we need a NetID to send.
      // For v2 we resolve via a synthetic call: but PublicSchedule omits NetID.
      // Trade-off: ask the server to accept partner by name within this dept.
      // To keep the surface clean we send the name as `targetNetid` only if it
      // happens to be a NetID; otherwise we add a tiny server-side resolver
      // step. For now: send the name verbatim — the server validates the role
      // + date match against the schedule and returns 409 on mismatch.
      const targetNetid = mode === "named" ? targetName : undefined;
      await api.createRequest({
        callerNetid: credentials.netid,
        callerEmail: credentials.email,
        deptId: assignment.deptId,
        requesterDate: assignment.date,
        targetNetid,
        targetDate: mode === "named" ? targetDate : undefined,
        note: note || undefined,
      });
      toast.success("Request submitted");
      onSubmitted();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-semibold">
          Request a swap — {displayDate(assignment.date)} · {assignment.deptName}
        </h2>

        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === "drop"}
              onChange={() => setMode("drop")}
            />
            Just drop this shift
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={mode === "named"}
              onChange={() => setMode("named")}
            />
            Swap with a specific person
          </label>
        </div>

        {mode === "named" && (
          <>
            <select
              value={targetName}
              onChange={(e) => {
                setTargetName(e.target.value);
                setTargetDate("");
              }}
              className="w-full p-2 border border-slate-300 rounded-md"
            >
              <option value="">Select a partner</option>
              {partnerOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            {targetName && (
              <select
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-md"
              >
                <option value="">Take which of their shifts?</option>
                {partnerDateOptions.map((iso) => (
                  <option key={iso} value={iso}>{displayDate(iso)}</option>
                ))}
              </select>
            )}
          </>
        )}

        <textarea
          placeholder="Optional note for the director"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full p-2 border border-slate-300 rounded-md min-h-24"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

> **Important deviation note for the engineer:** the modal sends `targetNetid: <name>` for v2 because `PublicSchedule` redacts NetIDs. The server's `/requests` endpoint already does a NetID lookup via `escapeFormulaString(targetNetid)` against `{NetID}`; since names won't match `{NetID}` it will return 409 `"Partner is not eligible"`. **Before shipping the modal**, modify the server's `/requests` route to additionally try to resolve by `{Name}` within the dept's same-role pool if the NetID lookup misses. See step 3.

- [ ] **Step 3: Patch `/requests` to resolve `targetNetid` as a name fallback**

In `server/app.ts` `/requests` route, replace the `targetNetid → targetPersonId` block with:

```ts
let targetPersonId: string | undefined;
if (targetNetid) {
  // Try NetID first; fall back to Name within the dept's same-role pool.
  const byNetid = await listAll<AllPeopleFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
    filterByFormula: `{NetID} = '${escapeFormulaString(targetNetid)}'`,
  });
  if (byNetid[0]) {
    targetPersonId = byNetid[0].id;
  } else {
    const byName = await listAll<AllPeopleFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.allPeopleTableId,
      filterByFormula: `{Name} = '${escapeFormulaString(targetNetid)}'`,
    });
    targetPersonId = byName[0]?.id;
  }
  if (!targetPersonId) return c.json({ error: "Partner is not eligible" }, 409);
}
```

- [ ] **Step 4: Typecheck and smoke-test the full request flow**

```bash
npx tsc --noEmit
npm run dev
```

Sign in at `/view`, pick one of your shifts, click "Request swap", try both modes (drop and named), submit. The Airtable row should appear; "Pending — withdraw" should show next time you reload.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/view/MyAssignments.tsx src/app/components/view/RequestSwapModal.tsx server/app.ts
git commit -m "feat(view): my assignments + request swap modal; server resolves partner by name fallback"
```

---

### Task P2.15: Build `PendingRequestsTab` and wire into `ScheduleBuilder` + dept switcher

**Files:**
- Create: `src/app/components/schedule/PendingRequestsTab.tsx`
- Modify: `src/app/components/schedule/DepartmentSwitcher.tsx`
- Modify: `src/app/components/ScheduleBuilder.tsx`

- [ ] **Step 1: Create the tab component**

```tsx
// src/app/components/schedule/PendingRequestsTab.tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { RequestsForDept, ShiftRequest } from "@/api/types";
import { displayDate } from "../view/displayDate";

export function PendingRequestsTab({
  deptId,
  credentials,
  onChanged,
}: {
  deptId: string;
  credentials: { netid: string; email: string };
  onChanged: () => void;
}) {
  const [data, setData] = useState<RequestsForDept | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectNoteOpen, setRejectNoteOpen] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  function refresh() {
    api.requestsForDept(deptId, credentials.netid, credentials.email)
      .then(setData)
      .catch((err) => toast.error((err as Error).message ?? "Failed to load requests"));
  }

  useEffect(refresh, [deptId, credentials.netid, credentials.email]);

  async function resolve(id: string, action: "approve" | "reject", note?: string) {
    setBusy(id);
    try {
      await api.resolveRequest(id, {
        callerNetid: credentials.netid,
        callerEmail: credentials.email,
        action,
        note,
      });
      toast.success(action === "approve" ? "Approved — schedule updated" : "Request rejected");
      onChanged();
      refresh();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to resolve");
    } finally {
      setBusy(null);
      setRejectNoteOpen(null);
      setRejectNote("");
    }
  }

  if (!data) return <div className="text-sm text-slate-500 p-4">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-2">Pending</h3>
        {data.pending.length === 0 ? (
          <p className="text-sm text-slate-500">No pending requests for this department.</p>
        ) : (
          <ul className="space-y-3">
            {data.pending.map((r) => (
              <li key={r.id} className="border border-slate-200 rounded-md p-3">
                <div className="font-medium">{summary(r)}</div>
                {r.note && <div className="text-sm text-slate-600 mt-1">"{r.note}"</div>}
                <div className="text-xs text-slate-500 mt-1">
                  Submitted {new Date(r.submittedAt).toLocaleString()}
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => resolve(r.id, "approve")}
                    disabled={busy === r.id}
                    className="bg-[#0F4D92] text-white rounded-md px-3 py-1.5 text-sm hover:bg-[#0B3D75] disabled:opacity-50"
                  >
                    {busy === r.id ? "Working…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectNoteOpen(rejectNoteOpen === r.id ? null : r.id)}
                    disabled={busy === r.id}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Reject
                  </button>
                </div>
                {rejectNoteOpen === r.id && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Optional note for the requester"
                      className="w-full p-2 border border-slate-300 rounded-md text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => resolve(r.id, "reject", rejectNote || undefined)}
                      disabled={busy === r.id}
                      className="bg-red-600 text-white rounded-md px-3 py-1.5 text-sm hover:bg-red-700 disabled:opacity-50"
                    >
                      Confirm reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.recent.length > 0 && (
        <div>
          <h3 className="text-base font-semibold mb-2 text-slate-500">Recently resolved (last 14 days)</h3>
          <ul className="space-y-2">
            {data.recent.map((r) => (
              <li key={r.id} className="text-sm text-slate-500">
                <span className="uppercase text-xs tracking-wide mr-2">{r.status}</span>
                {summary(r)} — {r.resolver?.name ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function summary(r: ShiftRequest): string {
  const requesterStr = `${r.requester.name} (${r.requester.role})`;
  if (r.type === "Drop") {
    return `Drop ${requesterStr}'s ${displayDate(r.requesterDate)} shift`;
  }
  return `Swap ${requesterStr}'s ${displayDate(r.requesterDate)} for ${r.target?.name}'s ${
    r.targetDate ? displayDate(r.targetDate) : "?"
  }`;
}
```

- [ ] **Step 2: Add the pending suffix to `DepartmentSwitcher`**

Replace the `<option>` line:

```tsx
{departments.map((d) => (
  <option key={d.id} value={d.id}>
    {d.name}{d.pendingRequestCount > 0 ? ` (${d.pendingRequestCount} pending)` : ""}
  </option>
))}
```

Also handle the single-dept case — show the suffix inline:

```tsx
if (departments.length === 1) {
  const only = departments[0];
  return (
    <div className="text-lg font-semibold">
      {only.name}
      {only.pendingRequestCount > 0 && (
        <span className="ml-2 text-sm text-amber-600">({only.pendingRequestCount} pending)</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire `PendingRequestsTab` into `ScheduleBuilder`**

`ScheduleBuilder.tsx` does not use a shadcn `Tabs` component — it has a custom button-group `editMode` toggle (`"assign" | "availability"`). Add a third mode `"requests"` and render `PendingRequestsTab` instead of the schedule grid when it's selected.

Open `src/app/components/ScheduleBuilder.tsx`.

Add the import at the top of the file:

```tsx
import { PendingRequestsTab } from "./schedule/PendingRequestsTab";
```

Change the `editMode` state type to add the third option:

```tsx
const [editMode, setEditMode] = useState<"assign" | "availability" | "requests">("assign");
```

Compute the pending count near the other derived values:

```tsx
const pendingCount =
  identity.departments.find((d) => d.id === selectedDeptId)?.pendingRequestCount ?? 0;
```

Update the mode-button group (currently iterates `["assign", "availability"] as const`) to include `"requests"` and render labels with the count:

```tsx
<div className="inline-flex border border-slate-300 rounded-lg overflow-hidden">
  {(["assign", "availability", "requests"] as const).map((m) => (
    <button
      key={m}
      onClick={() => setEditMode(m)}
      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
        editMode === m
          ? m === "availability"
            ? "bg-amber-500 text-white"
            : "bg-[#0F4D92] text-white"
          : "bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {m === "assign"
        ? "Assign"
        : m === "availability"
          ? "Edit availability"
          : `Pending Requests${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
    </button>
  ))}
</div>
```

Wrap the existing schedule rendering (the `mode === "saturday" ? <SaturdayView ... /> : <GridView ... />` block) so it only renders when `editMode !== "requests"`. After that block, add the requests panel:

```tsx
{editMode === "requests" ? (
  <PendingRequestsTab
    deptId={selectedDeptId}
    credentials={{ netid: identity.person.netid, email: identity.person.email }}
    onChanged={reload}
  />
) : mode === "saturday" ? (
  <SaturdayView
    /* ...existing props... */
  />
) : (
  <GridView
    /* ...existing props... */
  />
)}
```

The existing `reload` callback (defined around line 30 as `useCallback`) is what re-fetches the schedule — pass it to `onChanged` so an approved request's schedule edit shows up immediately.

Also gate the existing `ViewToggle`, `editMode === "availability"` amber banner, `StatsBar`, and the bottom save/submit action bar so they only render when `editMode !== "requests"`. The Pending Requests view should be focused — no surrounding chrome that doesn't apply to it.

The `handleToggle` callback at line 151 already only does anything meaningful when `editMode` is `assign` or `availability`; with `editMode === "requests"` it won't be called because the schedule grid isn't rendered. No change needed there.

- [ ] **Step 4: Typecheck and verify in dev**

```bash
npx tsc --noEmit
npm run dev
```

Sign in as a director who manages a dept with a pending request. Expect:
1. Dept switcher shows "Dept (1 pending)".
2. A new "Pending Requests (1)" tab appears.
3. Open it → see the request → Approve → toast appears, request disappears from Pending, schedule view refetches, the requester is no longer on that Saturday.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/schedule/PendingRequestsTab.tsx src/app/components/schedule/DepartmentSwitcher.tsx src/app/components/ScheduleBuilder.tsx
git commit -m "feat(schedule): pending requests tab with dept switcher count badge"
```

---

### Phase 2 deploy checkpoint

- [ ] **Push and end-to-end smoke test in prod**

```bash
git push origin main
```

After Vercel deploys, run the following dry run with a real test user (preferably yourself):

1. Open `https://schedule.havenfreeclinic.com/view` in an incognito window.
2. Pick a submitted department; the schedule renders.
3. Sign in with your NetID + email; "My assignments" populates.
4. Click "Request swap" on a real shift; submit a drop. The Airtable record appears; on reload the row shows "Pending — withdraw".
5. Sign in to the director portal from the other landing card with a director account that manages that dept; the dept switcher shows "(1 pending)".
6. Open the Pending Requests tab; approve the request; verify the `SU 26 Schedule` row in Airtable is updated.
7. (Optional) Test rejection on a second request and named swap on a third.

If any step misbehaves, capture the network call + Airtable state and triage before merging in further changes.

---

## Self-review checklist (this plan)

- ✅ Each spec section maps to at least one task:
  - "Public read view" → P1.1–P1.6
  - "Data sources / new table" → P2.1 (Airtable) + P2.2 (env)
  - "Validation invariants" → P2.3
  - "Apply-approved-swap" → P2.4 + P2.5 + integrated in P2.10
  - "Public endpoints" → P1.2
  - "Self-service endpoints" → P2.6, P2.7, P2.8
  - "Director endpoints" → P2.9, P2.10
  - "pendingRequestCount piggyback" → P2.11
  - "Landing cards + view step" → P1.5
  - "Public viewer reuse" → P1.4 + P1.6
  - "SignInToRequest + MyAssignments + RequestSwapModal" → P2.13 + P2.14
  - "PendingRequestsTab + dept switcher suffix" → P2.15
  - "Failure modes" → tested in P2.3/P2.5; manual at deploy checkpoints
- ✅ No `TBD` / `TODO` / "add appropriate error handling".
- ✅ Type consistency: `MyAssignment`, `ShiftRequest`, `RequestsForDept`, `PendingRequestsTab.tsx` use the same field names everywhere.
- ⚠ Known coupling: P2.14 (modal) ships `targetNetid` as a name and depends on the server-side name fallback added in the same task. Both halves land together — the name fallback step is part of P2.14, not a separate task.

## Out of scope (re-emphasized)

- Email sending — Airtable automations only.
- Sessions — caller re-auths each visit.
- Cross-department named swaps.
- Bulk approve/reject.
- A user-visible history of resolved requests (only `pendingRequestId` surfaces in `MyAssignments`).
- Named-partner email confirmation flow.
