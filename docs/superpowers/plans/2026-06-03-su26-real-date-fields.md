# SU 26 Real Airtable Date Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the HAVEN Management date fields (`SU 26 Schedule.Date`, `RHD Clinics.Date`, `Shift Requests.Requester Date`/`Target Date`) from text/single-select strings to real Airtable Date fields, without breaking the portal.

**Architecture:** The server is the only code touching raw Airtable date values; clients already speak ISO via the API. So all changes are server-side: make the date parser accept ISO (so reads tolerate both old `"June 6th"` and new `"2026-06-06"`), make writes emit ISO with `typecast: true` (so one deploy is correct before, during, and after the field-type flip), and replace the one string-date `filterByFormula` with a JS date check. The operator then flips the field types in the Airtable UI.

**Tech Stack:** TypeScript, Hono (server), Vitest, Airtable REST API.

---

## File Structure

- `server/dates.ts` — **Modify.** Extend `parseFlexibleDateString` to accept ISO input. Single source of date tolerance; every read funnels through here.
- `server/tests/dates.test.ts` — **Modify.** Add ISO-tolerance cases.
- `server/airtable.ts` — **Modify.** Add optional `typecast?: boolean` to `createRecord` / `patchRecord`.
- `server/app.ts` — **Modify.** Three date-bearing write sites emit ISO + `typecast`; two `filterByFormula` clauses drop the string-date predicate in favor of a JS check.

No client/UI changes. No new files. No Airtable migration script (the field-type change is a manual UI flip, made safe by tolerant reads + typecast writes).

---

## Task 1: Make the date parser ISO-aware

**Files:**
- Modify: `server/dates.ts` (function `parseFlexibleDateString`, lines 37-49)
- Test: `server/tests/dates.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe("normalizeVolunteerDate", ...)` block in `server/tests/dates.test.ts` (after the `"returns null for unknown input"` test, before the closing `});`):

```ts
  // Real Airtable Date fields return ISO over the API. Reads must accept it
  // so the portal keeps working the instant the field type is flipped.
  it("maps ISO date '2026-06-06' to itself", () => {
    expect(normalizeVolunteerDate("2026-06-06")).toBe("2026-06-06");
  });
  it("maps an ISO datetime to the date part", () => {
    expect(normalizeVolunteerDate("2026-06-06T00:00:00.000Z")).toBe("2026-06-06");
  });
  it("returns null for a non-canonical ISO date (not one of the 18 Saturdays)", () => {
    expect(normalizeVolunteerDate("2026-06-07")).toBeNull();
  });
```

And add this case inside the existing `describe("normalizeDirectorDate", ...)` block (before its closing `});`):

```ts
  it("maps ISO date '2026-05-30' to itself", () => {
    expect(normalizeDirectorDate("2026-05-30")).toBe("2026-05-30");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- dates`
Expected: FAIL — the new ISO cases return `null` (e.g. `expected null to be "2026-06-06"`), because the current parser only matches `"month day"`.

- [ ] **Step 3: Implement the ISO branch in the parser**

In `server/dates.ts`, replace the body of `parseFlexibleDateString` (currently lines 37-49):

```ts
function parseFlexibleDateString(input: string): string | null {
  // Lookbehind: only strip the ordinal when it actually follows a digit.
  // Without it, the "st" at the end of "august" gets stripped too, turning
  // "august 1st" into "augu 1" and breaking every August date.
  const cleaned = input.trim().toLowerCase().replace(/(?<=\d)(st|nd|rd|th)\b/g, "");
  const match = cleaned.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (!match) return null;
  const month = MONTHS[match[1]];
  const day = parseInt(match[2], 10);
  if (month === undefined || Number.isNaN(day)) return null;
  const iso = `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return (CANONICAL_DATES as readonly string[]).includes(iso) ? iso : null;
}
```

with:

```ts
function parseFlexibleDateString(input: string): string | null {
  const trimmed = input.trim();

  // Real Airtable Date fields return ISO 8601 — "2026-06-06" for a date-only
  // field, or "2026-06-06T00:00:00.000Z" if the field carries a time. Take the
  // leading YYYY-MM-DD and validate against the canonical Saturdays. A wrong or
  // off-day value fails the canonical check rather than corrupting a shift.
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const iso = isoMatch[1];
    return (CANONICAL_DATES as readonly string[]).includes(iso) ? iso : null;
  }

  // Legacy display strings: "June 6th" / "June 6" (single-select / text fields).
  // Lookbehind: only strip the ordinal when it actually follows a digit.
  // Without it, the "st" at the end of "august" gets stripped too, turning
  // "august 1st" into "augu 1" and breaking every August date.
  const cleaned = trimmed.toLowerCase().replace(/(?<=\d)(st|nd|rd|th)\b/g, "");
  const match = cleaned.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (!match) return null;
  const month = MONTHS[match[1]];
  const day = parseInt(match[2], 10);
  if (month === undefined || Number.isNaN(day)) return null;
  const iso = `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return (CANONICAL_DATES as readonly string[]).includes(iso) ? iso : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- dates`
Expected: PASS — all cases in `dates.test.ts` green, including the legacy `"June 6th"` and August regression cases.

- [ ] **Step 5: Commit**

```bash
git add server/dates.ts server/tests/dates.test.ts
git commit -m "feat(dates): accept ISO input so reads tolerate real Date fields"
```

---

## Task 2: Add optional `typecast` to the Airtable write helpers

**Files:**
- Modify: `server/airtable.ts` (`createRecord` lines 58-71, `patchRecord` lines 73-87)

These are thin HTTP wrappers with no existing test harness (no fetch mock in the repo), so there is no unit test for this task — it's verified by the type checker in Step 3 and by the consuming code in Task 3. Do not invent a fetch-mock harness for this.

- [ ] **Step 1: Add `typecast` to `createRecord`**

In `server/airtable.ts`, replace `createRecord` (lines 58-71):

```ts
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
```

with:

```ts
export async function createRecord<F = Record<string, unknown>>(opts: {
  baseId: string;
  tableId: string;
  fields: Record<string, unknown>;
  // When true, Airtable coerces string values to the field's type. Used on
  // date writes so an ISO string is accepted by a single-select during the
  // window before the field is converted to a real Date field.
  typecast?: boolean;
}): Promise<AirtableRecord<F>> {
  const url = `${BASE}/${opts.baseId}/${encodeURIComponent(opts.tableId)}`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields: opts.fields, ...(opts.typecast ? { typecast: true } : {}) }),
  });
  if (!res.ok) throw new Error(`Airtable create failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AirtableRecord<F>;
}
```

- [ ] **Step 2: Add `typecast` to `patchRecord`**

In `server/airtable.ts`, replace `patchRecord` (lines 73-87):

```ts
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
```

with:

```ts
export async function patchRecord<F = Record<string, unknown>>(opts: {
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
  // See createRecord — true lets ISO date strings write into a still-select field.
  typecast?: boolean;
}): Promise<AirtableRecord<F>> {
  const url = `${BASE}/${opts.baseId}/${encodeURIComponent(opts.tableId)}/${opts.recordId}`;
  const res = await fetchWithRetry(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields: opts.fields, ...(opts.typecast ? { typecast: true } : {}) }),
  });
  if (!res.ok) throw new Error(`Airtable patch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as AirtableRecord<F>;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors (the new optional field is backward compatible with all existing callers).

- [ ] **Step 4: Commit**

```bash
git add server/airtable.ts
git commit -m "feat(airtable): optional typecast flag on create/patch helpers"
```

---

## Task 3: Write ISO into the three date fields (with typecast)

**Files:**
- Modify: `server/app.ts` — `/rhd/clinic` upsert (~line 999), `/assignment` upsert (~lines 1079, 1096-1108), `/requests` create (~lines 1718, 1723, 1727)

No unit test: these route handlers have no fetch-mock harness in the repo (the existing route tests cover the pure functions in `requests.ts` / `public.ts`, which already take ISO). Verified by typecheck + the full suite staying green in Step 4, then by the manual smoke test in Task 5.

- [ ] **Step 1: `/rhd/clinic` — write ISO Date + typecast**

In `server/app.ts`, find (currently line 999):

```ts
  const fields: Record<string, unknown> = { Date: displayDate(date) };
```

Replace with:

```ts
  const fields: Record<string, unknown> = { Date: date };
```

Then find the write block immediately below (currently lines 1004-1008):

```ts
  if (existing) {
    await patchRecord({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId, recordId: existing.id, fields });
  } else {
    await createRecord({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId, fields });
  }
```

Replace with:

```ts
  if (existing) {
    await patchRecord({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId, recordId: existing.id, fields, typecast: true });
  } else {
    await createRecord({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId, fields, typecast: true });
  }
```

- [ ] **Step 2: `/assignment` — write ISO Date (keep display Name) + typecast**

In `server/app.ts`, find (currently line 1079, inside the `fields` object):

```ts
    Date: dateName,
```

Replace with:

```ts
    Date: date,
```

Leave the `Name: \`${deptName} — ${dateName}\`` line untouched — the row title stays human-readable, and `const dateName = displayDate(date)` above it is still used for it.

Then find the write block (currently lines 1096-1109):

```ts
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
```

Replace with:

```ts
  if (existing) {
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      recordId: existing.id,
      fields,
      typecast: true,
    });
  } else {
    await createRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      fields,
      typecast: true,
    });
  }
```

- [ ] **Step 3: `/requests` — write ISO Requester/Target Date + typecast**

In `server/app.ts`, find (currently lines 1714-1724):

```ts
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
```

Replace with:

```ts
  const fields: Record<string, unknown> = {
    Department: [dept.id],
    Requester: [person.id],
    "Requester Email": callerEmail,
    "Requester Date": requesterDate,
    Status: "Pending",
  };
  if (targetPersonId && targetDate) {
    fields.Target = [targetPersonId];
    fields["Target Date"] = targetDate;
  }
```

Then find the create call (currently lines 1727-1731):

```ts
  const created = await createRecord<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    fields,
  });
```

Replace with:

```ts
  const created = await createRecord<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    fields,
    typecast: true,
  });
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — no type errors; all existing tests stay green (these handlers aren't unit-tested, so nothing should newly fail — this confirms no collateral breakage and that `displayDate`/`escapeFormulaString` are still used elsewhere so no unused-import errors).

- [ ] **Step 5: Commit**

```bash
git add server/app.ts
git commit -m "feat(rhd): write ISO into Date/Requester Date/Target Date (typecast)"
```

---

## Task 4: Replace the string-date `filterByFormula` with a JS date check

**Files:**
- Modify: `server/app.ts` — `/requests` duplicate pre-check (~lines 1701-1712) and post-create race check (~lines 1737-1744)

`requesterDate` is the ISO Saturday key from the request body (declared at line 1630), so the JS check compares parsed ISO to ISO. No unit test (same handler, no fetch-mock harness); verified by typecheck + suite in Step 3 and the swap/drop smoke test in Task 5.

- [ ] **Step 1: Fix the duplicate pre-check**

In `server/app.ts`, find (currently lines 1701-1712):

```ts
  // Check for duplicate pending request on (person, requesterDate).
  // FIND(personId, ARRAYJOIN(linkedField)) can't match — linked fields
  // stringify to names in formulas — so filter by Requester ID in JS.
  const sameDateRequests = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `AND({Status} = 'Pending', {Requester Date} = '${escapeFormulaString(displayDate(requesterDate))}')`,
  });
  const duplicates = sameDateRequests.filter((r) =>
    toIdList(r.fields.Requester).includes(person.id),
  );
```

Replace with:

```ts
  // Check for a duplicate pending request on (person, requesterDate). We pull
  // all pending rows and match BOTH the linked Requester id and the date in JS:
  // linked fields stringify to names in formulas (so FIND can't match), and
  // Requester Date is a real Date field, so a string-equality formula won't
  // match either. The pending set for one season is tiny.
  const sameDateRequests = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `{Status} = 'Pending'`,
  });
  const duplicates = sameDateRequests.filter(
    (r) =>
      toIdList(r.fields.Requester).includes(person.id) &&
      normalizeVolunteerDate(selectName(r.fields["Requester Date"])) === requesterDate,
  );
```

- [ ] **Step 2: Fix the post-create race check**

In `server/app.ts`, find (currently lines 1737-1744):

```ts
  const afterCreate = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `AND({Status} = 'Pending', {Requester Date} = '${escapeFormulaString(displayDate(requesterDate))}')`,
  });
  const competing = afterCreate.filter(
    (r) => r.id !== created.id && toIdList(r.fields.Requester).includes(person.id),
  );
```

Replace with:

```ts
  const afterCreate = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `{Status} = 'Pending'`,
  });
  const competing = afterCreate.filter(
    (r) =>
      r.id !== created.id &&
      toIdList(r.fields.Requester).includes(person.id) &&
      normalizeVolunteerDate(selectName(r.fields["Requester Date"])) === requesterDate,
  );
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — no type errors, all tests green. (`escapeFormulaString` is still imported and used at other call sites such as the `{Department}` and `{NetID}` filters, so its import stays valid.)

- [ ] **Step 4: Commit**

```bash
git add server/app.ts
git commit -m "fix(requests): match Requester Date in JS, drop string-date formula"
```

---

## Task 5: Final verification + Airtable flip runbook

**Files:** none (verification + operator steps).

- [ ] **Step 1: Run the full suite and typecheck one last time**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — typecheck clean, all Vitest suites green.

- [ ] **Step 2: Manual smoke test against current (pre-flip) Airtable**

With the code deployed but the Airtable fields STILL single-select/text, verify nothing regressed (reads tolerant, writes use typecast):
- Load the public schedule portal — dates render (`May 30th` … `September 26th`).
- Load the management grid for a department — assignments load.
- Save an assignment (add/remove a volunteer) — succeeds. In Airtable, the `Date` cell now holds the ISO value (and the single-select may show a transient `2026-…` option — expected, absorbed at flip).
- Submit a drop/swap request from the public view, then confirm it appears in Pending Requests — succeeds (duplicate-detection JS path).

- [ ] **Step 3: Flip the field types in the Airtable UI (operator)**

In the HAVEN Management base, change each field type to **Date** with format **date-only (no time)**:
- `SU 26 Schedule.Date` (single-select → Date)
- `RHD Clinics.Date` (single-line text → Date)
- `Shift Requests.Requester Date` (single-select → Date)
- `Shift Requests.Target Date` (single-select → Date)

- [ ] **Step 4: Post-flip spot-check**

- Confirm Airtable mapped the existing values to the correct 2026 dates (spot-check a few rows per table, including an August row — the ordinal-suffix edge case).
- Confirm any transient `2026-…` select options were absorbed into real dates.
- Re-run the Step 2 smoke checks against the now-Date fields: portal renders, grid loads, an assignment save and a shift request both still succeed.

- [ ] **Step 5: Final commit (if any doc/notes changed)**

If you added operator notes, commit them; otherwise this task produces no code change. The feature is complete once Steps 1-4 pass.

---

## Notes

- **Out of scope (unchanged):** `All People` availability fields (`SU 26 — Available as Director` / `… as Volunteer` / `SU 26 — Volunteer-Updated Availability`) store comma-separated *lists* of display dates — a single Date field can't hold a list, so they stay text and keep using `displayDate` on write. The tolerant parser still reads their `"June 6th"` tokens. The schedule row `Name` column also stays text.
- **Why typecast can stay after the flip:** it's a no-op for ISO strings written to a real Date field, so there's no follow-up deploy to remove it.
