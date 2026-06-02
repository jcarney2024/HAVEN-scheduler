# PCAR Med Team Scheduler Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clinical roles (Triage/Walk-in for SCTP, CC for JCTP), a per-Saturday capacity/quota dashboard, and per-person goal/coverage surfacing to the PCAR Med Team scheduler, plus a one-time script that seeds the two departments from the existing Excel workbook.

**Architecture:** Roles are modeled as link-field "flags" on the existing SU 26 Schedule row (subsets of `Volunteers on Shift`), mirroring the proven `Remote on Shift` pattern. Pure logic (cell-code parsing, import-plan building, role coercion) lives in a new testable `server/medteam.ts`; dashboard math lives in a testable `src/app/components/schedule/capacity.ts`. The API and React layers wire these in. A `tsx` script reads only the SCTM/JCTM tabs (never the PHI patient tabs) and writes via the existing Airtable helpers.

**Tech Stack:** TypeScript, Hono (API), React 18 + Vite + Tailwind (frontend), Airtable REST, vitest (node env), SheetJS (`xlsx`, dev-only) for the migration script.

**Spec:** `docs/superpowers/specs/2026-06-02-pcar-medteam-scheduler-enrichment-design.md`

---

## File map

- **Create** `server/medteam.ts` — pure: `parseCellCode`, `buildImportPlan`, `withRoleMembersOnShift` + their types.
- **Create** `server/tests/medteam.test.ts` — unit tests for the above.
- **Create** `src/app/components/schedule/capacity.ts` — pure: `computeDayMetrics`, `rolesForDept` + types.
- **Create** `src/tests/capacity.test.ts` — unit tests for the above.
- **Create** `src/app/components/schedule/CapacityPanel.tsx` — per-Saturday dashboard UI.
- **Create** `scripts/import-medteam.ts` — one-time migration (dry-run default).
- **Modify** `src/api/types.ts` — extend `Assignment`, `Person`, `ScheduleResponse.department`.
- **Modify** `src/api/client.ts` — extend `assign` payload type.
- **Modify** `server/app.ts` — read/write the new fields; strip roles on remove.
- **Modify** `src/app/components/ScheduleBuilder.tsx` — persist new fields; role-cycle + patients-booked handlers; pass props down.
- **Modify** `src/app/components/schedule/PersonRow.tsx` — role pill + badge.
- **Modify** `src/app/components/schedule/SaturdayView.tsx` — wire role handler + render `CapacityPanel`.
- **Modify** `src/app/components/view/PublicScheduleView.tsx` — supply new `Assignment` fields (empty) so it type-checks.
- **Modify** `package.json` — add `xlsx` devDependency + `import:medteam` script.

---

## Task 1: Create Airtable schema fields (manual, prerequisite)

This is a manual base-configuration step. The migration and API depend on these fields existing. No code; verify by eyeballing the base.

**SU 26 Schedule** table — add:
- `Triage on Shift` — *Link to another record* → All People (allow multiple)
- `Walk-in on Shift` — *Link to another record* → All People (allow multiple)
- `CC on Shift` — *Link to another record* → All People (allow multiple)
- `Patients Booked` — *Number* (integer, allow blank)

**SU 26 Roster** table — add:
- `Ideal Headcount` — *Number* (integer)
- `Patient Capacity Per Provider` — *Number* (integer)
- Set values on the two PCAR rows: **SCTP** → `Ideal Headcount = 11`, `Patient Capacity Per Provider = 3`. **JCTP** → `Ideal Headcount` = (director-provided; leave blank if unknown), `Patient Capacity Per Provider` = blank.

**All People** table — add:
- `Spanish Speaking` — *Checkbox*
- `Returning Volunteer` — *Checkbox*

- [ ] **Step 1:** Add the fields above in Airtable exactly as named (names are matched verbatim by the code).
- [ ] **Step 2:** Confirm the two PCAR roster rows have the names `SCTP` and `JCTP` and set `Ideal Headcount`/`Patient Capacity Per Provider` as above.
- [ ] **Step 3: Commit** (no code change; note completion in the next code commit).

---

## Task 2: Extend shared TypeScript types

**Files:**
- Modify: `src/api/types.ts`

- [ ] **Step 1: Extend `Assignment`** (add the four new fields). Replace the existing `Assignment` type:

```ts
export type Assignment = {
  date: string; // ISO
  directorIds: string[];
  volunteerIds: string[];
  /** Volunteers attending this Saturday in a shadow/observation role. */
  shadowIds: string[];
  /** Subset of on-shift ids attending remotely. */
  remoteIds: string[];
  /** Subset of volunteerIds designated the Triage SCTM (SCTP). */
  triageIds: string[];
  /** Subset of volunteerIds designated the Walk-in SCTM (SCTP). */
  walkinIds: string[];
  /** Subset of volunteerIds designated CC JCTM (JCTP). */
  ccIds: string[];
  /** Director-entered count of patients booked this Saturday. PHI-free aggregate;
   *  null when not entered. */
  patientsBooked: number | null;
};
```

- [ ] **Step 2: Extend `Person`** — add two optional attribute flags after `compliance`:

```ts
  /** True if the person self-identified as Spanish-speaking. */
  spanishSpeaking?: boolean;
  /** True if a returning volunteer (from application). */
  returning?: boolean;
```

- [ ] **Step 3: Extend `ScheduleResponse.department`** — add the two config fields after `submittedByName`:

```ts
    /** Per-day target headcount for the capacity dashboard; null if unset. */
    idealHeadcount: number | null;
    /** Patients one provider can see; max capacity = this × on-shift count. Null = no capacity math (e.g. JCTP). */
    patientCapacityPerProvider: number | null;
```

- [ ] **Step 4: Verify it fails to compile** (PublicScheduleView now lacks the new Assignment fields):

Run: `npx tsc --noEmit`
Expected: errors in `src/app/components/view/PublicScheduleView.tsx` about missing `triageIds`/`walkinIds`/`ccIds`/`patientsBooked`. (Fixed in Task 3.)

- [ ] **Step 5:** Do not commit yet — proceed to Task 3 so the tree compiles, then commit together.

---

## Task 3: Fix the public-viewer Assignment literal

**Files:**
- Modify: `src/app/components/view/PublicScheduleView.tsx:220-226`

- [ ] **Step 1: Add the new fields** (the public viewer has no role/booking data). Replace the returned object literal in the `assignmentList` map:

```ts
      return {
        date: d.date,
        directorIds: d.directors.filter((p) => !!p.name).map((p) => `director:${p.name}`),
        volunteerIds: regulars.filter((v) => !!v.name).map((v) => `volunteer:${v.name}`),
        shadowIds: shadows.filter((v) => !!v.name).map((v) => `volunteer-shadow:${v.name}`),
        remoteIds: [...remoteDirectorIds, ...remoteVolunteerIds, ...remoteShadowIds],
        triageIds: [],
        walkinIds: [],
        ccIds: [],
        patientsBooked: null,
      };
```

- [ ] **Step 2: Verify the tree compiles:**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit:**

```bash
git add src/api/types.ts src/app/components/view/PublicScheduleView.tsx
git commit -m "feat(types): add clinical-role + capacity fields to Assignment/Person/department"
```

---

## Task 4: `parseCellCode` (pure, TDD)

**Files:**
- Create: `server/medteam.ts`
- Test: `server/tests/medteam.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { parseCellCode } from "../medteam.js";

describe("parseCellCode", () => {
  it("maps clinic and role codes", () => {
    expect(parseCellCode("C")).toEqual({ onShift: true, triage: false, walkin: false, cc: false, shadow: false, available: false });
    expect(parseCellCode("C+T")).toEqual({ onShift: true, triage: true, walkin: false, cc: false, shadow: false, available: false });
    expect(parseCellCode("W")).toEqual({ onShift: true, triage: false, walkin: true, cc: false, shadow: false, available: false });
    expect(parseCellCode("CC")).toEqual({ onShift: true, triage: false, walkin: false, cc: true, shadow: false, available: false });
    expect(parseCellCode("S")).toEqual({ onShift: false, triage: false, walkin: false, cc: false, shadow: true, available: false });
  });
  it("treats A / A* as available-only", () => {
    expect(parseCellCode("A")?.available).toBe(true);
    expect(parseCellCode("A*")?.available).toBe(true);
    expect(parseCellCode("A")?.onShift).toBe(false);
  });
  it("normalizes whitespace, case, and non-breaking spaces", () => {
    expect(parseCellCode(" c + t ")?.triage).toBe(true);
    expect(parseCellCode("c ")?.onShift).toBe(true);
  });
  it("returns null for empty or unknown codes", () => {
    expect(parseCellCode("")).toBeNull();
    expect(parseCellCode("   ")).toBeNull();
    expect(parseCellCode("X")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it; verify it fails:**

Run: `npm test -- medteam`
Expected: FAIL — cannot find module `../medteam.js` / `parseCellCode is not a function`.

- [ ] **Step 3: Implement** (create `server/medteam.ts`):

```ts
export type CellAssignment = {
  onShift: boolean;
  triage: boolean;
  walkin: boolean;
  cc: boolean;
  shadow: boolean;
  available: boolean;
};

function blank(): CellAssignment {
  return { onShift: false, triage: false, walkin: false, cc: false, shadow: false, available: false };
}

/**
 * Map a workbook cell code to a normalized role. Returns null for empty/blank
 * or unrecognized codes (callers distinguish the two by pre-checking emptiness).
 */
export function parseCellCode(raw: string): CellAssignment | null {
  const code = raw.replace(/ /g, " ").trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return null;
  switch (code) {
    case "C": return { ...blank(), onShift: true };
    case "C+T": return { ...blank(), onShift: true, triage: true };
    case "W": return { ...blank(), onShift: true, walkin: true };
    case "CC": return { ...blank(), onShift: true, cc: true };
    case "S": return { ...blank(), shadow: true };
    case "A":
    case "A*": return { ...blank(), available: true };
    default: return null;
  }
}
```

- [ ] **Step 4: Run it; verify it passes:**

Run: `npm test -- medteam`
Expected: PASS.

- [ ] **Step 5: Commit:**

```bash
git add server/medteam.ts server/tests/medteam.test.ts
git commit -m "feat(medteam): parseCellCode workbook cell-code mapping"
```

---

## Task 5: `withRoleMembersOnShift` (pure, TDD)

**Files:**
- Modify: `server/medteam.ts`
- Test: `server/tests/medteam.test.ts`

- [ ] **Step 1: Add the failing test** (append to the existing describe block in `server/tests/medteam.test.ts`):

```ts
import { withRoleMembersOnShift } from "../medteam.js";

describe("withRoleMembersOnShift", () => {
  it("adds any role member missing from the on-shift list", () => {
    expect(withRoleMembersOnShift(["a"], [["b"], ["c"]]).sort()).toEqual(["a", "b", "c"]);
  });
  it("deduplicates and preserves existing members", () => {
    expect(withRoleMembersOnShift(["a", "b"], [["b"]]).sort()).toEqual(["a", "b"]);
  });
  it("handles empty role lists", () => {
    expect(withRoleMembersOnShift(["a"], [])).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run it; verify it fails:**

Run: `npm test -- medteam`
Expected: FAIL — `withRoleMembersOnShift is not a function`.

- [ ] **Step 3: Implement** (append to `server/medteam.ts`):

```ts
/**
 * The invariant for writes: anyone designated a role (triage/walk-in/cc) must
 * also appear in Volunteers on Shift. Returns the union, deduplicated.
 */
export function withRoleMembersOnShift(volunteerIds: string[], roleLists: string[][]): string[] {
  const set = new Set(volunteerIds);
  for (const list of roleLists) for (const id of list) set.add(id);
  return [...set];
}
```

- [ ] **Step 4: Run it; verify it passes:**

Run: `npm test -- medteam`
Expected: PASS.

- [ ] **Step 5: Commit:**

```bash
git add server/medteam.ts server/tests/medteam.test.ts
git commit -m "feat(medteam): withRoleMembersOnShift on-shift coercion"
```

---

## Task 6: `buildImportPlan` (pure, TDD)

**Files:**
- Modify: `server/medteam.ts`
- Test: `server/tests/medteam.test.ts`

- [ ] **Step 1: Add the failing test:**

```ts
import { buildImportPlan } from "../medteam.js";

describe("buildImportPlan", () => {
  const dates = ["2026-05-30", "2026-06-06"];
  const rows = [
    { name: "Aa", email: "AA@yale.edu", cells: { "2026-05-30": "C+T", "2026-06-06": "A" } },
    { name: "Bb", email: "bb@yale.edu", cells: { "2026-05-30": "W", "2026-06-06": "S" } },
    { name: "Cc", email: "cc@yale.edu", cells: { "2026-05-30": "Z" } }, // unknown code
  ];

  it("lowercases and collects all roster emails", () => {
    expect(buildImportPlan(rows, dates).emails).toEqual(["aa@yale.edu", "bb@yale.edu", "cc@yale.edu"]);
  });
  it("routes codes into per-date role buckets; A contributes nothing", () => {
    const p = buildImportPlan(rows, dates);
    expect(p.perDate["2026-05-30"]).toEqual({
      onShift: ["aa@yale.edu", "bb@yale.edu"],
      triage: ["aa@yale.edu"],
      walkin: ["bb@yale.edu"],
      cc: [],
      shadow: [],
    });
    expect(p.perDate["2026-06-06"]).toEqual({
      onShift: [], triage: [], walkin: [], cc: [], shadow: ["bb@yale.edu"],
    });
  });
  it("reports unknown non-empty cells", () => {
    expect(buildImportPlan(rows, dates).unknownCells).toEqual([
      { email: "cc@yale.edu", date: "2026-05-30", raw: "Z" },
    ]);
  });
});
```

- [ ] **Step 2: Run it; verify it fails:**

Run: `npm test -- medteam`
Expected: FAIL — `buildImportPlan is not a function`.

- [ ] **Step 3: Implement** (append to `server/medteam.ts`):

```ts
export type SheetPersonRow = {
  name: string;
  /** Already-lowercased match key recommended, but we lowercase defensively. */
  email: string;
  /** ISO date → raw cell code. */
  cells: Record<string, string>;
};

export type DayPlan = {
  onShift: string[];
  triage: string[];
  walkin: string[];
  cc: string[];
  shadow: string[];
};

export type ImportPlan = {
  emails: string[];
  perDate: Record<string, DayPlan>;
  unknownCells: { email: string; date: string; raw: string }[];
};

export function buildImportPlan(rows: SheetPersonRow[], dates: string[]): ImportPlan {
  const perDate: Record<string, DayPlan> = {};
  for (const d of dates) perDate[d] = { onShift: [], triage: [], walkin: [], cc: [], shadow: [] };

  const emails: string[] = [];
  const seen = new Set<string>();
  const unknownCells: { email: string; date: string; raw: string }[] = [];

  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
    for (const date of dates) {
      const raw = row.cells[date] ?? "";
      if (!raw.replace(/ /g, " ").trim()) continue; // empty cell: skip
      const cell = parseCellCode(raw);
      if (!cell) {
        unknownCells.push({ email, date, raw });
        continue;
      }
      const day = perDate[date];
      if (cell.shadow) day.shadow.push(email);
      if (cell.onShift) day.onShift.push(email);
      if (cell.triage) day.triage.push(email);
      if (cell.walkin) day.walkin.push(email);
      if (cell.cc) day.cc.push(email);
    }
  }

  return { emails, perDate, unknownCells };
}
```

- [ ] **Step 4: Run it; verify it passes:**

Run: `npm test -- medteam`
Expected: PASS (all medteam tests green).

- [ ] **Step 5: Commit:**

```bash
git add server/medteam.ts server/tests/medteam.test.ts
git commit -m "feat(medteam): buildImportPlan from workbook rows"
```

---

## Task 7: `computeDayMetrics` + `rolesForDept` (pure, TDD)

**Files:**
- Create: `src/app/components/schedule/capacity.ts`
- Test: `src/tests/capacity.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { computeDayMetrics, rolesForDept } from "@/app/components/schedule/capacity";

describe("computeDayMetrics", () => {
  const base = { onShift: 10, triage: 1, walkin: 1, shadow: 2, spanish: 3, patientsBooked: null };

  it("flags headcount under/at/over against ideal", () => {
    expect(computeDayMetrics(base, { idealHeadcount: 11, patientCapacityPerProvider: 3 }).headcountStatus).toBe("under");
    expect(computeDayMetrics({ ...base, onShift: 11 }, { idealHeadcount: 11, patientCapacityPerProvider: 3 }).headcountStatus).toBe("at");
    expect(computeDayMetrics({ ...base, onShift: 12 }, { idealHeadcount: 11, patientCapacityPerProvider: 3 }).headcountStatus).toBe("over");
    expect(computeDayMetrics(base, { idealHeadcount: null, patientCapacityPerProvider: null }).headcountStatus).toBe("unknown");
  });
  it("flags triage/walk-in coverage", () => {
    const m = computeDayMetrics({ ...base, triage: 0, walkin: 2 }, { idealHeadcount: 11, patientCapacityPerProvider: 3 });
    expect(m.triageStatus).toBe("missing");
    expect(m.walkinStatus).toBe("excess");
  });
  it("computes capacity and reschedule pressure", () => {
    const m = computeDayMetrics({ ...base, onShift: 10, patientsBooked: 35 }, { idealHeadcount: 11, patientCapacityPerProvider: 3 });
    expect(m.maxPatientCapacity).toBe(30);
    expect(m.patientsToReschedule).toBe(5);
  });
  it("returns null capacity when no multiplier", () => {
    const m = computeDayMetrics({ ...base, patientsBooked: 5 }, { idealHeadcount: 11, patientCapacityPerProvider: null });
    expect(m.maxPatientCapacity).toBeNull();
    expect(m.patientsToReschedule).toBeNull();
  });
});

describe("rolesForDept", () => {
  it("maps PCAR departments to their roles", () => {
    expect(rolesForDept("SCTP")).toEqual(["triage", "walkin"]);
    expect(rolesForDept("JCTP")).toEqual(["cc"]);
    expect(rolesForDept("EXEC")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it; verify it fails:**

Run: `npm test -- capacity`
Expected: FAIL — cannot resolve `@/app/components/schedule/capacity`.

- [ ] **Step 3: Implement** (create `src/app/components/schedule/capacity.ts`):

```ts
export type MedRole = "triage" | "walkin" | "cc";

export type DayCounts = {
  onShift: number;
  triage: number;
  walkin: number;
  shadow: number;
  spanish: number;
  patientsBooked: number | null;
};

export type DayConfig = {
  idealHeadcount: number | null;
  patientCapacityPerProvider: number | null;
};

export type Quota = "missing" | "ok" | "excess";

export type DayMetrics = {
  headcount: number;
  idealHeadcount: number | null;
  headcountStatus: "under" | "at" | "over" | "unknown";
  triageStatus: Quota;
  walkinStatus: Quota;
  shadowCount: number;
  spanishCount: number;
  maxPatientCapacity: number | null;
  patientsBooked: number | null;
  patientsToReschedule: number | null;
};

function quotaOf(n: number): Quota {
  return n === 0 ? "missing" : n === 1 ? "ok" : "excess";
}

export function computeDayMetrics(c: DayCounts, cfg: DayConfig): DayMetrics {
  const headcountStatus =
    cfg.idealHeadcount == null
      ? "unknown"
      : c.onShift < cfg.idealHeadcount
        ? "under"
        : c.onShift === cfg.idealHeadcount
          ? "at"
          : "over";
  const maxPatientCapacity =
    cfg.patientCapacityPerProvider == null ? null : cfg.patientCapacityPerProvider * c.onShift;
  const patientsToReschedule =
    c.patientsBooked != null && maxPatientCapacity != null ? c.patientsBooked - maxPatientCapacity : null;

  return {
    headcount: c.onShift,
    idealHeadcount: cfg.idealHeadcount,
    headcountStatus,
    triageStatus: quotaOf(c.triage),
    walkinStatus: quotaOf(c.walkin),
    shadowCount: c.shadow,
    spanishCount: c.spanish,
    maxPatientCapacity,
    patientsBooked: c.patientsBooked,
    patientsToReschedule,
  };
}

/** Which special roles a department uses. Empty for non-PCAR departments. */
export function rolesForDept(deptName: string): MedRole[] {
  if (deptName === "SCTP") return ["triage", "walkin"];
  if (deptName === "JCTP") return ["cc"];
  return [];
}
```

- [ ] **Step 4: Run it; verify it passes:**

Run: `npm test -- capacity`
Expected: PASS.

- [ ] **Step 5: Commit:**

```bash
git add src/app/components/schedule/capacity.ts src/tests/capacity.test.ts
git commit -m "feat(capacity): per-day metric + dept-role helpers"
```

---

## Task 8: API — read the new fields in `POST /schedule/:deptId`

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Extend `ScheduleRowFields`** (after `"Remote on Shift"?`):

```ts
  "Triage on Shift"?: unknown;
  "Walk-in on Shift"?: unknown;
  "CC on Shift"?: unknown;
  "Patients Booked"?: number;
```

- [ ] **Step 2: Extend `Su26RosterFields`** (after `"Submitted By"?`):

```ts
  "Ideal Headcount"?: number;
  "Patient Capacity Per Provider"?: number;
```

- [ ] **Step 3: Extend `AllPeopleFields`** (after the volunteer-ack field):

```ts
  "Spanish Speaking"?: boolean;
  "Returning Volunteer"?: boolean;
```

- [ ] **Step 4: Populate role arrays + patients-booked in `assignmentsByDate`.** In `POST /schedule/:deptId`, replace the `assignmentsByDate.set(...)` block (the one inside `for (const row of allSchedule)`):

```ts
    assignmentsByDate.set(iso, {
      directorIds: toIdList(row.fields["Directors on Shift"]),
      volunteerIds: toIdList(row.fields["Volunteers on Shift"]),
      shadowIds: toIdList(row.fields["Shadow Volunteers on Shift"]),
      remoteIds: toIdList(row.fields["Remote on Shift"]),
      triageIds: toIdList(row.fields["Triage on Shift"]),
      walkinIds: toIdList(row.fields["Walk-in on Shift"]),
      ccIds: toIdList(row.fields["CC on Shift"]),
      patientsBooked: typeof row.fields["Patients Booked"] === "number" ? row.fields["Patients Booked"] : null,
    });
```

- [ ] **Step 5: Widen the `assignmentsByDate` map type** (just above the loop) to include the new keys:

```ts
  const assignmentsByDate = new Map<
    string,
    {
      directorIds: string[];
      volunteerIds: string[];
      shadowIds: string[];
      remoteIds: string[];
      triageIds: string[];
      walkinIds: string[];
      ccIds: string[];
      patientsBooked: number | null;
    }
  >();
```

- [ ] **Step 6: Emit the new fields in the response.** Replace the `assignments: CANONICAL_DATES.map(...)` block in the final `c.json({...})`:

```ts
    assignments: CANONICAL_DATES.map((iso) => ({
      date: iso,
      directorIds: assignmentsByDate.get(iso)?.directorIds ?? [],
      volunteerIds: assignmentsByDate.get(iso)?.volunteerIds ?? [],
      shadowIds: assignmentsByDate.get(iso)?.shadowIds ?? [],
      remoteIds: assignmentsByDate.get(iso)?.remoteIds ?? [],
      triageIds: assignmentsByDate.get(iso)?.triageIds ?? [],
      walkinIds: assignmentsByDate.get(iso)?.walkinIds ?? [],
      ccIds: assignmentsByDate.get(iso)?.ccIds ?? [],
      patientsBooked: assignmentsByDate.get(iso)?.patientsBooked ?? null,
    })),
```

- [ ] **Step 7: Add dept config to the response.** In the same `c.json`, extend the `department` object:

```ts
    department: {
      id: dept.id,
      name: dept.fields["Department Name"] ?? "",
      submittedAt: dept.fields["Submitted At"] ?? null,
      submittedByName,
      idealHeadcount: typeof dept.fields["Ideal Headcount"] === "number" ? dept.fields["Ideal Headcount"] : null,
      patientCapacityPerProvider:
        typeof dept.fields["Patient Capacity Per Provider"] === "number" ? dept.fields["Patient Capacity Per Provider"] : null,
    },
```

- [ ] **Step 8: Add person attributes in `buildPerson`.** In the returned object of `buildPerson`, after `compliance,`:

```ts
      spanishSpeaking: person?.fields["Spanish Speaking"] === true,
      returning: person?.fields["Returning Volunteer"] === true,
```

- [ ] **Step 9: Verify compile + existing tests:**

Run: `npx tsc --noEmit && npm test`
Expected: tsc exit 0; all tests pass.

- [ ] **Step 10: Commit:**

```bash
git add server/app.ts
git commit -m "feat(api): read clinical roles, patients-booked, dept config, person attrs"
```

---

## Task 9: API — write the new fields in `POST /assignment`

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Import the coercion helper** (top of file, with the other `./` imports):

```ts
import { withRoleMembersOnShift } from "./medteam.js";
```

- [ ] **Step 2: Extend the request body type** in `app.post("/assignment", ...)`:

```ts
  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    departmentId?: string;
    date?: string; // ISO
    directorIds?: string[];
    volunteerIds?: string[];
    shadowIds?: string[];
    remoteIds?: string[];
    triageIds?: string[];
    walkinIds?: string[];
    ccIds?: string[];
    patientsBooked?: number | null;
  };
```

- [ ] **Step 3: Build the role fields with the on-shift invariant.** Replace the `const fields: Record<string, unknown> = {...}` block and the two `if (Array.isArray(...))` guards below it:

```ts
  const roleLists = [body.triageIds, body.walkinIds, body.ccIds].filter(Array.isArray) as string[][];
  const volunteerIds =
    roleLists.length > 0
      ? withRoleMembersOnShift(body.volunteerIds ?? [], roleLists)
      : body.volunteerIds ?? [];

  const fields: Record<string, unknown> = {
    Name: `${deptName} — ${dateName}`,
    Department: [departmentId],
    Date: dateName,
    "Directors on Shift": body.directorIds ?? [],
    "Volunteers on Shift": volunteerIds,
  };
  if (Array.isArray(body.shadowIds)) fields["Shadow Volunteers on Shift"] = body.shadowIds;
  if (Array.isArray(body.remoteIds)) fields["Remote on Shift"] = body.remoteIds;
  if (Array.isArray(body.triageIds)) fields["Triage on Shift"] = body.triageIds;
  if (Array.isArray(body.walkinIds)) fields["Walk-in on Shift"] = body.walkinIds;
  if (Array.isArray(body.ccIds)) fields["CC on Shift"] = body.ccIds;
  if (body.patientsBooked !== undefined) fields["Patients Booked"] = body.patientsBooked;
```

- [ ] **Step 4: Verify compile:**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit:**

```bash
git add server/app.ts
git commit -m "feat(api): persist clinical roles + patients-booked on assignment write"
```

---

## Task 10: API — strip roles in `POST /remove-volunteer`

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Include role lists in the affected-row filter.** In `/remove-volunteer`, replace the `const affected = schedule.filter(...)` block:

```ts
  const affected = schedule.filter((row) => {
    if (!toIdList(row.fields.Department).includes(departmentId)) return false;
    const vols = toIdList(row.fields["Volunteers on Shift"]);
    const shadows = toIdList(row.fields["Shadow Volunteers on Shift"]);
    const remotes = toIdList(row.fields["Remote on Shift"]);
    const triage = toIdList(row.fields["Triage on Shift"]);
    const walkin = toIdList(row.fields["Walk-in on Shift"]);
    const cc = toIdList(row.fields["CC on Shift"]);
    return (
      vols.includes(personId) ||
      shadows.includes(personId) ||
      remotes.includes(personId) ||
      triage.includes(personId) ||
      walkin.includes(personId) ||
      cc.includes(personId)
    );
  });
```

- [ ] **Step 2: Strip the person from role lists in the patch.** Replace the body of `affected.map((row) => {...})`:

```ts
    affected.map((row) => {
      const vols = toIdList(row.fields["Volunteers on Shift"]);
      const shadows = toIdList(row.fields["Shadow Volunteers on Shift"]);
      const remotes = toIdList(row.fields["Remote on Shift"]);
      const triage = toIdList(row.fields["Triage on Shift"]);
      const walkin = toIdList(row.fields["Walk-in on Shift"]);
      const cc = toIdList(row.fields["CC on Shift"]);
      const patch: Record<string, unknown> = {};
      if (vols.includes(personId)) patch["Volunteers on Shift"] = vols.filter((id) => id !== personId);
      if (shadows.includes(personId)) patch["Shadow Volunteers on Shift"] = shadows.filter((id) => id !== personId);
      if (remotes.includes(personId)) patch["Remote on Shift"] = remotes.filter((id) => id !== personId);
      if (triage.includes(personId)) patch["Triage on Shift"] = triage.filter((id) => id !== personId);
      if (walkin.includes(personId)) patch["Walk-in on Shift"] = walkin.filter((id) => id !== personId);
      if (cc.includes(personId)) patch["CC on Shift"] = cc.filter((id) => id !== personId);
      return patchRecord({
        baseId: config.haveNManagementBaseId,
        tableId: config.su26ScheduleTableId,
        recordId: row.id,
        fields: patch,
      });
    }),
```

- [ ] **Step 2b:** Note: `Shadow Volunteers on Shift` count still feeds the audit `Unscheduled Count` via `affected.length` — unchanged, correct.

- [ ] **Step 3: Verify compile + tests:**

Run: `npx tsc --noEmit && npm test`
Expected: tsc exit 0; tests pass.

- [ ] **Step 4: Commit:**

```bash
git add server/app.ts
git commit -m "feat(api): strip clinical-role lists when removing a volunteer"
```

---

## Task 11: Client — extend the `assign` payload type

**Files:**
- Modify: `src/api/client.ts:41-54`

- [ ] **Step 1: Add the new fields** to the `assign` input type:

```ts
  assign: (input: {
    callerNetid: string;
    callerEmail: string;
    departmentId: string;
    date: string;
    directorIds: string[];
    volunteerIds: string[];
    shadowIds: string[];
    remoteIds: string[];
    triageIds: string[];
    walkinIds: string[];
    ccIds: string[];
    patientsBooked: number | null;
  }) =>
    request<{ success: true }>("/assignment", {
      method: "POST",
      body: JSON.stringify(input),
    }),
```

- [ ] **Step 2: Verify compile** (ScheduleBuilder's `persist` call now needs the new fields — fixed in Task 12):

Run: `npx tsc --noEmit`
Expected: error in `ScheduleBuilder.tsx` — missing `triageIds`/`walkinIds`/`ccIds`/`patientsBooked` in the `api.assign` call. (Fixed next task.)

- [ ] **Step 3:** Do not commit yet — fix in Task 12, commit together.

---

## Task 12: ScheduleBuilder — persist new fields + role-cycle + patients-booked handlers

**Files:**
- Modify: `src/app/components/ScheduleBuilder.tsx`

- [ ] **Step 1: Send the new fields in `persist`.** Replace the `api.assign({...})` call (lines ~61-70):

```ts
      await api.assign({
        callerNetid: identity.person.netid,
        callerEmail: identity.person.email,
        departmentId: deptId,
        date: assignment.date,
        directorIds: assignment.directorIds,
        volunteerIds: assignment.volunteerIds,
        shadowIds: assignment.shadowIds,
        remoteIds: assignment.remoteIds,
        triageIds: assignment.triageIds,
        walkinIds: assignment.walkinIds,
        ccIds: assignment.ccIds,
        patientsBooked: assignment.patientsBooked,
      });
```

- [ ] **Step 2: Strip role lists when a volunteer leaves the shift.** In `handleAssignmentToggle`, replace the "no longer on shift" cleanup block:

```ts
      if (
        !a.directorIds.includes(personId) &&
        !a.volunteerIds.includes(personId) &&
        !a.shadowIds.includes(personId)
      ) {
        const rIdx = a.remoteIds.indexOf(personId);
        if (rIdx >= 0) a.remoteIds.splice(rIdx, 1);
        a.triageIds = a.triageIds.filter((id) => id !== personId);
        a.walkinIds = a.walkinIds.filter((id) => id !== personId);
        a.ccIds = a.ccIds.filter((id) => id !== personId);
      }
```

- [ ] **Step 3: Add the import** for `rolesForDept` (top of file, with other imports):

```ts
import { rolesForDept } from "./schedule/capacity";
```

- [ ] **Step 4: Add the role-cycle handler** (immediately after `handleRemoteToggle`):

```ts
  function handleRoleCycle(date: string, personId: string) {
    if (!data) return;
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ScheduleResponse;
      const a = next.assignments.find((x) => x.date === date);
      if (!a) return prev;
      const cycle: ("clinic" | "triage" | "walkin" | "cc")[] = ["clinic", ...rolesForDept(next.department.name)];
      const current = a.triageIds.includes(personId)
        ? "triage"
        : a.walkinIds.includes(personId)
          ? "walkin"
          : a.ccIds.includes(personId)
            ? "cc"
            : "clinic";
      const nextRole = cycle[(cycle.indexOf(current) + 1) % cycle.length];
      a.triageIds = a.triageIds.filter((id) => id !== personId);
      a.walkinIds = a.walkinIds.filter((id) => id !== personId);
      a.ccIds = a.ccIds.filter((id) => id !== personId);
      if (nextRole === "triage") a.triageIds.push(personId);
      else if (nextRole === "walkin") a.walkinIds.push(personId);
      else if (nextRole === "cc") a.ccIds.push(personId);
      if (!a.volunteerIds.includes(personId)) a.volunteerIds.push(personId);
      persist.schedule(`${date}`, { ...a }, next.department.id);
      return next;
    });
  }
```

- [ ] **Step 5: Add the patients-booked handler** (after `handleRoleCycle`):

```ts
  function handlePatientsBooked(date: string, value: number | null) {
    if (!data) return;
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ScheduleResponse;
      const a = next.assignments.find((x) => x.date === date);
      if (!a) return prev;
      a.patientsBooked = value;
      persist.schedule(`${date}`, { ...a }, next.department.id);
      return next;
    });
  }
```

- [ ] **Step 6: Pass the handlers to `SaturdayView`.** Locate the `<SaturdayView ... />` for the editable (non-readOnly) instance (the one already receiving `onToggleRemote={...}`) and add these props:

```tsx
          roles={data.callerIsDeptDirector && editMode === "assign" ? rolesForDept(data.department.name) : []}
          onCycleRole={
            data.callerIsDeptDirector && editMode === "assign" ? handleRoleCycle : undefined
          }
          capacity={
            editMode === "assign"
              ? {
                  idealHeadcount: data.department.idealHeadcount,
                  patientCapacityPerProvider: data.department.patientCapacityPerProvider,
                  onPatientsBooked: data.callerIsDeptDirector ? handlePatientsBooked : undefined,
                }
              : undefined
          }
```

- [ ] **Step 7: Verify compile** (SaturdayView doesn't accept these props yet — expected; fixed Task 14):

Run: `npx tsc --noEmit`
Expected: errors about unknown props `roles`/`onCycleRole`/`capacity` on `SaturdayView`. Proceed to Task 13/14.

- [ ] **Step 8:** Do not commit yet — commit after Task 14 when the UI tree compiles.

---

## Task 13: PersonRow — role pill + badge

**Files:**
- Modify: `src/app/components/schedule/PersonRow.tsx`

- [ ] **Step 1: Add imports** (extend the lucide import):

```ts
import { ArrowLeftRight, Stethoscope, X } from "lucide-react";
import type { MedRole } from "./capacity";
```

- [ ] **Step 2: Add a label map** above the `PersonRow` function:

```ts
const ROLE_LABEL: Record<"clinic" | MedRole, string> = {
  clinic: "Clinic",
  triage: "Triage",
  walkin: "Walk-in",
  cc: "CC",
};
```

- [ ] **Step 3: Add props** to the `PersonRow` destructure and its type (after `onToggleRemote`):

```ts
  role,
  roleCycle,
  onCycleRole,
  roleTally,
```

and in the prop type (after the `onToggleRemote?: () => void;` entry):

```ts
  /** Current clinical role of an assigned volunteer (SCTP/JCTP). */
  role?: "clinic" | MedRole;
  /** Special roles available to cycle through for this dept. Empty/undefined hides the control. */
  roleCycle?: MedRole[];
  /** When provided + person assigned + roleCycle non-empty, shows a clickable role pill. */
  onCycleRole?: () => void;
  /** Term-wide role-count summary for the roster, e.g. "Triage 2 · Walk-in 1". */
  roleTally?: string;
```

- [ ] **Step 4: Render the role pill** (place immediately after the remote-toggle `button` block, before the `{isRemote && !onToggleRemote && ...}` span):

```tsx
      {isAssigned && roleCycle && roleCycle.length > 0 && onCycleRole && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCycleRole();
          }}
          disabled={disabled}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border transition-colors ${
            role && role !== "clinic"
              ? "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="Click to change clinical role"
        >
          <Stethoscope className="w-3 h-3 opacity-60" aria-hidden />
          {ROLE_LABEL[role ?? "clinic"]}
        </button>
      )}
```

- [ ] **Step 5: Render Returning / Spanish badges + role tally** (spec §9). Place immediately after the `{!readOnly && person.availabilityOverridden && (...)}` block:

```tsx
      {!readOnly && person.returning && (
        <span
          className="text-[10px] uppercase tracking-wide text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded font-semibold"
          title="Returning volunteer (from application)."
        >
          returning
        </span>
      )}
      {!readOnly && person.spanishSpeaking && (
        <span
          className="text-[10px] uppercase tracking-wide text-teal-800 bg-teal-100 px-1.5 py-0.5 rounded font-semibold"
          title="Spanish-speaking."
        >
          ES
        </span>
      )}
      {!readOnly && roleTally && (
        <span
          className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded tabular-nums"
          title="Clinical-role assignments across the term."
        >
          {roleTally}
        </span>
      )}
```

- [ ] **Step 6: Verify compile** (consumers updated in Task 14):

Run: `npx tsc --noEmit`
Expected: still errors from SaturdayView props (Task 14), but none new inside PersonRow.tsx itself.

- [ ] **Step 7:** Do not commit yet.

---

## Task 14: SaturdayView — wire role handler + render CapacityPanel

**Files:**
- Modify: `src/app/components/schedule/SaturdayView.tsx`
- Create: `src/app/components/schedule/CapacityPanel.tsx`

- [ ] **Step 1: Create `CapacityPanel.tsx`:**

```tsx
import type { Assignment, Person } from "@/api/types";
import { computeDayMetrics, type MedRole } from "./capacity";

export type CapacityConfig = {
  idealHeadcount: number | null;
  patientCapacityPerProvider: number | null;
  /** (date, value) — value is null when the input is cleared. */
  onPatientsBooked?: (date: string, value: number | null) => void;
};

const QUOTA_CLASS = {
  missing: "text-red-700",
  excess: "text-amber-700",
  ok: "text-emerald-700",
} as const;

export function CapacityPanel({
  assignment,
  volunteers,
  roles,
  config,
}: {
  assignment: Assignment;
  volunteers: Person[];
  roles: MedRole[];
  config: CapacityConfig;
}) {
  const spanishIds = new Set(volunteers.filter((p) => p.spanishSpeaking).map((p) => p.id));
  const m = computeDayMetrics(
    {
      onShift: assignment.volunteerIds.length,
      triage: assignment.triageIds.length,
      walkin: assignment.walkinIds.length,
      shadow: assignment.shadowIds.length,
      spanish: assignment.volunteerIds.filter((id) => spanishIds.has(id)).length,
      patientsBooked: assignment.patientsBooked,
    },
    { idealHeadcount: config.idealHeadcount, patientCapacityPerProvider: config.patientCapacityPerProvider },
  );

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <span>
        <strong className="tabular-nums">{m.headcount}</strong>
        {m.idealHeadcount != null ? ` / ${m.idealHeadcount}` : ""} on shift
        {m.headcountStatus === "under" && <span className="text-amber-700"> (under)</span>}
        {m.headcountStatus === "over" && <span className="text-amber-700"> (over)</span>}
      </span>
      {roles.includes("triage") && (
        <span className={QUOTA_CLASS[m.triageStatus]}>Triage: {assignment.triageIds.length}</span>
      )}
      {roles.includes("walkin") && (
        <span className={QUOTA_CLASS[m.walkinStatus]}>Walk-in: {assignment.walkinIds.length}</span>
      )}
      {roles.includes("cc") && <span>CC: {assignment.ccIds.length}</span>}
      <span>Shadow: {m.shadowCount}</span>
      <span>Spanish: {m.spanishCount}</span>
      {m.maxPatientCapacity != null && (
        <span>
          Max capacity: <strong className="tabular-nums">{m.maxPatientCapacity}</strong>
        </span>
      )}
      {m.maxPatientCapacity != null && (
        <label className="flex items-center gap-1">
          Patients booked:
          <input
            type="number"
            min={0}
            value={m.patientsBooked ?? ""}
            disabled={!config.onPatientsBooked}
            onChange={(e) =>
              config.onPatientsBooked?.(assignment.date, e.target.value === "" ? null : Number(e.target.value))
            }
            className="w-16 border border-slate-300 rounded px-1 py-0.5 tabular-nums"
          />
        </label>
      )}
      {m.patientsToReschedule != null && m.patientsToReschedule > 0 && (
        <span className="text-red-700">To reschedule: {m.patientsToReschedule}</span>
      )}
      <span className="basis-full text-[11px] text-slate-400">Note: ≥3 shifts required to volunteer.</span>
    </div>
  );
}
```

- [ ] **Step 2: Add imports + props to SaturdayView.** Extend the top import and the component prop list. Add to imports:

```ts
import type { MedRole } from "./capacity";
import { CapacityPanel, type CapacityConfig } from "./CapacityPanel";
```

Add to the destructured props (after `onToggleRemote`):

```ts
  roles = [],
  onCycleRole,
  capacity,
```

Add to the prop type (after the `onToggleRemote?: ...` entry):

```ts
  /** Special clinical roles available for this dept (assign mode). Empty hides role controls. */
  roles?: MedRole[];
  /** Cycle a volunteer's clinical role on the active date. */
  onCycleRole?: (date: string, personId: string) => void;
  /** When provided (assign mode), renders the per-Saturday capacity panel. */
  capacity?: CapacityConfig;
```

- [ ] **Step 3: Harden the `active` fallback + compute per-person role tallies.** Replace the `const active = ...` line (line ~40) so the fallback is fully shaped (CapacityPanel reads `.triageIds.length` directly):

```ts
  const active = assignmentByIso[activeIso] ?? {
    date: activeIso,
    directorIds: [],
    volunteerIds: [],
    shadowIds: [],
    remoteIds: [],
    triageIds: [],
    walkinIds: [],
    ccIds: [],
    patientsBooked: null,
  };
```

Then add, just below the existing `volunteerAssignedCount` useMemo, a term-wide role-tally map:

```ts
  const roleTallyById = useMemo(() => {
    const t = new Map<string, { triage: number; walkin: number; cc: number }>();
    const bump = (id: string, key: "triage" | "walkin" | "cc") => {
      const cur = t.get(id) ?? { triage: 0, walkin: 0, cc: 0 };
      cur[key] += 1;
      t.set(id, cur);
    };
    for (const a of assignments) {
      for (const id of a.triageIds ?? []) bump(id, "triage");
      for (const id of a.walkinIds ?? []) bump(id, "walkin");
      for (const id of a.ccIds ?? []) bump(id, "cc");
    }
    return t;
  }, [assignments]);

  function roleTallyFor(p: Person): string | undefined {
    const t = roleTallyById.get(p.id);
    if (!t) return undefined;
    const parts: string[] = [];
    if (roles.includes("triage") && t.triage) parts.push(`Triage ${t.triage}`);
    if (roles.includes("walkin") && t.walkin) parts.push(`Walk-in ${t.walkin}`);
    if (roles.includes("cc") && t.cc) parts.push(`CC ${t.cc}`);
    return parts.length ? parts.join(" · ") : undefined;
  }
```

- [ ] **Step 4: Pass role props to volunteer `PersonRow`s in assign mode.** In the `column(...)` function's **assign-mode** return (the `available.map` and the `unavailable.map` blocks), add these props to each `<PersonRow>` (alongside the existing `isRemote`/`onToggleRemote`):

```tsx
              role={
                active.triageIds?.includes(p.id)
                  ? "triage"
                  : active.walkinIds?.includes(p.id)
                    ? "walkin"
                    : active.ccIds?.includes(p.id)
                      ? "cc"
                      : "clinic"
              }
              roleCycle={kind === "volunteer" ? roles : undefined}
              roleTally={kind === "volunteer" ? roleTallyFor(p) : undefined}
              onCycleRole={
                kind === "volunteer" && !readOnly && onCycleRole
                  ? () => onCycleRole(activeIso, p.id)
                  : undefined
              }
```

- [ ] **Step 5: Render the CapacityPanel** in assign mode. Replace the final `return (...)` of the component:

```tsx
  return (
    <div className="space-y-6">
      <DateTabStrip tabs={tabs} activeIso={activeIso} onSelect={setActiveIso} />

      {editMode === "assign" && capacity && (
        <CapacityPanel
          assignment={active as Assignment}
          volunteers={volunteers}
          roles={roles}
          config={capacity}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {column("Directors", directors, "director", active.directorIds)}
        {column("Volunteers", volunteers, "volunteer", active.volunteerIds)}
      </div>
    </div>
  );
```

- [ ] **Step 6: Verify compile + build:**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc exit 0; Vite build succeeds.

- [ ] **Step 7: Commit** (the whole UI chain now compiles):

```bash
git add src/api/client.ts src/app/components/ScheduleBuilder.tsx src/app/components/schedule/PersonRow.tsx src/app/components/schedule/SaturdayView.tsx src/app/components/schedule/CapacityPanel.tsx
git commit -m "feat(ui): clinical-role pill + per-Saturday capacity panel for PCAR depts"
```

---

## Task 15: Add `xlsx` devDependency + npm script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install SheetJS (dev only):**

Run: `npm install -D xlsx`
Expected: `xlsx` appears under `devDependencies`.

- [ ] **Step 2: Add the script** to `package.json` `"scripts"`:

```json
    "import:medteam": "tsx scripts/import-medteam.ts",
```

- [ ] **Step 3: Commit:**

```bash
git add package.json package-lock.json
git commit -m "chore: add xlsx devDependency + import:medteam script"
```

---

## Task 16: One-time migration script

**Files:**
- Create: `scripts/import-medteam.ts`

- [ ] **Step 1: Write the script:**

```ts
/**
 * One-time migration: seed SCTP/JCTP roster + assignment grid (with clinical
 * roles) from the Med Team workbook. Reads ONLY the SCTM/JCTM tabs — never the
 * PHI patient tabs. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   npm run import:medteam -- --file "Med Team Schedule Summer 2026.xlsx"
 *   npm run import:medteam -- --file "Med Team Schedule Summer 2026.xlsx" --apply
 */
import dotenv from "dotenv";
import * as XLSX from "xlsx";
import { createRecord, listAll, patchRecord, type AirtableRecord } from "../server/airtable.js";
import { loadConfig } from "../server/config.js";
import { CANONICAL_DATES, displayDate, normalizeVolunteerDate } from "../server/dates.js";
import { buildImportPlan, withRoleMembersOnShift, type SheetPersonRow } from "../server/medteam.js";

dotenv.config({ path: ".env.local" });

const SHEETS: { sheet: string; deptName: string }[] = [
  { sheet: "SCTM", deptName: "SCTP" },
  { sheet: "JCTM", deptName: "JCTP" },
];

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");
const FILE = argValue("--file") ?? "Med Team Schedule Summer 2026.xlsx";

function headerToIso(h: unknown): string | null {
  if (h instanceof Date) {
    const iso = `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, "0")}-${String(h.getUTCDate()).padStart(2, "0")}`;
    if ((CANONICAL_DATES as readonly string[]).includes(iso)) return iso;
    // tz fallback: try the local-date interpretation too
    const local = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
    return (CANONICAL_DATES as readonly string[]).includes(local) ? local : null;
  }
  if (typeof h === "string") return normalizeVolunteerDate(h);
  return null;
}

function extractSheet(ws: XLSX.WorkSheet): {
  rows: SheetPersonRow[];
  attrs: Map<string, { spanish: boolean; returning: boolean }>;
  dateCols: { idx: number; iso: string }[];
} {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const headerRow = (grid[0] ?? []) as unknown[];
  const dateCols: { idx: number; iso: string }[] = [];
  headerRow.forEach((h, idx) => {
    const iso = headerToIso(h);
    if (iso) dateCols.push({ idx, iso });
  });
  const rows: SheetPersonRow[] = [];
  const attrs = new Map<string, { spanish: boolean; returning: boolean }>();
  for (let r = 1; r < grid.length; r++) {
    const row = (grid[r] ?? []) as unknown[];
    const name = String(row[0] ?? "").trim(); // A
    const email = String(row[1] ?? "").trim().toLowerCase(); // B
    if (!email || !email.includes("@")) continue;
    const returning = String(row[2] ?? "").trim().toUpperCase() === "Y"; // C
    const spanish = String(row[6] ?? "").trim().toUpperCase() === "Y"; // G
    const cells: Record<string, string> = {};
    for (const { idx, iso } of dateCols) {
      const v = row[idx];
      if (v != null && String(v).trim() !== "") cells[iso] = String(v);
    }
    rows.push({ name, email, cells });
    attrs.set(email, { spanish, returning });
  }
  return { rows, attrs, dateCols };
}

async function main() {
  const config = loadConfig();
  if (!config) throw new Error("Missing Airtable config — check .env.local");

  const wb = XLSX.readFile(FILE, { cellDates: true });

  const allPeople = await listAll<{ "Contact Email"?: string; Name?: string }>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
    fields: ["Contact Email", "Name"],
  });
  const idByEmail = new Map<string, string>();
  for (const p of allPeople) {
    const e = (p.fields["Contact Email"] ?? "").trim().toLowerCase();
    if (e) idByEmail.set(e, p.id);
  }

  const roster = await listAll<{ "Department Name"?: string; Volunteers?: unknown }>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });

  console.log(`\n=== Med Team import (${APPLY ? "APPLY" : "DRY-RUN"}) — file: ${FILE} ===`);

  for (const { sheet, deptName } of SHEETS) {
    const ws = wb.Sheets[sheet];
    if (!ws) {
      console.log(`\n[${deptName}] sheet "${sheet}" not found — skipping.`);
      continue;
    }
    const { rows, attrs, dateCols } = extractSheet(ws);
    const plan = buildImportPlan(rows, dateCols.map((d) => d.iso));

    console.log(`\n[${deptName}] from "${sheet}"`);
    console.log(`  date columns mapped: ${dateCols.map((d) => d.iso).join(", ")}`);
    console.log(`  roster rows: ${plan.emails.length}`);

    const matched = plan.emails.filter((e) => idByEmail.has(e));
    const unmatched = plan.emails.filter((e) => !idByEmail.has(e));
    console.log(`  matched to All People: ${matched.length}`);
    if (unmatched.length) console.log(`  UNMATCHED (skipped): ${unmatched.join(", ")}`);
    if (plan.unknownCells.length)
      console.log(`  UNKNOWN cells: ${plan.unknownCells.map((u) => `${u.email}@${u.date}="${u.raw}"`).join(", ")}`);

    const deptRow = roster.find((r) => r.fields["Department Name"] === deptName);
    if (!deptRow) {
      console.log(`  ERROR: department "${deptName}" not found in roster — skipping writes.`);
      continue;
    }
    const deptId = deptRow.id;
    const toId = (e: string) => idByEmail.get(e);

    // Per-date summary
    for (const { iso } of dateCols) {
      const d = plan.perDate[iso];
      const n = d.onShift.length + d.shadow.length;
      if (n === 0) continue;
      console.log(
        `    ${iso}: on-shift ${d.onShift.length} (triage ${d.triage.length}, walk-in ${d.walkin.length}, cc ${d.cc.length}), shadow ${d.shadow.length}`,
      );
    }

    if (!APPLY) continue;

    // 1) roster membership (union with existing)
    const existingVols = Array.isArray(deptRow.fields.Volunteers)
      ? (deptRow.fields.Volunteers as unknown[]).map((v) => (typeof v === "string" ? v : (v as { id?: string }).id ?? ""))
      : [];
    const newVols = [...new Set([...existingVols.filter(Boolean), ...matched.map(toId).filter(Boolean) as string[]])];
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26RosterTableId,
      recordId: deptId,
      fields: { Volunteers: newVols },
    });

    // 2) attributes
    for (const email of matched) {
      const a = attrs.get(email);
      const id = toId(email);
      if (!a || !id) continue;
      await patchRecord({
        baseId: config.haveNManagementBaseId,
        tableId: config.allPeopleTableId,
        recordId: id,
        fields: { "Spanish Speaking": a.spanish, "Returning Volunteer": a.returning },
      });
    }

    // 3) schedule rows (upsert per dept+date)
    const existingSchedule = await listAll<{ Department?: unknown; Date?: unknown }>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
    });
    const rowFor = (iso: string): AirtableRecord | undefined =>
      existingSchedule.find((row) => {
        const dep = Array.isArray(row.fields.Department)
          ? (row.fields.Department as unknown[]).map((v) => (typeof v === "string" ? v : (v as { id?: string }).id ?? ""))
          : [];
        const dateName = typeof row.fields.Date === "string" ? row.fields.Date : (row.fields.Date as { name?: string })?.name ?? "";
        return dep.includes(deptId) && normalizeVolunteerDate(dateName) === iso;
      });

    for (const { iso } of dateCols) {
      const d = plan.perDate[iso];
      if (d.onShift.length === 0 && d.shadow.length === 0) continue;
      const ids = (list: string[]) => list.map(toId).filter(Boolean) as string[];
      const onShiftIds = ids(d.onShift);
      const triageIds = ids(d.triage);
      const walkinIds = ids(d.walkin);
      const ccIds = ids(d.cc);
      const fields: Record<string, unknown> = {
        Name: `${deptName} — ${displayDate(iso)}`,
        Department: [deptId],
        Date: displayDate(iso),
        "Volunteers on Shift": withRoleMembersOnShift(onShiftIds, [triageIds, walkinIds, ccIds]),
        "Shadow Volunteers on Shift": ids(d.shadow),
        "Triage on Shift": triageIds,
        "Walk-in on Shift": walkinIds,
        "CC on Shift": ccIds,
      };
      const existing = rowFor(iso);
      if (existing) {
        await patchRecord({ baseId: config.haveNManagementBaseId, tableId: config.su26ScheduleTableId, recordId: existing.id, fields });
      } else {
        await createRecord({ baseId: config.haveNManagementBaseId, tableId: config.su26ScheduleTableId, fields });
      }
    }
    console.log(`  [${deptName}] writes complete.`);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Bring the script under the type-checker.** Add `"scripts"` to `tsconfig.json` `include` so the standard `tsc` checks it:

```json
  "include": ["src", "api", "server", "scripts"]
```

- [ ] **Step 2b: Type-check:**

Run: `npx tsc --noEmit`
Expected: exit 0. (`noUnusedLocals`/`noUnusedParameters` are on — the script must keep every import/local used.)

- [ ] **Step 3: Run the dry-run against the workbook:**

Run: `npm run import:medteam -- --file "Med Team Schedule Summer 2026.xlsx"`
Expected: prints, per department, the mapped date columns (the 17 Saturdays May 30–Sep 26, July 4 absent), roster counts, any UNMATCHED emails, any UNKNOWN cells, and per-date on-shift/role/shadow counts. **No writes.** Sanity-check the date columns and that matched counts look right.

- [ ] **Step 4: Commit:**

```bash
git add scripts/import-medteam.ts tsconfig.json
git commit -m "feat(scripts): one-time Med Team workbook migration (dry-run default)"
```

- [ ] **Step 5: Apply (operator decision, after dry-run looks right):** Once Task 1's Airtable fields exist and the dry-run is verified, run with `--apply`. This is an operational step, not part of the code commit:

Run: `npm run import:medteam -- --file "Med Team Schedule Summer 2026.xlsx" --apply`
Expected: per-dept "writes complete." Then open the portal as a PCAR director and confirm SCTP/JCTP rosters + grids + roles appear.

---

## Task 17: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck:**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Full test suite:**

Run: `npm test`
Expected: all pass, including the new `medteam` and `capacity` suites.

- [ ] **Step 3: Production build:**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 4: Manual smoke (dev server):**

Run: `npm run dev`, sign in as a PCAR director, open SCTP:
- Capacity panel shows on a Saturday in assign mode; headcount/triage/walk-in/Spanish/capacity render.
- Clicking a volunteer's role pill cycles Clinic → Triage → Walk-in → Clinic; the triage/walk-in counts in the panel update.
- Entering "Patients booked" shows "to reschedule" when over capacity.
- Switch to JCTP: pill cycles Clinic ↔ CC; no triage/walk-in/capacity shown.
- A non-PCAR dept shows no role pills or capacity panel (feature is invisible there).

- [ ] **Step 5: Commit any doc updates** (e.g., note the new env-free script in README if desired):

```bash
git commit --allow-empty -m "chore: verify PCAR med team enrichment end-to-end"
```

---

## Notes for the implementer

- **PHI boundary:** the migration reads only `SCTM`/`JCTM`. Never read or write `Patient Assignments`, `Clinic Day Scheduling`, `LC-SCTM Schedules`, or `TEMP Spring 26 Resched`.
- **Idempotency:** the script upserts schedule rows per (dept, date) and unions roster membership, so re-running is safe.
- **Availability is intentionally not modified** (per spec §11). Assigned-but-not-listed people may render as "not avail" in the grid; that is expected and acceptable.
- **Quota of 1** (Triage/Walk-in) is surfaced as color, never enforced — multi-link tolerates 0 or 2+.
