# Compliance Banner for Directors — Design

**Date:** 2026-06-02
**Status:** Approved, pending implementation plan

## Problem

Directors need it to be *blatantly obvious* which volunteers in their
department(s) are not compliant (missing a signed volunteer contract and/or
required training). Today this information exists but is only surfaced as small
inline "missing: …" badges next to individual names in the roster
([`PersonRow.tsx`](../../../src/app/components/schedule/PersonRow.tsx),
[`GridView.tsx`](../../../src/app/components/schedule/GridView.tsx)). A director
has to scan the whole roster, one department at a time, to notice them.

We want a prominent banner, shown when a director signs in, summarizing every
non-compliant volunteer across all departments they oversee — built on the
compliance data the app already pulls from Airtable.

## Decisions (from brainstorming)

- **Who counts:** every volunteer on a department's roster, whether or not
  they're scheduled on a Saturday yet.
- **Definition of non-compliant:** missing contract **OR** missing training —
  identical to the existing inline-badge behavior. A volunteer with no
  Compliance row at all counts as missing both.
- **Behavior:** dismissible per session. The director can close it; it stays
  closed until they sign out and back in. Hidden entirely when no one is
  non-compliant.
- **Content:** always-visible name list — show every non-compliant volunteer
  and what each is missing, grouped by department.
- **Scope:** all of the director's departments, grouped by department (not just
  the one currently selected in the switcher).

## Architecture

The all-departments scope means the data cannot come from the per-department
`/schedule` load (which only covers the selected department). It comes from the
`/director` sign-in call, which already returns the full list of departments the
caller oversees. **Approach A** from brainstorming: extend `/director`.

### Data layer

**`src/api/types.ts`**

```ts
export type NonCompliantVolunteer = {
  id: string;
  name: string;
  missing: ("contract" | "training")[]; // non-empty
};

export type DepartmentRef = {
  id: string;
  name: string;
  pendingRequestCount: number;
  nonCompliantVolunteers: NonCompliantVolunteer[]; // [] when all compliant
};
```

**`server/app.ts` — `/director/:netid` handler**

1. Load the Compliance table once (fields `Names`, `Volunteer Contract`,
   `Volunteer Training`) and OR-aggregate per person into a
   `complianceByPersonId` map. This is the *same* aggregation the `/schedule`
   handler already does — extract it into a shared helper
   (e.g. `buildComplianceByPersonId(rows)`) so both call sites stay in sync.
2. Batch-load All People `Name` for every volunteer id across the visible
   departments (one `listAll` with an `OR(RECORD_ID()='…', …)` formula, the same
   pattern already used in `/schedule`).
3. For each visible department, walk its `Volunteers` id list. For each
   volunteer, resolve compliance (default `{ contract:false, training:false }`
   when no row exists). If contract or training is missing, add
   `{ id, name, missing }` to that department's list.

Extract step 3 into a pure function so it is unit-testable without mocking
Airtable:

```ts
function buildNonCompliantByDept(args: {
  depts: { id: string; volunteerIds: string[] }[];
  complianceByPersonId: Map<string, { contract: boolean; training: boolean }>;
  nameById: Map<string, string>;
}): Map<string /* deptId */, NonCompliantVolunteer[]>
```

Attach the result to each entry in the `departments` array of the response.

### UI layer

**New `src/app/components/schedule/ComplianceBanner.tsx`**

- Props: `departments: DepartmentRef[]` and `onDismiss: () => void`.
- Computes the flat total across all departments. Renders nothing when the
  total is 0.
- Always-visible name list:
  - Header with total count, e.g. *"4 volunteers across your departments aren't
    compliant"* (singular/plural handled). When the director oversees a single
    department, drop the "across your departments" phrasing.
  - Body grouped by department: a department sub-heading (shown only when there
    is more than one department with issues), then each non-compliant
    volunteer's name followed by what they're missing
    (`contract` / `training` / `contract + training`).
- A dismiss `×` calls `onDismiss`.
- Styling reuses the red/amber pill vocabulary already used by the inline
  "missing:" badges, so it reads as the same system — just louder. Amber for the
  banner surface; the per-item missing tags match the existing badge color.

**`src/app/components/ScheduleBuilder.tsx`**

- Add `const [complianceDismissed, setComplianceDismissed] = useState(false)`.
- Render `<ComplianceBanner>` as the first child inside the main card, above the
  department-switcher row, when `!complianceDismissed`. It reads from
  `identity.departments` (not `data.roster`), so it is independent of the
  currently selected department and survives department switches.
- Because `ScheduleBuilder` unmounts on sign-out and remounts on the next
  sign-in, the `complianceDismissed` flag naturally resets per session — no
  extra persistence needed.

## What stays untouched

The existing inline per-volunteer "missing:" badges in `PersonRow` and
`GridView` remain. The banner is the at-a-glance, cross-department summary; the
badges are the in-context detail while assigning shifts.

## Testing

- **Unit (server):** `buildNonCompliantByDept` — volunteers missing one item,
  both items, none; a volunteer with no compliance entry (→ missing both); a
  department with an empty volunteer list (→ `[]`); name resolution from the id
  map. Follows the existing pure-helper test pattern in `server/tests/`.
- **Unit (server):** `buildComplianceByPersonId` OR-aggregation across multiple
  rows for the same person (contract on one row, training on another → both
  true), if not already covered.
- **Component (UI):** `ComplianceBanner` renders nothing when all compliant;
  renders count + grouped names when not; single-department phrasing vs.
  multi-department grouping; dismiss invokes the callback.

## Out of scope

- Aggregating compliance for non-director (volunteer/public) views.
- Notifying or emailing volunteers about missing compliance.
- Any change to how compliance is recorded in Airtable.
