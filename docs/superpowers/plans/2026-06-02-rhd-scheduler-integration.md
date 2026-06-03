# RHD Scheduler Integration (SCTS / JCTS / CCRH) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate the PCAR Med Team integration for the three RHD departments (SCTS/JCTS/CCRH) and add a per-clinic readiness panel (attending procedure-eligibility + RN/depo coverage), so both RHD spreadsheets can be retired in one cutover.

**Architecture:** Reuse the existing per-department schedule machinery (the same `Volunteers on Shift` / `Shadow Volunteers on Shift` model PCAR uses — the RHD department *is* the role, so no new role-flag lists). Add one person attribute (`Licensed RN`), two small Airtable reference tables (`RHD Attendings` for the procedure-qualification matrix, `RHD Clinics` for per-Saturday attending/director/procedures-booked), one pure server module (`server/rhd.ts`) holding all testable logic, two thin endpoints, a `ClinicReadinessPanel` component, and a one-time migration script mirroring `scripts/import-medteam.ts`.

**Tech Stack:** Vite + React 18 + TypeScript (frontend), Hono + Airtable REST (`server/`), vitest, `xlsx` (SheetJS, dev-only) + `tsx` for the migration.

**Spec:** `docs/superpowers/specs/2026-06-02-rhd-scheduler-integration-design.md`

**Conventions every task follows:**
- This repo unit-tests **pure modules only** (`server/tests/*`, `src/tests/*` cover `medteam.ts`, `capacity.ts`, `requests.ts`, `compliance.ts`, etc.). Hono routes and React components are verified via `npx tsc --noEmit` + `npm run build` + the existing suite, **not** new route/component unit tests. Tasks below follow that split: full TDD for `server/rhd.ts`; type/compile/build verification for plumbing and UI.
- Run the full check before each commit: `npx vitest run && npx tsc --noEmit && npm run build`.
- Work happens in the existing worktree on branch `worktree-feat+rhd-integration`. Only `git add`/`git commit` on this branch — never `checkout`/`switch`/`cherry-pick`/`rebase` (concurrent sessions share the parent checkout).
- Never commit `*.xlsx` (gitignored — they may carry PHI). The migration reads only the `Summer 2026` and `ATTENDING QUALS`/`SETTINGS` tabs and never the `LCC RHD SCTMs` or any per-patient tab.

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `server/rhd.ts` | Pure logic: `parseRhdCell`, `buildRhdImportPlan`, `computeClinicReadiness` + their types | Create |
| `server/tests/rhd.test.ts` | Unit tests for `server/rhd.ts` | Create |
| `server/config.ts` | Add **optional** `rhdAttendingsTableId` / `rhdClinicsTableId` (not in the required gate) | Modify |
| `server/app.ts` | `Licensed RN` field type + read; `RhdAttendingFields`/`RhdClinicFields` types; `POST /rhd/readiness` + `POST /rhd/clinic` | Modify |
| `src/api/types.ts` | `licensedRN?` on `Person`; `Attending`, `ProcedureStatus`, `ClinicReadiness`, `RhdReadinessResponse` | Modify |
| `src/api/client.ts` | `rhdReadiness(...)` + `setRhdClinic(...)` | Modify |
| `src/app/components/schedule/PersonRow.tsx` | "RN" badge | Modify |
| `src/app/components/schedule/ClinicReadinessPanel.tsx` | Readiness card (procedures / depo / coverage / cap / director / emails) | Create |
| `src/app/components/schedule/SaturdayView.tsx` | Render `ClinicReadinessPanel` for RHD depts on the active date | Modify |
| `src/app/components/ScheduleBuilder.tsx` | Fetch `/rhd/readiness` for RHD depts; wire `/rhd/clinic` edits | Modify |
| `scripts/import-rhd.ts` | One-time migration (roster + assignments + attendings + clinics) | Create |
| `.env.example` / `.env.local` | `RHD_ATTENDINGS_TABLE_ID`, `RHD_CLINICS_TABLE_ID` | Modify |

**RHD department mapping (used everywhere):** `SCTM`→`SCTS`, `JCTM`→`JCTS`, `CC`→`CCRH`. `MANAGES_OTHER_DEPTS.SRHD` already grants these (`server/app.ts:122`).

---

## Task 1: Airtable schema + config wiring

Creates the new Airtable schema (via the Airtable MCP against base `HAVEN_MGMT_BASE_ID`) and threads two **optional** table IDs through config. Optional (not in `loadConfig`'s required gate) so a deployment without RHD env vars keeps the whole portal working — only the RHD endpoints degrade.

**Files:**
- Modify: `server/config.ts`
- Modify: `.env.example`, `.env.local`

- [ ] **Step 1: Create the `Licensed RN` field on All People**

Via the Airtable MCP (`mcp__claude_ai_Airtable__create_field`), on the All People table (`ALL_PEOPLE_TABLE_ID` in the `HAVEN_MGMT_BASE_ID` base): a **checkbox** field named exactly `Licensed RN`.

- [ ] **Step 2: Create the `RHD Attendings` table**

`mcp__claude_ai_Airtable__create_table` in the `HAVEN_MGMT_BASE_ID` base, named `RHD Attendings`, with fields:
- `Schedule Name` — singleLineText (primary)
- `Full Name` — singleLineText
- `IUD In`, `IUD Out`, `Nexplanon`, `GAC`, `EMB`, `Sees Male` — each a **singleSelect** with options `Yes`, `No` (left blank = "unknown"; single-select, *not* checkbox, so the spec §8 "unknown → verify" state is representable)
- `Notes` — multilineText

Record the returned table ID.

- [ ] **Step 3: Create the `RHD Clinics` table**

`mcp__claude_ai_Airtable__create_table` in the same base, named `RHD Clinics`, with fields:
- `Date` — singleLineText (primary; stores the display date e.g. `May 30th`, same convention as the Schedule table's `Date`)
- `Attending` — multipleRecordLinks → `RHD Attendings` (single link in practice)
- `Director on point` — singleLineText
- `Procedures Booked` — number (integer, precision 0)

Record the returned table ID.

- [ ] **Step 4: Add env vars**

Append to `.env.example`:
```
# RHD (SRHD) integration — reference tables in the HAVEN Management base
RHD_ATTENDINGS_TABLE_ID=
RHD_CLINICS_TABLE_ID=
```
Add the two real IDs (from Steps 2–3) to `.env.local`.

- [ ] **Step 5: Add optional IDs to config (not the required gate)**

Modify `server/config.ts`. Add to the `Config` type (after `complianceTableId`):
```ts
  /** RHD reference tables. Optional — absent in non-RHD deployments; the
   *  /rhd/* endpoints return a clear error when unset rather than 400-ing the app. */
  rhdAttendingsTableId?: string;
  rhdClinicsTableId?: string;
```
Change the `return` so these are read but NOT part of the required loop:
```ts
  for (const v of Object.values(required)) {
    if (!v) return null;
  }
  return {
    ...required,
    rhdAttendingsTableId: process.env.RHD_ATTENDINGS_TABLE_ID,
    rhdClinicsTableId: process.env.RHD_CLINICS_TABLE_ID,
  } as Config;
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; 72 tests pass.
```bash
git add server/config.ts .env.example
git commit -m "feat(rhd): config wiring for RHD Attendings/Clinics tables + Licensed RN"
```
(Do not commit `.env.local` — it is gitignored.)

---

## Task 2: `computeClinicReadiness` (pure) + types

The heart of the readiness panel. Pure, fully tested. Defines the shared shapes too.

**Files:**
- Create: `server/rhd.ts`
- Create: `server/tests/rhd.test.ts`
- Modify: `src/api/types.ts`

- [ ] **Step 1: Write failing tests**

Create `server/tests/rhd.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeClinicReadiness, type ClinicInput } from "../rhd.js";

const attending = {
  id: "att1",
  scheduleName: "Rivera",
  fullName: "Nina Rivera, MD",
  procedures: {
    iudIn: "yes", iudOut: "yes", nexplanon: "yes",
    gac: "no", emb: "yes", seesMale: "no",
  },
} as const;

function person(id: string, opts: { rn?: boolean; es?: boolean } = {}) {
  return { id, email: `${id}@yale.edu`, licensedRN: !!opts.rn, spanishSpeaking: !!opts.es };
}

const base: ClinicInput = {
  date: "2026-06-13",
  attending,
  director: "KM",
  sctsOnShift: [person("a"), person("b", { rn: true })],
  jctsOnShift: [person("c", { es: true })],
  ccrhOnShift: [person("d")],
  proceduresBooked: null,
  maxProceduresPerClinic: 3,
};

describe("computeClinicReadiness", () => {
  it("copies the attending's procedure statuses", () => {
    const r = computeClinicReadiness(base);
    expect(r.procedures.iudIn).toBe("yes");
    expect(r.procedures.gac).toBe("no");
  });

  it("marks every procedure unknown when there is no attending", () => {
    const r = computeClinicReadiness({ ...base, attending: null, sctsOnShift: [person("a")] });
    expect(r.procedures.iudIn).toBe("unknown");
    expect(r.procedures.seesMale).toBe("unknown");
    expect(r.closed).toBe(false); // people are on shift
  });

  it("counts coverage across the three departments", () => {
    const r = computeClinicReadiness(base);
    expect(r.coverage.sctm).toBe(2);
    expect(r.coverage.jctm).toBe(1);
    expect(r.coverage.rn).toBe(1);
    expect(r.coverage.spanish).toBe(1);
  });

  it("depoOk only when at least one RN is on shift", () => {
    expect(computeClinicReadiness(base).depoOk).toBe(true);
    const noRn = { ...base, sctsOnShift: [person("a")], ccrhOnShift: [person("d")], jctsOnShift: [] };
    expect(computeClinicReadiness(noRn).depoOk).toBe(false);
  });

  it("warns when booked procedures exceed the cap", () => {
    expect(computeClinicReadiness({ ...base, proceduresBooked: 4 }).procedureCapWarning).toBe(true);
    expect(computeClinicReadiness({ ...base, proceduresBooked: 3 }).procedureCapWarning).toBe(false);
    expect(computeClinicReadiness({ ...base, proceduresBooked: null }).procedureCapWarning).toBe(false);
  });

  it("treats an empty, attending-less clinic as closed with no warnings", () => {
    const r = computeClinicReadiness({
      ...base, attending: null, director: null,
      sctsOnShift: [], jctsOnShift: [], ccrhOnShift: [], proceduresBooked: 9,
    });
    expect(r.closed).toBe(true);
    expect(r.depoOk).toBe(true);
    expect(r.procedureCapWarning).toBe(false);
  });

  it("dedupes and sorts the clinic email list", () => {
    const r = computeClinicReadiness({
      ...base,
      sctsOnShift: [person("b"), person("a")],
      jctsOnShift: [{ id: "a", email: "a@yale.edu", licensedRN: false, spanishSpeaking: false }],
      ccrhOnShift: [],
    });
    expect(r.emails).toEqual(["a@yale.edu", "b@yale.edu"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/rhd.test.ts`
Expected: FAIL — `Cannot find module '../rhd.js'`.

- [ ] **Step 3: Implement `server/rhd.ts` (readiness half)**

Create `server/rhd.ts`:
```ts
export type ProcedureStatus = "yes" | "no" | "unknown";

export type ProcedureKey = "iudIn" | "iudOut" | "nexplanon" | "gac" | "emb" | "seesMale";

export const PROCEDURE_KEYS: ProcedureKey[] = [
  "iudIn", "iudOut", "nexplanon", "gac", "emb", "seesMale",
];

export type Attending = {
  id: string;
  scheduleName: string;
  fullName: string;
  procedures: Record<ProcedureKey, ProcedureStatus>;
  notes?: string;
};

export type PersonLite = {
  id: string;
  email: string;
  licensedRN: boolean;
  spanishSpeaking: boolean;
};

export type ClinicInput = {
  date: string; // ISO
  attending: Attending | null;
  director: string | null;
  sctsOnShift: PersonLite[];
  jctsOnShift: PersonLite[];
  ccrhOnShift: PersonLite[];
  proceduresBooked: number | null;
  maxProceduresPerClinic: number;
};

export type ClinicReadiness = {
  date: string;
  closed: boolean;
  attending: Attending | null;
  director: string | null;
  procedures: Record<ProcedureKey, ProcedureStatus>;
  coverage: { sctm: number; jctm: number; rn: number; spanish: number };
  depoOk: boolean;
  proceduresBooked: number | null;
  procedureCapWarning: boolean;
  emails: string[];
};

function unknownProcedures(): Record<ProcedureKey, ProcedureStatus> {
  return { iudIn: "unknown", iudOut: "unknown", nexplanon: "unknown", gac: "unknown", emb: "unknown", seesMale: "unknown" };
}

export function computeClinicReadiness(input: ClinicInput): ClinicReadiness {
  const all = dedupeById([...input.sctsOnShift, ...input.jctsOnShift, ...input.ccrhOnShift]);
  const closed = input.attending == null && all.length === 0;
  const rn = all.filter((p) => p.licensedRN).length;
  const emails = [...new Set(all.map((p) => p.email).filter(Boolean))].sort();

  return {
    date: input.date,
    closed,
    attending: input.attending,
    director: input.director,
    procedures: input.attending ? input.attending.procedures : unknownProcedures(),
    coverage: {
      sctm: input.sctsOnShift.length,
      jctm: input.jctsOnShift.length,
      rn,
      spanish: all.filter((p) => p.spanishSpeaking).length,
    },
    depoOk: closed ? true : rn >= 1,
    proceduresBooked: input.proceduresBooked,
    procedureCapWarning:
      !closed && input.proceduresBooked != null && input.proceduresBooked > input.maxProceduresPerClinic,
    emails,
  };
}

function dedupeById(people: PersonLite[]): PersonLite[] {
  const seen = new Set<string>();
  const out: PersonLite[] = [];
  for (const p of people) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/tests/rhd.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the API contract types to `src/api/types.ts`**

These mirror `server/rhd.ts`'s output shape (same structural pattern as `Assignment`, which `src/api/types.ts` defines and the server constructs without importing). Add `licensedRN?` to `Person` (next to `returning?` at line 37) and append the readiness types:
```ts
// In Person, after `returning?: boolean;`
  /** True if the person is a licensed RN (drives # RNs coverage + the depo flag). */
  licensedRN?: boolean;
```
```ts
// Appended near the other response types:
export type ProcedureStatus = "yes" | "no" | "unknown";
export type ProcedureKey = "iudIn" | "iudOut" | "nexplanon" | "gac" | "emb" | "seesMale";

export type Attending = {
  id: string;
  scheduleName: string;
  fullName: string;
  procedures: Record<ProcedureKey, ProcedureStatus>;
  notes?: string;
};

export type ClinicReadiness = {
  date: string;
  closed: boolean;
  attending: Attending | null;
  director: string | null;
  procedures: Record<ProcedureKey, ProcedureStatus>;
  coverage: { sctm: number; jctm: number; rn: number; spanish: number };
  depoOk: boolean;
  proceduresBooked: number | null;
  procedureCapWarning: boolean;
  emails: string[];
};

export type RhdReadinessResponse = {
  maxProceduresPerClinic: number;
  attendings: Attending[];
  clinics: ClinicReadiness[];
};
```

- [ ] **Step 6: Verify + commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 79 tests pass; tsc clean.
```bash
git add server/rhd.ts server/tests/rhd.test.ts src/api/types.ts
git commit -m "feat(rhd): computeClinicReadiness pure module + readiness API types"
```

---

## Task 3: `buildRhdImportPlan` + `parseRhdCell` (pure)

The migration's testable core: section-grouped roster rows → per-(dept,date) assignment plan, with unknown-cell reporting.

**Files:**
- Modify: `server/rhd.ts`
- Modify: `server/tests/rhd.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `server/tests/rhd.test.ts`:
```ts
import { parseRhdCell, buildRhdImportPlan, type RhdSheetPersonRow } from "../rhd.js";

describe("parseRhdCell", () => {
  it("reads 1 as on-shift", () => {
    expect(parseRhdCell("1")).toEqual({ onShift: true, shadow: false, available: false });
  });
  it("reads available tokens", () => {
    expect(parseRhdCell("available")).toEqual({ onShift: false, shadow: false, available: true });
    expect(parseRhdCell("A")).toEqual({ onShift: false, shadow: false, available: true });
  });
  it("reads shadow tokens", () => {
    expect(parseRhdCell("shadow")).toEqual({ onShift: false, shadow: true, available: false });
    expect(parseRhdCell("S")).toEqual({ onShift: false, shadow: true, available: false });
  });
  it("returns null for empty and unknown", () => {
    expect(parseRhdCell("")).toBeNull();
    expect(parseRhdCell("   ")).toBeNull();
    expect(parseRhdCell("xyz")).toBeNull();
  });
});

describe("buildRhdImportPlan", () => {
  const dates = ["2026-05-30", "2026-06-06"];
  const rows: RhdSheetPersonRow[] = [
    { name: "Bridget Chen", email: "bridget.chen@yale.edu", dept: "SCTS", returning: true, licensedRN: false, cells: { "2026-05-30": "1", "2026-06-06": "available" } },
    { name: "Mirielle Ma", email: "mirielle.ma@yale.edu", dept: "JCTS", returning: false, licensedRN: false, cells: { "2026-05-30": "1" } },
    { name: "Ramy Triki", email: "ramy.triki@yale.edu", dept: "CCRH", returning: false, licensedRN: true, cells: { "2026-05-30": "S", "2026-06-06": "1" } },
    { name: "Mystery", email: "mystery@yale.edu", dept: "SCTS", returning: false, licensedRN: false, cells: { "2026-05-30": "??" } },
  ];

  it("groups assignments by dept and date and routes shadows", () => {
    const plan = buildRhdImportPlan(rows, dates);
    expect(plan.perDeptDate.SCTS["2026-05-30"].onShift).toEqual(["bridget.chen@yale.edu"]);
    expect(plan.perDeptDate.JCTS["2026-05-30"].onShift).toEqual(["mirielle.ma@yale.edu"]);
    expect(plan.perDeptDate.CCRH["2026-05-30"].shadow).toEqual(["ramy.triki@yale.edu"]);
    expect(plan.perDeptDate.CCRH["2026-06-06"].onShift).toEqual(["ramy.triki@yale.edu"]);
  });

  it("collects every distinct person with their dept + attributes", () => {
    const plan = buildRhdImportPlan(rows, dates);
    expect(plan.people.find((p) => p.email === "ramy.triki@yale.edu")).toMatchObject({ dept: "CCRH", licensedRN: true });
    expect(plan.people.find((p) => p.email === "bridget.chen@yale.edu")).toMatchObject({ dept: "SCTS", returning: true });
  });

  it("reports unknown cells instead of guessing", () => {
    const plan = buildRhdImportPlan(rows, dates);
    expect(plan.unknownCells).toEqual([{ email: "mystery@yale.edu", date: "2026-05-30", raw: "??" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/tests/rhd.test.ts`
Expected: FAIL — `parseRhdCell`/`buildRhdImportPlan` not exported.

- [ ] **Step 3: Implement in `server/rhd.ts`**

Append:
```ts
export type RhdDept = "SCTS" | "JCTS" | "CCRH";

export type RhdCell = { onShift: boolean; shadow: boolean; available: boolean };

/** Map an RHD grid cell to a normalized assignment. null = empty or unknown
 *  (callers pre-check emptiness so they can report unknowns). `1` = on shift;
 *  shadow + available tokens are recognized; everything else is unknown. */
export function parseRhdCell(raw: string): RhdCell | null {
  const code = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!code) return null;
  if (code === "1" || code === "1.0") return { onShift: true, shadow: false, available: false };
  if (code === "s" || code === "shadow") return { onShift: false, shadow: true, available: false };
  if (code === "a" || code === "available" || code === "avail") return { onShift: false, shadow: false, available: true };
  return null;
}

export type RhdSheetPersonRow = {
  name: string;
  email: string;
  dept: RhdDept;
  returning: boolean;
  licensedRN: boolean;
  cells: Record<string, string>; // ISO date → raw cell
};

export type RhdDayPlan = { onShift: string[]; shadow: string[] };

export type RhdImportPlan = {
  people: { email: string; name: string; dept: RhdDept; returning: boolean; licensedRN: boolean }[];
  perDeptDate: Record<RhdDept, Record<string, RhdDayPlan>>;
  unknownCells: { email: string; date: string; raw: string }[];
};

export function buildRhdImportPlan(rows: RhdSheetPersonRow[], dates: string[]): RhdImportPlan {
  const depts: RhdDept[] = ["SCTS", "JCTS", "CCRH"];
  const perDeptDate = Object.fromEntries(
    depts.map((d) => [d, Object.fromEntries(dates.map((iso) => [iso, { onShift: [], shadow: [] } as RhdDayPlan]))]),
  ) as Record<RhdDept, Record<string, RhdDayPlan>>;

  const people: RhdImportPlan["people"] = [];
  const seen = new Set<string>();
  const unknownCells: RhdImportPlan["unknownCells"] = [];

  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      people.push({ email, name: row.name, dept: row.dept, returning: row.returning, licensedRN: row.licensedRN });
    }
    for (const date of dates) {
      const raw = row.cells[date] ?? "";
      if (!raw.trim()) continue;
      const cell = parseRhdCell(raw);
      if (!cell) {
        unknownCells.push({ email, date, raw });
        continue;
      }
      const day = perDeptDate[row.dept][date];
      if (cell.onShift) day.onShift.push(email);
      if (cell.shadow) day.shadow.push(email);
    }
  }

  return { people, perDeptDate, unknownCells };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/tests/rhd.test.ts`
Expected: PASS (all `rhd.test.ts` tests green).

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass; tsc clean.
```bash
git add server/rhd.ts server/tests/rhd.test.ts
git commit -m "feat(rhd): buildRhdImportPlan + parseRhdCell for the migration"
```

---

## Task 4: `Licensed RN` read + PersonRow badge

Plumb the new person attribute from Airtable into the schedule response and show a badge. Verified by compile/build (the repo doesn't unit-test the route or `PersonRow`).

**Files:**
- Modify: `server/app.ts`
- Modify: `src/app/components/schedule/PersonRow.tsx`

- [ ] **Step 1: Add the field to the All People row type**

In `server/app.ts`, in `type AllPeopleFields` (around line 33–34), after `"Returning Volunteer"?: boolean;` add:
```ts
  "Licensed RN"?: boolean;
```

- [ ] **Step 2: Read it in `buildPerson`**

In `server/app.ts`, in the object returned by `buildPerson` (around line 727), after `returning: person?.fields["Returning Volunteer"] === true,` add:
```ts
      licensedRN: person?.fields["Licensed RN"] === true,
```

- [ ] **Step 3: Render the badge**

In `src/app/components/schedule/PersonRow.tsx`, after the Spanish badge block (ends ~line 216, the `person.spanishSpeaking` span), add a parallel badge:
```tsx
      {!readOnly && person.licensedRN && (
        <span
          className="text-[10px] uppercase tracking-wide text-rose-800 bg-rose-100 px-1.5 py-0.5 rounded font-semibold"
          title="Licensed RN."
        >
          RN
        </span>
      )}
```

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 79 tests pass; tsc clean; build succeeds.
```bash
git add server/app.ts src/app/components/schedule/PersonRow.tsx
git commit -m "feat(rhd): surface Licensed RN on Person + RN badge"
```

---

## Task 5: `/rhd/readiness` (read) + `/rhd/clinic` (write) endpoints + client

Thin Airtable glue around `computeClinicReadiness`. Verified by compile/build.

**Files:**
- Modify: `server/app.ts`
- Modify: `src/api/client.ts`

- [ ] **Step 1: Add Airtable row types for the new tables**

In `server/app.ts`, near the other field types (after `ScheduleRowFields`, ~line 98), add:
```ts
type RhdAttendingFields = {
  "Schedule Name"?: string;
  "Full Name"?: string;
  "IUD In"?: unknown; "IUD Out"?: unknown; "Nexplanon"?: unknown;
  "GAC"?: unknown; "EMB"?: unknown; "Sees Male"?: unknown;
  "Notes"?: string;
};

type RhdClinicFields = {
  Date?: unknown;
  Attending?: unknown;
  "Director on point"?: string;
  "Procedures Booked"?: number;
};
```

- [ ] **Step 2: Add the readiness import + helpers near the top of `server/app.ts`**

Extend the existing `./rhd.js` import (added in this task) and add the constant. After the `./medteam.js` import (line 10):
```ts
import {
  computeClinicReadiness,
  type Attending,
  type ProcedureStatus,
  type ProcedureKey,
  type PersonLite,
} from "./rhd.js";
```
Add a module-level constant (near `MANAGES_OTHER_DEPTS`):
```ts
const RHD_DEPTS = ["SCTS", "JCTS", "CCRH"] as const;
const DEFAULT_MAX_PROCEDURES_PER_CLINIC = 3;
```
And a helper to read a single-select "Yes"/"No"/blank as `ProcedureStatus` (reuse the existing `selectName` helper already in app.ts):
```ts
function procStatus(v: unknown): ProcedureStatus {
  const s = selectName(v).trim().toLowerCase();
  return s === "yes" ? "yes" : s === "no" ? "no" : "unknown";
}
function toAttending(row: AirtableRecord<RhdAttendingFields>): Attending {
  const f = row.fields;
  return {
    id: row.id,
    scheduleName: f["Schedule Name"] ?? "",
    fullName: f["Full Name"] ?? "",
    procedures: {
      iudIn: procStatus(f["IUD In"]), iudOut: procStatus(f["IUD Out"]),
      nexplanon: procStatus(f["Nexplanon"]), gac: procStatus(f["GAC"]),
      emb: procStatus(f["EMB"]), seesMale: procStatus(f["Sees Male"]),
    },
    notes: f["Notes"] || undefined,
  };
}
```

- [ ] **Step 3: Implement `POST /rhd/readiness`**

Add a new route (place it after the `/schedule/:deptId` handler). It resolves the three RHD departments, their schedule rows, the people on those rows (with `Licensed RN` + the live Spanish derivation), the attendings, and the clinics, then calls `computeClinicReadiness` per `CANONICAL_DATES`. Mirror the Spanish derivation already in `/schedule` (the `volSpanish` map at lines 629–645) — extract or duplicate it; duplication is acceptable here and keeps the route self-contained.
```ts
app.post("/rhd/readiness", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  if (!config.rhdAttendingsTableId || !config.rhdClinicsTableId) {
    return c.json({ error: "RHD tables not configured" }, 400);
  }
  const { callerNetid, callerEmail } = (await c.req.json()) as { callerNetid?: string; callerEmail?: string };
  if (!callerNetid || !callerEmail) return c.json({ error: "Missing caller" }, 400);
  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const [allRoster, allSchedule, attendingRows, clinicRows, allVolunteerApps, volunteerStaff] = await Promise.all([
    listAll<Su26RosterFields>({ baseId: config.haveNManagementBaseId, tableId: config.su26RosterTableId }),
    listAll<ScheduleRowFields>({ baseId: config.haveNManagementBaseId, tableId: config.su26ScheduleTableId }),
    listAll<RhdAttendingFields>({ baseId: config.haveNManagementBaseId, tableId: config.rhdAttendingsTableId }),
    listAll<RhdClinicFields>({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId }),
    listAll<VolunteerAppFields>({ baseId: config.volunteerAppsBaseId, tableId: config.volunteerAppsTableId, fields: ["NetID", "Link your record", "Spanish Proficiency Level"] }),
    listAll<StaffMirrorFields>({ baseId: config.volunteerAppsBaseId, tableId: config.volunteerAppsStaffTableId, fields: ["NetID"] }),
  ]);

  // authorize: caller must manage at least one RHD dept
  const manageable = manageableDeptIdsFor(allRoster, caller.id);
  const deptIdByName = new Map(allRoster.map((d) => [d.fields["Department Name"] ?? "", d.id]));
  const rhdDeptIds = RHD_DEPTS.map((n) => deptIdByName.get(n)).filter((x): x is string => !!x);
  if (!rhdDeptIds.some((id) => manageable.has(id))) {
    return c.json({ error: "Caller not authorized for RHD" }, 403);
  }

  // live Spanish (netid → true) — same rule as /schedule
  const volunteerStaffNetidById = new Map<string, string>(
    volunteerStaff.filter((s) => s.fields.NetID).map((s) => [s.id, (s.fields.NetID ?? "").toLowerCase()]),
  );
  const SPANISH_CONVERSATIONAL_PLUS = new Set(["Conversational", "Fluent (native)", "Fluent (non-native)"]);
  const volSpanishByNetid = new Map<string, boolean>();
  for (const r of allVolunteerApps) {
    const nid = resolveAppNetidStandalone(r.fields.NetID, r.fields["Link your record"], volunteerStaffNetidById);
    if (nid && SPANISH_CONVERSATIONAL_PLUS.has(selectName(r.fields["Spanish Proficiency Level"]))) volSpanishByNetid.set(nid, true);
  }

  // collect all on-shift All People ids across the three depts, then batch-fetch attributes
  const onShiftIdsByDeptDate = new Map<string, string[]>(); // `${deptName}|${iso}` → ids
  const everyId = new Set<string>();
  for (const row of allSchedule) {
    const depId = toIdList(row.fields.Department)[0];
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    const deptName = RHD_DEPTS.find((n) => deptIdByName.get(n) === depId);
    if (!deptName || !iso) continue;
    const ids = toIdList(row.fields["Volunteers on Shift"]);
    onShiftIdsByDeptDate.set(`${deptName}|${iso}`, ids);
    ids.forEach((id) => everyId.add(id));
  }
  const peopleRows = everyId.size
    ? await listAll<AllPeopleFields>({
        baseId: config.haveNManagementBaseId, tableId: config.allPeopleTableId,
        filterByFormula: `OR(${[...everyId].map((id) => `RECORD_ID() = '${id}'`).join(",")})`,
        fields: ["NetID", "Contact Email", "Licensed RN", "Spanish Speaking"],
      })
    : [];
  const liteById = new Map<string, PersonLite>(
    peopleRows.map((p) => {
      const netid = (p.fields.NetID ?? "").toLowerCase();
      return [p.id, {
        id: p.id,
        email: (p.fields["Contact Email"] ?? "").toLowerCase(),
        licensedRN: p.fields["Licensed RN"] === true,
        spanishSpeaking: volSpanishByNetid.get(netid) === true || p.fields["Spanish Speaking"] === true,
      }];
    }),
  );
  const liteFor = (deptName: string, iso: string): PersonLite[] =>
    (onShiftIdsByDeptDate.get(`${deptName}|${iso}`) ?? []).map((id) => liteById.get(id)).filter((x): x is PersonLite => !!x);

  const attendings = attendingRows.map(toAttending);
  const attendingById = new Map(attendings.map((a) => [a.id, a]));
  const clinicByIso = new Map<string, AirtableRecord<RhdClinicFields>>();
  for (const row of clinicRows) {
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    if (iso) clinicByIso.set(iso, row);
  }

  const clinics = CANONICAL_DATES.map((iso) => {
    const clinic = clinicByIso.get(iso);
    const attId = clinic ? toIdList(clinic.fields.Attending)[0] : undefined;
    return computeClinicReadiness({
      date: iso,
      attending: attId ? attendingById.get(attId) ?? null : null,
      director: clinic?.fields["Director on point"] ?? null,
      sctsOnShift: liteFor("SCTS", iso),
      jctsOnShift: liteFor("JCTS", iso),
      ccrhOnShift: liteFor("CCRH", iso),
      proceduresBooked: typeof clinic?.fields["Procedures Booked"] === "number" ? clinic.fields["Procedures Booked"] : null,
      maxProceduresPerClinic: DEFAULT_MAX_PROCEDURES_PER_CLINIC,
    });
  });

  return c.json({ maxProceduresPerClinic: DEFAULT_MAX_PROCEDURES_PER_CLINIC, attendings, clinics });
});
```
**Note:** `resolveAppNetid` in `/schedule` is a closure. For this route, add a module-level twin `resolveAppNetidStandalone(direct, linkFieldValue, staffNetidById)` with the identical body (lines 555–567) so both routes share it; or lift the existing one to module scope and have `/schedule` call it. Either is fine — pick the smaller diff.

- [ ] **Step 4: Implement `POST /rhd/clinic` (upsert one clinic day)**

```ts
app.post("/rhd/clinic", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  if (!config.rhdClinicsTableId) return c.json({ error: "RHD tables not configured" }, 400);
  const body = (await c.req.json()) as {
    callerNetid?: string; callerEmail?: string; date?: string;
    attendingId?: string | null; director?: string | null; proceduresBooked?: number | null;
  };
  const { callerNetid, callerEmail, date } = body;
  if (!callerNetid || !callerEmail || !date) return c.json({ error: "Missing required field" }, 400);
  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const allRoster = await listAll<Su26RosterFields>({ baseId: config.haveNManagementBaseId, tableId: config.su26RosterTableId });
  const manageable = manageableDeptIdsFor(allRoster, caller.id);
  const deptIdByName = new Map(allRoster.map((d) => [d.fields["Department Name"] ?? "", d.id]));
  const rhdDeptIds = RHD_DEPTS.map((n) => deptIdByName.get(n)).filter((x): x is string => !!x);
  if (!rhdDeptIds.some((id) => manageable.has(id))) return c.json({ error: "Caller not authorized for RHD" }, 403);

  if (body.proceduresBooked != null) {
    const n = body.proceduresBooked;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return c.json({ error: "Invalid Procedures Booked" }, 400);
  }

  const clinics = await listAll<RhdClinicFields>({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId });
  const existing = clinics.find((row) => normalizeVolunteerDate(selectName(row.fields.Date)) === date);
  const fields: Record<string, unknown> = { Date: displayDate(date) };
  if (body.attendingId !== undefined) fields["Attending"] = body.attendingId ? [body.attendingId] : [];
  if (body.director !== undefined) fields["Director on point"] = body.director ?? "";
  if (body.proceduresBooked !== undefined) fields["Procedures Booked"] = body.proceduresBooked;

  if (existing) {
    await patchRecord({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId, recordId: existing.id, fields });
  } else {
    await createRecord({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId, fields });
  }
  return c.json({ success: true });
});
```

- [ ] **Step 5: Add client methods**

In `src/api/client.ts`, import the new types and add two methods to the `api` object:
```ts
// add to the type import at top:
//   RhdReadinessResponse
  rhdReadiness: (callerNetid: string, callerEmail: string) =>
    request<RhdReadinessResponse>("/rhd/readiness", {
      method: "POST",
      body: JSON.stringify({ callerNetid, callerEmail }),
    }),
  setRhdClinic: (input: {
    callerNetid: string;
    callerEmail: string;
    date: string;
    attendingId?: string | null;
    director?: string | null;
    proceduresBooked?: number | null;
  }) =>
    request<{ success: true }>("/rhd/clinic", {
      method: "POST",
      body: JSON.stringify(input),
    }),
```

- [ ] **Step 6: Verify + commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 79 tests pass; tsc clean; build succeeds.
```bash
git add server/app.ts src/api/client.ts
git commit -m "feat(rhd): /rhd/readiness + /rhd/clinic endpoints and client"
```

---

## Task 6: `ClinicReadinessPanel` component

A presentational card for one clinic day. Pure props in, callbacks out — no fetching.

**Files:**
- Create: `src/app/components/schedule/ClinicReadinessPanel.tsx`

- [ ] **Step 1: Implement the component**

Create `src/app/components/schedule/ClinicReadinessPanel.tsx`:
```tsx
import type { Attending, ClinicReadiness, ProcedureKey, ProcedureStatus } from "@/api/types";

const PROC_LABEL: Record<ProcedureKey, string> = {
  iudIn: "IUD In", iudOut: "IUD Out", nexplanon: "Nexplanon", gac: "GAC", emb: "EMB", seesMale: "Sees male",
};
const PROC_ORDER: ProcedureKey[] = ["iudIn", "iudOut", "nexplanon", "gac", "emb", "seesMale"];
const STATUS_CLASS: Record<ProcedureStatus, string> = {
  yes: "bg-emerald-100 text-emerald-800 border-emerald-300",
  no: "bg-red-100 text-red-800 border-red-300",
  unknown: "bg-slate-100 text-slate-500 border-slate-300",
};

export function ClinicReadinessPanel({
  readiness,
  attendings,
  disabled,
  onChange,
}: {
  readiness: ClinicReadiness;
  attendings: Attending[];
  disabled: boolean;
  onChange: (patch: { attendingId?: string | null; director?: string | null; proceduresBooked?: number | null }) => void;
}) {
  if (readiness.closed) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-500">
        Clinic closed — no attending or volunteers scheduled.
      </div>
    );
  }
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1">
          Attending:
          <select
            value={readiness.attending?.id ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ attendingId: e.target.value || null })}
            className="border border-slate-300 rounded px-1 py-0.5"
          >
            <option value="">—</option>
            {attendings.map((a) => (
              <option key={a.id} value={a.id}>{a.scheduleName}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Director:
          <input
            type="text"
            value={readiness.director ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ director: e.target.value || null })}
            className="w-20 border border-slate-300 rounded px-1 py-0.5"
          />
        </label>
        <span className={readiness.depoOk ? "text-emerald-700" : "text-red-700 font-semibold"}>
          {readiness.depoOk ? "Depo OK (RN on shift)" : "No RN — reschedule depo/injections"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PROC_ORDER.map((k) => (
          <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_CLASS[readiness.procedures[k]]}`} title={`${PROC_LABEL[k]}: ${readiness.procedures[k]}`}>
            {PROC_LABEL[k]}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>SCTM: <strong className="tabular-nums">{readiness.coverage.sctm}</strong></span>
        <span>JCTM: <strong className="tabular-nums">{readiness.coverage.jctm}</strong></span>
        <span className={readiness.coverage.rn === 0 ? "text-red-700" : ""}>RN: <strong className="tabular-nums">{readiness.coverage.rn}</strong></span>
        <span>Spanish: <strong className="tabular-nums">{readiness.coverage.spanish}</strong></span>
        <label className="flex items-center gap-1">
          Procedures booked:
          <input
            type="number" min={0} step={1}
            value={readiness.proceduresBooked ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return onChange({ proceduresBooked: null });
              const n = e.target.valueAsNumber;
              if (!Number.isFinite(n) || n < 0) return;
              onChange({ proceduresBooked: Math.trunc(n) });
            }}
            className="w-16 border border-slate-300 rounded px-1 py-0.5 tabular-nums"
          />
        </label>
        {readiness.procedureCapWarning && (
          <span className="text-red-700 font-semibold">Over max ({readiness.proceduresBooked})</span>
        )}
      </div>

      {readiness.emails.length > 0 && (
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(readiness.emails.join(", "))}
          className="text-[11px] text-[#0F4D92] underline"
          title={readiness.emails.join(", ")}
        >
          Copy clinic email list ({readiness.emails.length})
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.
```bash
git add src/app/components/schedule/ClinicReadinessPanel.tsx
git commit -m "feat(rhd): ClinicReadinessPanel component"
```

---

## Task 7: Wire readiness into the schedule UI

Fetch `/rhd/readiness` when the active department is an RHD dept, render the panel on the active Saturday, and persist edits via `/rhd/clinic`.

**Files:**
- Modify: `src/app/components/ScheduleBuilder.tsx`
- Modify: `src/app/components/schedule/SaturdayView.tsx`

**Read first:** open `src/app/components/ScheduleBuilder.tsx` fully to see how it calls `api.schedule`, holds `callerNetid`/`callerEmail`, the active department name, and renders `<SaturdayView>`. The steps below describe the integration precisely; match the file's existing state/effect patterns.

- [ ] **Step 1: Add an RHD-dept helper**

In `src/app/components/schedule/SaturdayView.tsx` (top, after imports) and export it:
```ts
export const RHD_DEPT_NAMES = ["SCTS", "JCTS", "CCRH"] as const;
export const isRhdDept = (name: string) => (RHD_DEPT_NAMES as readonly string[]).includes(name);
```

- [ ] **Step 2: Fetch readiness in `ScheduleBuilder`**

In `ScheduleBuilder.tsx`, add state `const [rhdReadiness, setRhdReadiness] = useState<RhdReadinessResponse | null>(null);` (import `RhdReadinessResponse` from `@/api/types`). In the same place the schedule loads for the active department (alongside the existing `api.schedule(...)` call), when `isRhdDept(activeDeptName)` call `api.rhdReadiness(callerNetid, callerEmail).then(setRhdReadiness)`; otherwise `setRhdReadiness(null)`. Reuse the existing `reload`/effect that already reacts to department changes so readiness refetches when the schedule does (including after an assignment write, so coverage counts stay live).

- [ ] **Step 3: Pass readiness + handler into `SaturdayView`**

Add props to the `<SaturdayView .../>` render in `ScheduleBuilder.tsx`:
```tsx
  clinicReadiness={isRhdDept(activeDeptName) ? rhdReadiness : null}
  onSetClinic={(date, patch) =>
    api.setRhdClinic({ callerNetid, callerEmail, date, ...patch }).then(() => reload({ silent: true }))
  }
```
(Use the existing `reload`/refetch function name in the file; `reload({ silent: true })` matches the on-focus refresh added in commit `333b016`.)

- [ ] **Step 4: Render the panel in `SaturdayView`**

In `SaturdayView.tsx`: import `ClinicReadinessPanel` and `RhdReadinessResponse`. Add to the props type:
```ts
  /** When the dept is RHD, the readiness payload for all dates; null otherwise. */
  clinicReadiness?: RhdReadinessResponse | null;
  onSetClinic?: (date: string, patch: { attendingId?: string | null; director?: string | null; proceduresBooked?: number | null }) => void;
```
Add them to the destructured params (default `clinicReadiness = null`). In the render, right after the existing `{editMode === "assign" && capacity && (<CapacityPanel .../>)}` block, add:
```tsx
      {editMode === "assign" && clinicReadiness && (() => {
        const r = clinicReadiness.clinics.find((x) => x.date === activeIso);
        return r ? (
          <ClinicReadinessPanel
            readiness={r}
            attendings={clinicReadiness.attendings}
            disabled={disabled}
            onChange={(patch) => onSetClinic?.(activeIso, patch)}
          />
        ) : null;
      })()}
```

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 79 tests pass; tsc clean; build succeeds.
```bash
git add src/app/components/ScheduleBuilder.tsx src/app/components/schedule/SaturdayView.tsx
git commit -m "feat(rhd): render ClinicReadinessPanel for RHD depts + persist clinic edits"
```

---

## Task 8: One-time migration script `scripts/import-rhd.ts`

Seeds attendings, roster membership, person attributes, assignments, and clinics from the two workbooks. Dry-run by default. Reuses `buildRhdImportPlan`.

**Files:**
- Create: `scripts/import-rhd.ts`
- Modify: `package.json` (add an `import:rhd` script)

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, mirroring the existing `import:medteam`:
```json
    "import:rhd": "tsx scripts/import-rhd.ts",
```

- [ ] **Step 2: Implement the script**

Create `scripts/import-rhd.ts`. Model it closely on `scripts/import-medteam.ts` (already in the repo). Key differences, all driven by §5 / §11 of the spec:
- Two file args: `--schedule "HAVEN RHD Schedule.xlsx"` (sheet `Summer 2026`) and `--prep "HAVEN Clinic Prep Summer 2026.xlsx"` (sheets `ATTENDING QUALS`, `SETTINGS`).
- Parse via `XLSX.read(readFileSync(path), { cellDates: true })` (never `XLSX.readFile`).
- **`extractScheduleSheet(ws)`** (script-local, like medteam's `extractSheet`) walks the grid:
  - find date columns via `headerToIso` (copy the helper from `import-medteam.ts`);
  - capture the `Attending` row and `Director` row values per date column → `clinicByIso`;
  - find the roster header row (the row whose first cells are `Name`, `Status`, `Yale Email`, …) to locate the `Licensed RN`, `Spanish Proficiency`, `Status` columns and the date columns;
  - track the current section as it encounters the `SCTMs` / `JCTMs` / `CCs` section-header rows → set each person row's `dept` to `SCTS` / `JCTS` / `CCRH`;
  - for each person row build an `RhdSheetPersonRow` (`name`, lowercased `email`, `dept`, `returning` = Status startsWith "Return", `licensedRN` = `Licensed RN` cell is "Yes"/"Y", `cells` = ISO→raw for each date column).
  - **Do not parse Spanish** from the sheet — Spanish is derived live; never write it.
- Call `buildRhdImportPlan(rows, dateIsos)` for the assignment/roster plan; print the **unmatched-people** report (email not in All People) and the **unknown-cell** report; **never guess**.
- **`extractAttendingQuals(ws)`**: read `ATTENDING QUALS` → for each attending row map `Schedule Name`, `Full Name`, and the six procedure columns (`IUD In`,`IUD Out`,`Nxp`,`GAC`,`EMB`,`Male`) to the Airtable single-select string `"Yes"`/`"No"` (blank → leave the field unset so it reads back as "unknown"). Note the column header is `Nxp` → field `Nexplanon`, and `Male` → field `Sees Male`.
- Writes (only under `--apply`), all idempotent upserts:
  1. **Attendings:** upsert `RHD Attendings` by `Schedule Name`.
  2. **Roster:** union matched people into each dept's `Volunteers` list (per-dept, like medteam).
  3. **Attributes:** patch All People `Licensed RN` + `Returning Volunteer` (NOT Spanish).
  4. **Assignments:** upsert one `SU 26 Schedule` row per (dept, date) with `Volunteers on Shift` = onShift ids and `Shadow Volunteers on Shift` = shadow ids (resolve emails→ids via All People by `Contact Email`, lowercased).
  5. **Clinics:** upsert one `RHD Clinics` row per date with `Date`, `Attending` (link resolved from the attending `Schedule Name`), and `Director on point` (raw initials).
- `--apply` flag and the default dry-run banner exactly like `import-medteam.ts`. Load IDs from `.env.local` via `dotenv` and `loadConfig()`; if `rhdAttendingsTableId`/`rhdClinicsTableId` are missing, print a clear error and exit (those are optional in config, so guard explicitly here).

- [ ] **Step 3: Dry-run (no writes) to confirm parsing**

Run (paths are the connected workbooks in the main checkout — pass absolute paths so the worktree cwd doesn't matter):
```bash
npm run import:rhd -- \
  --schedule "/Users/jcarney/Documents/Code-Projects/HAVEN-scheduler/HAVEN RHD Schedule.xlsx" \
  --prep "/Users/jcarney/Documents/Code-Projects/HAVEN-scheduler/HAVEN Clinic Prep Summer 2026.xlsx"
```
Expected: prints date columns; per-dept roster counts; the attendings parsed from `ATTENDING QUALS`; the **unmatched-people** and **unknown-cell** reports. **Review the unknown-cell report** — if it lists tokens that should be assignments/shadows, extend `parseRhdCell` (Task 3) with the real token, add a test, and re-run. Do not `--apply` until the unknown-cell list contains only genuinely-ignorable values.

- [ ] **Step 4: Commit the script (still no production writes)**

Run: `npx tsc --noEmit`
Expected: tsc clean.
```bash
git add scripts/import-rhd.ts package.json
git commit -m "feat(rhd): one-time migration script (dry-run default)"
```

---

## Task 9: Final review + apply

- [ ] **Step 1: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests pass; tsc clean; build succeeds.

- [ ] **Step 2: Dispatch a final code review**

Per subagent-driven-development, dispatch a final code-reviewer over the whole branch diff (`git diff main...HEAD`). Address any high-confidence findings.

- [ ] **Step 3: Apply the migration (explicit user go-ahead required)**

This writes to production Airtable. Confirm with the user first, then:
```bash
npm run import:rhd -- --schedule "<abs path>" --prep "<abs path>" --apply
```
Spot-check one Saturday in the portal (attending shows, procedure chips reflect that attending's quals, coverage counts + RN/depo flag correct) and report the unmatched-people list, exactly as the PCAR import did.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch to open the PR.

---

## Self-review (against the spec)

**Spec coverage:**
- §2 assignment grid (SCTS/JCTS/CCRH) → reuses existing model; surfaced via Tasks 4–8. ✓
- §2/§6.1 `Licensed RN` → Task 1 (field) + Task 4 (read + badge). ✓
- §6.2 RHD Attendings → Task 1 (table, single-select Yes/No so "unknown" is representable — a deliberate, documented refinement of the spec's "checkbox") + Task 5 (`toAttending`) + Task 8 (seed). ✓
- §6.3 RHD Clinics → Task 1 (table) + Task 5 (`/rhd/clinic`) + Task 8 (seed). ✓
- §6.5 types → Task 2 (Step 5). ✓
- §7 endpoints + `licensedRN` in buildPerson → Tasks 4–5. ✓
- §8 readiness computation → Task 2. ✓
- §9 PersonRow RN badge + ClinicReadinessPanel + cross-dept rollup → Tasks 4, 6, 7. ✓
- §11 migration (dry-run, unmatched + unknown reporting, no Spanish write, PHI-safe tabs) → Task 8. ✓
- §12 tests → Tasks 2–3. ✓
- §13 training compliance is explicitly out of scope → no task, by design. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code or (Tasks 7–8) precise edits against named anchors with "read the file first" guidance, consistent with integrating into large existing files.

**Type consistency:** `ProcedureKey`/`ProcedureStatus`/`Attending`/`ClinicReadiness` are defined once in `server/rhd.ts` (Task 2 Step 3) and mirrored in `src/api/types.ts` (Task 2 Step 5) with identical shapes; `RhdReadinessResponse` is produced by `/rhd/readiness` (Task 5) and consumed by the client (Task 5) and UI (Task 7); `RhdSheetPersonRow`/`RhdImportPlan` (Task 3) feed the migration (Task 8). `isRhdDept`/`RHD_DEPT_NAMES` (frontend, Task 7) parallel `RHD_DEPTS` (server, Task 5).
