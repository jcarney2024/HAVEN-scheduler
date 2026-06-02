# Director Compliance Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show directors a prominent, dismissible banner at sign-in listing every non-compliant volunteer (missing contract and/or training) across all departments they oversee, grouped by department.

**Architecture:** Compliance is already pulled from the Airtable HAVEN Management → Compliance table. We extract the OR-aggregation logic into a pure, testable module (`server/compliance.ts`), reuse it in the existing `/schedule` handler, and call it from the `/director` handler to attach a `nonCompliantVolunteers` list to each department in the sign-in response. A new `ComplianceBanner` React component renders that data at the top of `ScheduleBuilder`, independent of the selected department.

**Tech Stack:** Hono (server), Vitest (tests), React + TypeScript + Tailwind (UI), Airtable REST via `listAll`.

---

## File Structure

- **Create** `server/compliance.ts` — pure helpers: `buildComplianceByPersonId` (OR-aggregate Compliance rows) and `buildNonCompliantByDept` (per-department non-compliant volunteer lists). No Airtable I/O.
- **Create** `server/tests/compliance.test.ts` — unit tests for both helpers.
- **Modify** `server/app.ts` — import and use the new helpers in `/schedule` (replace the inline aggregation) and `/director` (new fetch + attach `nonCompliantVolunteers`).
- **Modify** `src/api/types.ts` — add `NonCompliantVolunteer` type; add `nonCompliantVolunteers` to `DepartmentRef`.
- **Create** `src/app/components/schedule/ComplianceBanner.tsx` — presentational banner.
- **Create** `src/app/components/schedule/ComplianceBanner.test.tsx` — component tests.
- **Modify** `src/app/components/ScheduleBuilder.tsx` — dismiss state + render the banner.

---

## Task 1: Extract `buildComplianceByPersonId` pure helper

**Files:**
- Create: `server/compliance.ts`
- Test: `server/tests/compliance.test.ts`

This mirrors the existing inline logic at `server/app.ts:465-479` exactly (OR across all rows for a person), but as an importable pure function. `toIdList` is private to `app.ts`, so the helper takes the already-extracted id list per row — the caller maps Airtable rows into the simple shape below.

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/compliance.test.ts
import { describe, it, expect } from "vitest";
import { buildComplianceByPersonId, type ComplianceRow } from "../compliance";

describe("buildComplianceByPersonId", () => {
  it("ORs contract and training across multiple rows for the same person", () => {
    const rows: ComplianceRow[] = [
      { personIds: ["p1"], contract: true, training: false },
      { personIds: ["p1"], contract: false, training: true },
    ];
    const map = buildComplianceByPersonId(rows);
    expect(map.get("p1")).toEqual({ contract: true, training: true });
  });

  it("handles a row linked to multiple people", () => {
    const rows: ComplianceRow[] = [
      { personIds: ["p1", "p2"], contract: true, training: false },
    ];
    const map = buildComplianceByPersonId(rows);
    expect(map.get("p1")).toEqual({ contract: true, training: false });
    expect(map.get("p2")).toEqual({ contract: true, training: false });
  });

  it("returns no entry for a person with no rows", () => {
    const map = buildComplianceByPersonId([]);
    expect(map.get("p1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/compliance.test.ts`
Expected: FAIL — cannot find module `../compliance`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/compliance.ts

export type ComplianceFlags = { contract: boolean; training: boolean };

export type ComplianceRow = {
  /** All People record ids linked via the Compliance row's "Names" field. */
  personIds: string[];
  contract: boolean;
  training: boolean;
};

/**
 * Aggregate Compliance rows into a per-person map. OR'd across all rows: a
 * contract on file once is enough, even if it lives on a different role's row.
 */
export function buildComplianceByPersonId(
  rows: ComplianceRow[],
): Map<string, ComplianceFlags> {
  const out = new Map<string, ComplianceFlags>();
  for (const row of rows) {
    for (const pid of row.personIds) {
      const prev = out.get(pid) ?? { contract: false, training: false };
      out.set(pid, {
        contract: prev.contract || row.contract,
        training: prev.training || row.training,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/tests/compliance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/compliance.ts server/tests/compliance.test.ts
git commit -m "feat(compliance): extract buildComplianceByPersonId pure helper"
```

---

## Task 2: Add `buildNonCompliantByDept` pure helper

**Files:**
- Modify: `server/compliance.ts`
- Test: `server/tests/compliance.test.ts`

Produces, per department, the list of volunteers missing contract or training. A volunteer with no compliance entry counts as missing both (matches `server/app.ts:638-641`).

- [ ] **Step 1: Write the failing test**

```ts
// append to server/tests/compliance.test.ts
import {
  buildNonCompliantByDept,
  type NonCompliantVolunteer,
} from "../compliance";

describe("buildNonCompliantByDept", () => {
  const complianceByPersonId = new Map([
    ["v1", { contract: true, training: true }],   // compliant
    ["v2", { contract: true, training: false }],  // missing training
    ["v3", { contract: false, training: false }], // missing both
    // v4 has no entry → treated as missing both
  ]);
  const nameById = new Map([
    ["v1", "Ada"],
    ["v2", "Bea"],
    ["v3", "Cy"],
    ["v4", "Dee"],
  ]);

  it("lists volunteers missing contract or training, with specific items", () => {
    const result = buildNonCompliantByDept({
      depts: [{ id: "d1", volunteerIds: ["v1", "v2", "v3", "v4"] }],
      complianceByPersonId,
      nameById,
    });
    expect(result.get("d1")).toEqual<NonCompliantVolunteer[]>([
      { id: "v2", name: "Bea", missing: ["training"] },
      { id: "v3", name: "Cy", missing: ["contract", "training"] },
      { id: "v4", name: "Dee", missing: ["contract", "training"] },
    ]);
  });

  it("returns an empty array for a department whose volunteers are all compliant", () => {
    const result = buildNonCompliantByDept({
      depts: [{ id: "d1", volunteerIds: ["v1"] }],
      complianceByPersonId,
      nameById,
    });
    expect(result.get("d1")).toEqual([]);
  });

  it("falls back to the id when no name is known", () => {
    const result = buildNonCompliantByDept({
      depts: [{ id: "d1", volunteerIds: ["vX"] }],
      complianceByPersonId,
      nameById,
    });
    expect(result.get("d1")).toEqual([
      { id: "vX", name: "vX", missing: ["contract", "training"] },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/compliance.test.ts`
Expected: FAIL — `buildNonCompliantByDept` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to server/compliance.ts

export type NonCompliantVolunteer = {
  id: string;
  name: string;
  missing: ("contract" | "training")[]; // non-empty
};

/**
 * For each department, the volunteers missing a contract and/or training.
 * No compliance entry for a volunteer means missing both. Departments map to
 * an empty array when every volunteer is compliant.
 */
export function buildNonCompliantByDept(args: {
  depts: { id: string; volunteerIds: string[] }[];
  complianceByPersonId: Map<string, ComplianceFlags>;
  nameById: Map<string, string>;
}): Map<string, NonCompliantVolunteer[]> {
  const out = new Map<string, NonCompliantVolunteer[]>();
  for (const dept of args.depts) {
    const list: NonCompliantVolunteer[] = [];
    for (const id of dept.volunteerIds) {
      const flags = args.complianceByPersonId.get(id) ?? {
        contract: false,
        training: false,
      };
      const missing: ("contract" | "training")[] = [];
      if (!flags.contract) missing.push("contract");
      if (!flags.training) missing.push("training");
      if (missing.length > 0) {
        list.push({ id, name: args.nameById.get(id) ?? id, missing });
      }
    }
    out.set(dept.id, list);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/tests/compliance.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add server/compliance.ts server/tests/compliance.test.ts
git commit -m "feat(compliance): add buildNonCompliantByDept pure helper"
```

---

## Task 3: Use `buildComplianceByPersonId` in the existing `/schedule` handler

**Files:**
- Modify: `server/app.ts` (import line ~9; aggregation block at `server/app.ts:465-480`)

Refactor only — no behavior change. Replaces the inline map-building with the new helper to keep both call sites in sync. `allCompliance` (a `listAll<ComplianceFields>` result) and `toIdList` already exist in scope.

- [ ] **Step 1: Add the import**

In `server/app.ts`, add after the existing `./public.js` import (line 9):

```ts
import {
  buildComplianceByPersonId,
  buildNonCompliantByDept,
  type ComplianceRow,
} from "./compliance.js";
```

- [ ] **Step 2: Replace the inline aggregation**

Replace the block at `server/app.ts:465-480` (the `const complianceByPersonId = new Map<…>();` declaration through the closing `}` of its `for` loop) with:

```ts
  // All People recordId → aggregated volunteer compliance.
  const complianceByPersonId = buildComplianceByPersonId(
    allCompliance.map(
      (row): ComplianceRow => ({
        personIds: toIdList(row.fields.Names),
        contract: row.fields["Volunteer Contract"] === true,
        training: row.fields["Volunteer Training"] === true,
      }),
    ),
  );
```

- [ ] **Step 3: Run the full server test suite + typecheck**

Run: `npx vitest run server/ && npx tsc --noEmit`
Expected: PASS, no type errors. (Existing `/schedule` behavior unchanged; the `compliance` field on volunteers still resolves identically.)

- [ ] **Step 4: Commit**

```bash
git add server/app.ts
git commit -m "refactor(schedule): use shared buildComplianceByPersonId helper"
```

---

## Task 4: Add `nonCompliantVolunteers` to the API types

**Files:**
- Modify: `src/api/types.ts:1-5` (the `DepartmentRef` type)

- [ ] **Step 1: Update the types**

Replace the `DepartmentRef` definition at the top of `src/api/types.ts` (lines 1-5) with:

```ts
export type NonCompliantVolunteer = {
  id: string;
  name: string;
  /** Which items are missing. Non-empty. */
  missing: ("contract" | "training")[];
};

export type DepartmentRef = {
  id: string;
  name: string;
  pendingRequestCount: number;
  /** Volunteers in this department missing a contract and/or training.
   *  Empty array when everyone is compliant. */
  nonCompliantVolunteers: NonCompliantVolunteer[];
};
```

- [ ] **Step 2: Typecheck (expected to fail in the handler — that's fine)**

Run: `npx tsc --noEmit`
Expected: errors at the `/director` handler's `departments:` mapping (missing `nonCompliantVolunteers`). Task 5 fixes them. If there are errors anywhere else, note them.

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts
git commit -m "feat(types): add nonCompliantVolunteers to DepartmentRef"
```

---

## Task 5: Compute and attach `nonCompliantVolunteers` in the `/director` handler

**Files:**
- Modify: `server/app.ts` — the `/director/:netid` handler (`server/app.ts:336-395`)

The handler already has `sorted` (the visible departments, each a `Su26RosterFields` record with a `Volunteers` field) and `person`. We add a Compliance fetch, a batched name lookup for all volunteers across those departments, build the per-dept map, and attach it.

- [ ] **Step 1: Add the compliance + name fetch and aggregation**

In `server/app.ts`, immediately after the `pendingCountByDept` loop ends (`server/app.ts:379`, the line `}` closing the `for (const r of pendingForCounts)` loop) and before the `return c.json({` at line 381, insert:

```ts
  // Compliance summary per department for the sign-in banner.
  const allCompliance = await listAll<ComplianceFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.complianceTableId,
    fields: ["Names", "Volunteer Contract", "Volunteer Training"],
  });
  const complianceByPersonId = buildComplianceByPersonId(
    allCompliance.map(
      (row): ComplianceRow => ({
        personIds: toIdList(row.fields.Names),
        contract: row.fields["Volunteer Contract"] === true,
        training: row.fields["Volunteer Training"] === true,
      }),
    ),
  );

  const deptVolunteerIds = sorted.map((d) => ({
    id: d.id,
    volunteerIds: toIdList(d.fields.Volunteers),
  }));
  const allVolunteerIds = [
    ...new Set(deptVolunteerIds.flatMap((d) => d.volunteerIds)),
  ];
  const volunteerPeople = allVolunteerIds.length
    ? await listAll<AllPeopleFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.allPeopleTableId,
        filterByFormula: `OR(${allVolunteerIds
          .map((id) => `RECORD_ID() = '${id}'`)
          .join(",")})`,
        fields: ["Name"],
      })
    : [];
  const nameById = new Map(
    volunteerPeople.map((p) => [p.id, p.fields.Name ?? ""]),
  );
  const nonCompliantByDept = buildNonCompliantByDept({
    depts: deptVolunteerIds,
    complianceByPersonId,
    nameById,
  });
```

Note: `ComplianceFields`, `AllPeopleFields`, `config.complianceTableId`, `config.allPeopleTableId`, and `config.haveNManagementBaseId` already exist and are used by the `/schedule` handler.

- [ ] **Step 2: Attach it to the response**

In the same handler, update the `departments:` mapping (`server/app.ts:389-393`) to include the new field:

```ts
    departments: sorted.map((d) => ({
      id: d.id,
      name: d.fields["Department Name"] ?? "",
      pendingRequestCount: pendingCountByDept.get(d.id) ?? 0,
      nonCompliantVolunteers: nonCompliantByDept.get(d.id) ?? [],
    })),
```

- [ ] **Step 3: Typecheck + run server tests**

Run: `npx tsc --noEmit && npx vitest run server/`
Expected: no type errors; all server tests PASS.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run: `npm run dev`, sign in as a director, and confirm the `/api/director/...` network response now includes `nonCompliantVolunteers` arrays per department. Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add server/app.ts
git commit -m "feat(director): include per-department non-compliant volunteers at sign-in"
```

---

## Task 6: Build the `ComplianceBanner` component

**Files:**
- Create: `src/app/components/schedule/ComplianceBanner.tsx`
- Test: `src/tests/complianceBanner.test.ts` (pure-logic test only)

Presentational. Renders nothing when nobody is non-compliant. Otherwise an amber banner with a red count header, names grouped by department (department sub-headings shown only when more than one department has issues), each name followed by its missing items. A dismiss `×` calls `onDismiss`.

> **Why no full component (DOM) test:** this project's `vitest.config.ts` runs in the `node` environment, only collects tests under `src/tests/**` and `server/tests/**`, and has no `@testing-library/react`. There are no existing component tests — all tests are pure-function tests. Per "follow existing patterns / YAGNI," we do **not** add DOM-testing infrastructure. The real branching logic (which departments have issues, the count, the missing-items label, single-vs-multi-department) is extracted into a pure `summarizeCompliance` helper and unit-tested in `src/tests/`; the JSX is verified manually in Task 7. The pure helper lives in the same file as the component and is imported by the test via the `@` alias (already configured in `vitest.config.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/tests/complianceBanner.test.ts
import { describe, it, expect } from "vitest";
import { summarizeCompliance, formatMissing } from "@/app/components/schedule/ComplianceBanner";
import type { DepartmentRef } from "@/api/types";

function dept(over: Partial<DepartmentRef>): DepartmentRef {
  return { id: "d", name: "Dept", pendingRequestCount: 0, nonCompliantVolunteers: [], ...over };
}

describe("formatMissing", () => {
  it("joins missing items with a plus", () => {
    expect(formatMissing(["training"])).toBe("training");
    expect(formatMissing(["contract", "training"])).toBe("contract + training");
  });
});

describe("summarizeCompliance", () => {
  it("reports zero total when everyone is compliant", () => {
    const s = summarizeCompliance([dept({})]);
    expect(s.total).toBe(0);
    expect(s.withIssues).toEqual([]);
    expect(s.multiDept).toBe(false);
  });

  it("counts non-compliant volunteers across departments and flags multiDept", () => {
    const s = summarizeCompliance([
      dept({ id: "d1", name: "SRHD", nonCompliantVolunteers: [{ id: "v1", name: "Ada", missing: ["contract"] }] }),
      dept({ id: "d2", name: "SCTS", nonCompliantVolunteers: [
        { id: "v2", name: "Bea", missing: ["training"] },
        { id: "v3", name: "Cy", missing: ["contract", "training"] },
      ] }),
      dept({ id: "d3", name: "CCRH", nonCompliantVolunteers: [] }),
    ]);
    expect(s.total).toBe(3);
    expect(s.withIssues.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(s.multiDept).toBe(true);
  });

  it("does not flag multiDept when only one department has issues", () => {
    const s = summarizeCompliance([
      dept({ id: "d1", name: "SRHD", nonCompliantVolunteers: [{ id: "v1", name: "Ada", missing: ["contract"] }] }),
      dept({ id: "d2", name: "SCTS", nonCompliantVolunteers: [] }),
    ]);
    expect(s.total).toBe(1);
    expect(s.multiDept).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tests/complianceBanner.test.ts`
Expected: FAIL — cannot find module `@/app/components/schedule/ComplianceBanner`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/components/schedule/ComplianceBanner.tsx
import { X, AlertTriangle } from "lucide-react";
import type { DepartmentRef } from "@/api/types";

export function formatMissing(missing: ("contract" | "training")[]): string {
  return missing.join(" + ");
}

/** Pure summary of compliance state across the director's departments. */
export function summarizeCompliance(departments: DepartmentRef[]): {
  withIssues: DepartmentRef[];
  total: number;
  multiDept: boolean;
} {
  const withIssues = departments.filter((d) => d.nonCompliantVolunteers.length > 0);
  const total = withIssues.reduce((n, d) => n + d.nonCompliantVolunteers.length, 0);
  return { withIssues, total, multiDept: withIssues.length > 1 };
}

export function ComplianceBanner({
  departments,
  onDismiss,
}: {
  departments: DepartmentRef[];
  onDismiss: () => void;
}) {
  const { withIssues, total, multiDept } = summarizeCompliance(departments);
  if (total === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-900">
          {total} volunteer{total === 1 ? "" : "s"}
          {multiDept ? " across your departments" : ""} {total === 1 ? "isn't" : "aren't"}{" "}
          compliant
        </p>
        <p className="text-sm text-amber-800 mt-0.5">
          Missing a signed volunteer contract and/or required training.
        </p>
        <div className="mt-3 space-y-3">
          {withIssues.map((d) => (
            <div key={d.id}>
              {multiDept && (
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">
                  {d.name}
                </p>
              )}
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {d.nonCompliantVolunteers.map((v) => (
                  <li key={v.id} className="flex items-center gap-1.5 text-sm text-slate-800">
                    <span className="font-medium">{v.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-red-800 bg-red-100 px-1.5 py-0.5 rounded font-semibold">
                      {formatMissing(v.missing)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss compliance banner"
        className="text-amber-600 hover:text-amber-900 transition-colors shrink-0"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tests/complianceBanner.test.ts`
Expected: PASS (formatMissing + summarizeCompliance suites).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/schedule/ComplianceBanner.tsx src/tests/complianceBanner.test.ts
git commit -m "feat(ui): add ComplianceBanner component"
```

---

## Task 7: Wire the banner into `ScheduleBuilder`

**Files:**
- Modify: `src/app/components/ScheduleBuilder.tsx` (import block lines 1-13; state near line 33; render near line 324)

- [ ] **Step 1: Add the import**

In `src/app/components/ScheduleBuilder.tsx`, add with the other `./schedule/*` imports (after line 11):

```ts
import { ComplianceBanner } from "./schedule/ComplianceBanner";
```

- [ ] **Step 2: Add dismiss state**

After the `removeLoading` state declaration (`src/app/components/ScheduleBuilder.tsx:33`), add:

```ts
  const [complianceDismissed, setComplianceDismissed] = useState(false);
```

- [ ] **Step 3: Render the banner at the top of the card**

In the returned JSX, the outer card starts at `src/app/components/ScheduleBuilder.tsx:324`:

```tsx
    <div className="bg-white rounded-xl p-4 sm:p-6 lg:p-8 shadow-lg space-y-6 w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
```

Insert the banner as the first child, immediately after the opening card `<div ...>` and before the `<div className="flex flex-wrap items-center justify-between gap-3">`:

```tsx
    <div className="bg-white rounded-xl p-4 sm:p-6 lg:p-8 shadow-lg space-y-6 w-full max-w-7xl">
      {!complianceDismissed && (
        <ComplianceBanner
          departments={identity.departments}
          onDismiss={() => setComplianceDismissed(true)}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
```

The banner reads `identity.departments` (all departments, populated at sign-in), so it is independent of `selectedDeptId` and survives department switches. `ScheduleBuilder` unmounts on sign-out, so `complianceDismissed` resets per session automatically.

- [ ] **Step 4: Typecheck + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests PASS.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, sign in as a director who oversees a volunteer missing contract/training. Confirm:
- The amber banner appears at the top of the schedule with the correct count and names.
- Switching departments keeps the banner showing all departments' issues.
- Clicking `×` hides it; it stays hidden while navigating, and reappears after sign out + sign back in.
Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/ScheduleBuilder.tsx
git commit -m "feat(schedule): show director compliance banner at top of schedule"
```

---

## Self-Review Notes

- **Spec coverage:** who counts (all roster volunteers — Task 5 walks `dept.fields.Volunteers`) ✓; definition contract-OR-training incl. no-row→both (Task 2) ✓; dismissible per session (Task 7 state + unmount reset) ✓; always-visible name list grouped by dept (Task 6) ✓; all-departments scope sourced from `/director` (Task 5) ✓; inline badges untouched ✓; tests for both server helpers + the banner's pure summary logic ✓.
- **Testing approach:** matches the project's existing pattern — pure-function tests only, under `src/tests/**` and `server/tests/**`, `node` environment. No DOM/component-test infra is added (none exists). Banner JSX is verified manually in Task 7 Step 5.
- **Type consistency:** `NonCompliantVolunteer` shape (`id`, `name`, `missing`) is identical in `server/compliance.ts` (Task 2) and `src/api/types.ts` (Task 4). `buildComplianceByPersonId` / `buildNonCompliantByDept` / `ComplianceRow` names match across Tasks 1, 2, 3, 5.
- **Reused existing infra:** `ComplianceFields`, `AllPeopleFields`, `config.*` ids, `listAll`, `toIdList`, and the `OR(RECORD_ID()=...)` batch-fetch pattern all already exist in `server/app.ts`.
