# SU 26 Schedule — Real Airtable Date Fields — Design

**Date:** 2026-06-03
**Status:** Design — pending user review
**Owner:** Jack C

## Problem

In the HAVEN Management base, clinic dates are stored as **text/select strings**,
not real dates:

- `SU 26 Schedule.Date` — **single-select** (`fldRqPKWn6NxzoJXZ`), values like `"June 6th"`.
- `RHD Clinics.Date` — **single-line text**, same `"June 6th"` convention.
- `Shift Requests.Requester Date` / `Target Date` — **single-selects**, same convention.

Because they aren't real dates, Airtable can't sort or filter them chronologically,
and the values are constrained to hand-maintained option lists. The goal is to make
these **actual Airtable Date fields** — and to do it without breaking the portal
("website portal scheduler"), which reads this data.

## Key insight

The server is the **only** code that touches the raw Airtable date values. Every
client (the public schedule view, management grid, My Assignments, shift-request UI)
only ever sees ISO (`2026-06-06`) + a display string from the API — none of them read
Airtable directly. So the entire change lives in the server's Airtable adapter layer:
**read any format, write ISO.** A real Airtable Date field returns ISO over the REST
API, which is *closer* to our internal canonical form than `"June 6th"` is, so reads
actually get simpler and the clients need zero changes.

## Decisions (from brainstorming)

- **Scope:** all three single-value date fields — `SU 26 Schedule.Date`,
  `RHD Clinics.Date`, and `Shift Requests.Requester Date` + `Target Date`.
- **Migration style:** tolerant code first, then flip the field type in the Airtable UI.
- **Write safety:** single deploy using `typecast: true` on the date writes (not a
  staged two-deploy), so one deploy is correct before, during, and after the flip.
- **Downstream consumer:** this app's own portal only — no external site reads the
  Schedule table directly.

## Current data flow

- **Read:** `normalizeVolunteerDate(selectName(row.fields.Date))` — flexible string
  parse `"June 6th"` → ISO `"2026-06-06"`. Every date read in `server/app.ts` funnels
  through `normalizeVolunteerDate` / `normalizeDirectorDate` in `server/dates.ts`.
- **Write:** `Date: displayDate(date)` — ISO → `"June 6th"`.
- **API → clients:** the API emits `{ iso, display }`; clients format with their own
  `displayDate`. Clients are insulated from the Airtable field type.

## Architecture

### 1. `server/dates.ts` — make the parser ISO-aware

Extend the parser behind `normalizeVolunteerDate` / `normalizeDirectorDate` to accept,
in addition to `"June 6th"`:

- `"2026-06-06"` — what a date-only Date field returns over the API.
- `"2026-06-06T00:00:00.000Z"` — defensive, in case the field ever carries a time.

Implementation: before the existing month-name branch, detect a leading
`^(\d{4}-\d{2}-\d{2})` and use that captured `YYYY-MM-DD`. Continue to validate the
result against `CANONICAL_DATES` (the 18 Saturdays) and return `null` on any
non-canonical or unparseable input — so a malformed/wrong date **fails safe** rather
than silently storing a bad day.

This one change makes **every** read site tolerant at once, before the field type ever
flips. The existing `"June 6th"` cases keep working unchanged — which also means the
comma-separated `All People` availability lists (out of scope, see below) keep parsing.

### 2. `server/app.ts` — writes emit ISO

Flip these write sites from `displayDate(date)` to the raw ISO `date`:

- `/assignment` schedule upsert — `Date` field (currently line 1079).
- `/rhd/clinic` upsert — `Date` field (currently line 999).
- shift-request create — `Requester Date` (1718) and `Target Date` (1723).

The human-readable `Name` column on the schedule row **keeps** `displayDate`
(`"SCTS — June 6th"`) so row titles stay readable in Airtable.

### 3. `server/app.ts` — drop the string-date `filterByFormula`

Two clauses filter Shift Requests by `{Requester Date} = '<displayDate>'` (currently
lines 1707 and 1740) — the only spot coupled to the field's *string* value. The code
already re-filters those results by Requester ID in JS immediately after. Change the
formula to just `{Status} = 'Pending'` and add an ISO date-equality check (via the
now-tolerant parser) to that existing JS filter. This is format-agnostic — correct
before, during, and after the flip — and the result set (a season of pending requests)
is tiny, so there is no meaningful perf cost.

### 4. `server/airtable.ts` — optional `typecast` flag

Add an optional `typecast?: boolean` to `createRecord` / `patchRecord`; when set, send
`{ fields, typecast: true }`. Set it on the date-bearing writes only.

- Against a **real Date field**: ISO is accepted natively; `typecast` is harmless.
- Against the **still-single-select** field (pre-flip window): `typecast` lets Airtable
  accept the ISO string, transiently adding a `"2026-06-06"` option that disappears when
  the column is converted to Date.

Linked-record and number fields in the same writes are unaffected — record-ID arrays
still resolve under typecast (matched by id), numbers pass through.

## Migration runbook (zero-downtime)

1. Ship the code (tolerant reads + ISO writes + `typecast` + JS date filter). Correct
   while the fields are still select/text.
2. In Airtable, flip field type → **Date, date-only (no time)** for: `SU 26 Schedule.Date`,
   `RHD Clinics.Date`, `Shift Requests.Requester Date`, `Shift Requests.Target Date`.
   Reads already handle ISO, so the app is correct the instant each flip lands.
3. Spot-check that Airtable's conversion mapped the 18 existing option values to the
   correct 2026 dates, and that any transient `"2026-06-06"` select options were absorbed.

Date-only (no time) keeps the API output a clean `YYYY-MM-DD`; the parser defensively
slices `YYYY-MM-DD` from any datetime anyway.

## Testing

- `server/tests/dates.test.ts`: add `"2026-06-06"` and `"2026-06-06T00:00:00.000Z"` →
  `2026-06-06`; a non-canonical ISO (e.g. `"2026-06-07"`) → `null`; existing `"June 6th"`
  cases stay green.
- Route tests (`requests.validate.test.ts`, `requests.apply.test.ts`, `public.test.ts`,
  `rhd.test.ts`): add ISO-format fixtures for `Date` / `Requester Date`, and assert reads
  plus the shift-request duplicate-detection (now a JS filter) still behave.
- `npm test` must pass.
- Manual smoke (`docs/smoke-test-checklist.md`) after the flip: public portal renders
  dates, management grid loads, create an assignment, submit a swap/drop request.

## Out of scope

- `All People` availability fields (`SU 26 — Available as Director` / `… as Volunteer` /
  `SU 26 — Volunteer-Updated Availability`): comma-separated **lists** of display dates.
  A single Date field can't hold a list, so these stay as text and keep using
  `displayDate` on write. The tolerant parser still reads their `"June 6th"` tokens.
- The schedule row `Name` column stays text (`"SCTS — June 6th"`).
- No client/UI changes — clients already speak ISO via the API.
- No new Airtable fields and no migration script — the field-type flip is done in the
  Airtable UI; tolerant reads + `typecast` writes make it safe without backfill.

## Risks

- **Conversion fidelity:** Airtable's single-select→Date conversion must parse the 18
  existing `"… th"` option strings to the right 2026 dates. Mitigated by the date-only
  config and the post-flip spot-check; a misconverted value fails the `CANONICAL_DATES`
  guard rather than corrupting a shift silently.
- **Transient select-option pollution:** a write landing before the flip adds a
  `"2026-06-06"` option; cosmetic only, absorbed at conversion.
- **Typecast breadth:** `typecast: true` applies to the whole write; scoped to the
  date-bearing writes whose other fields are ID arrays / numbers, so coercion is a no-op
  for them.
