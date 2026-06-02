# PCAR Med Team Scheduler Enrichment + One-Time Workbook Migration

**Date:** 2026-06-02
**Status:** Design — pending user review
**Owner:** Jack C

## 1. Background & motivation

The PCAR directors run HAVEN's Medical Team through an Excel workbook
(`Med Team Schedule Summer 2026.xlsx`) that goes well beyond what the clinic
schedule portal models today. They want two things: **custom abilities** that
match how they actually staff clinic, and the **ability to import their
workbook** so they don't rebuild the schedule by hand.

The workbook contains five distinct subsystems:

1. **SCTM / JCTM shift grids** — roster × Saturday grids where each cell carries
   a *clinical role code*, not just present/absent.
2. **Per-clinic-day capacity dashboard** — staffing quotas and patient-capacity
   math computed off the grid.
3. **LCC longitudinal patient panels** — each LC-SCTM owns a panel of patients
   by MRN.
4. **Per-slot patient day-scheduling** — patient (MRN) bookings into time slots.
5. **Patient reschedule / outreach tracker** — a call-tracking workflow.

Subsystems 3–5 are patient-centric and carry **PHI** (patient names, medical
record numbers, visit reasons, clinical notes). This is a different
data-sensitivity tier than the current portal (which holds only Yale
netids/names/availability/compliance) and is a HIPAA/data-governance decision,
not just an engineering one.

**This spec covers only the PHI-free work:** subsystems 1 and 2, plus a one-time
migration that reads only the SCTM/JCTM tabs. The LCC subsystems (3–5) are
explicitly out of scope and deferred to a separate track with its own
governance review.

## 2. Goals

- Add **clinical roles** to the schedule: Triage and Walk-in (SCTP), CC (JCTP),
  layered on top of being on shift. Shadow already exists; "Clinic" = on shift
  with no role flag.
- Add a **per-day capacity / quota dashboard** for the two PCAR departments:
  assigned-vs-ideal, Triage/Walk-in coverage, shadow count, Spanish-speaking
  coverage, max patient capacity, and an optional manual "patients booked"
  count.
- Surface **per-person goal & coverage** in the roster: assigned-vs-goal (reuse
  existing `minShiftsWanted`), role tallies, and Returning / Spanish-speaking
  badges.
- Provide a **one-time migration script** that seeds the SCTP and JCTP rosters
  and assignment grids (with roles) from the workbook, then the directors work
  entirely in the platform (Excel is retired).

## 3. Non-goals

- **No patient data of any kind.** No MRNs, patient names, visit reasons, or
  clinical notes enter the platform. The migration script reads only the
  `SCTM` and `JCTM` tabs and ignores `LCC Program >>`, `LC-SCTM Schedules`,
  `Patient Assignments`, `Clinic Day Scheduling`, and `TEMP Spring 26 Resched`.
- No longitudinal patient panels, per-slot booking, or reschedule/outreach
  workflow (deferred Track C).
- No self-serve in-app `.xlsx` upload. Import is a one-time script; the platform
  becomes the system of record afterward.
- No hard schema enforcement of the "exactly 1 Triage / 1 Walk-in" rule — it is
  surfaced as a dashboard warning, matching how the workbook treats it.

## 4. Key decisions (resolved with user)

| Decision | Choice |
| --- | --- |
| First scope | Everything **except** PHI-bearing features |
| Capacity patient metrics | Staffing/quota + max capacity + **optional manual per-day "patients booked"** count (aggregate only, no identifiers) |
| Department mapping | **SCTM = SCTP, JCTM = JCTP** — enrich the two existing PCAR departments |
| Import model | **One-time migration** script; Excel retired afterward |
| Role model | **Option C — parallel role-flag lists** layered on `Volunteers on Shift` |
| Shift goal | **Reuse `minShiftsWanted`** ("Minimum Shifts Wanted", 4–9+) |
| Migration availability | **Don't touch** — migrate roster + assignments + roles only |
| Returning / Spanish badges | **Include both** in v1 |

## 5. Domain reference — workbook cell codes

**SCTM tab** (→ SCTP):
- `C` = Clinic → `Volunteers on Shift`
- `C+T` = Clinic + Triage SCTM → `Volunteers on Shift` + `Triage on Shift`
- `W` = Walk-in SCTM → `Volunteers on Shift` + `Walk-in on Shift`
- `S` = Shadow shift → `Shadow Volunteers on Shift` (existing)
- `A` = Available (offered, not slotted) → no import action. It is neither an
  assignment nor an availability write (availability is not modified; see §11).

**JCTM tab** (→ JCTP):
- `C` = Clinic → `Volunteers on Shift`
- `CC` = CC JCTM → `Volunteers on Shift` + `CC on Shift`
- `A` = Available → no import action (see §11)

Per-person workbook columns mapped: `Name`, `Candidate Email Address` (matching
key), `Returning Volunteer` → Returning badge, `Spanish speaking?` → Spanish
badge, `Shift Number Requested` (ignored — goal reuses `minShiftsWanted`).

**Dates already align:** `CANONICAL_DATES` in `server/dates.ts` is exactly the
workbook's date columns (2026-05-30 → 2026-09-26). The platform includes
2026-07-04, which the workbook skips; that date simply imports empty.

## 6. Data model changes

### 6.1 SU 26 Schedule table (per Department + Date row)
New optional link/number fields, added exactly like `Shadow Volunteers on Shift`
and `Remote on Shift` were — written only when present, ignored by departments
that don't use them:
- `Triage on Shift` (multipleRecordLinks → All People; subset of Volunteers on Shift) — SCTP
- `Walk-in on Shift` (multipleRecordLinks → All People; subset of Volunteers on Shift) — SCTP
- `CC on Shift` (multipleRecordLinks → All People; subset of Volunteers on Shift) — JCTP
- `Patients Booked` (number, optional) — manual, PHI-free per-Saturday count

Role lists are multi-link (not single) so an occasional 2-of-a-role day doesn't
break; the "should be 1" rule lives in the dashboard.

### 6.2 SU 26 Roster table (per department row)
Per-department dashboard config:
- `Ideal Headcount` (number) — SCTP default 11; set per dept
- `Patient Capacity Per Provider` (number) — SCTP default 3 (→ "max pts = 3 ×
  #on-shift"); left blank for JCTP (no patient-capacity math)

### 6.3 All People table (person attributes)
- `Spanish Speaking` (checkbox)
- `Returning Volunteer` (checkbox)

(Person-level, not term/department-specific. Populated by the migration; editable
by directors.)

### 6.4 TypeScript types (`src/api/types.ts`)
- `Assignment`: add `triageIds: string[]`, `walkinIds: string[]`,
  `ccIds: string[]`, `patientsBooked: number | null`.
- `Person`: add `spanishSpeaking?: boolean`, `returning?: boolean`.
- `ScheduleResponse.department`: add `idealHeadcount: number | null`,
  `patientCapacityPerProvider: number | null`.

## 7. API changes (`server/app.ts`)

- **`POST /schedule/:deptId` (read):** populate the new role arrays +
  `patientsBooked` per date and the dept config, mirroring the existing
  `shadowIds`/`remoteIds` read path (`toIdList(row.fields[...])`). Add
  `spanishSpeaking`/`returning` to `buildPerson`.
- **`POST /assignment` (write):** accept `triageIds` / `walkinIds` / `ccIds` /
  `patientsBooked`; write each only when the client sends it (same conditional
  pattern as `shadowIds`/`remoteIds`). **Invariant:** server coerces any role-list
  member to also appear in `Volunteers on Shift` (a role implies on-shift).
- **`POST /remove-volunteer`:** also strip the person from `Triage on Shift`,
  `Walk-in on Shift`, and `CC on Shift` (extend the existing affected-row sweep).
- **`POST /me/assignments`:** optionally annotate a volunteer's own role for the
  date (nice-to-have; can be a follow-up).

No new endpoints. No auth/permission changes — PCAR already manages SCTP/JCTP via
`MANAGES_OTHER_DEPTS`.

## 8. Capacity / quota dashboard (`StatsBar`)

Per Saturday, all computed live from the grid — **no PHI**:
- **Headcount:** #on-shift vs `Ideal Headcount` (under / at / over).
- **Triage coverage:** `triageIds.length` vs 1 → warn on 0 or >1.
- **Walk-in coverage:** `walkinIds.length` vs 1 → warn on 0 or >1.
- **Shadow count:** `shadowIds.length`.
- **Spanish coverage:** count of on-shift people with `spanishSpeaking`.
- **Max patient capacity** (SCTP only): `patientCapacityPerProvider` × #on-shift.
- **Patients booked / to reschedule** (only if a director enters `Patients
  Booked`): booked vs capacity, and `to reschedule = booked − capacity`.
- Static reminder: "≥3 shifts required to volunteer."

Targets/config come from the dept roster row (§6.2). `Patients Booked` is an
input in the dashboard per day.

## 9. Roster / per-person UI (`PersonRow`)

- **Goal vs assigned:** reuse `minShiftsWanted` as the goal; show
  `assigned / goal` with an over/under hint (extends the existing "X / N"
  shift-target pill).
- **Role tallies:** "Triage ×N / Walk-in ×N" (SCTP) or "CC ×N" (JCTP), computed
  from role lists across the term — not stored.
- **Badges:** Returning, Spanish-speaking.

## 10. Grid UI (`SaturdayView` / `GridView`)

- A per-person role control on each assigned volunteer, reusing the
  **remote-toggle pattern** recently added (commit `a657cea`): select
  Clinic → Triage → Walk-in for SCTP; Clinic ↔ CC for JCTP. Shadow and Remote
  remain their existing controls.
- A small role badge rendered in the grid cell (Triage / Walk-in / CC), abbreviated
  like the compliance pill (commit `7227fdf`) to avoid crowding the name.

## 11. One-time migration script (`scripts/import-medteam.ts`, run via `tsx`)

- **Parsing:** add `xlsx` (SheetJS) as a **devDependency** (script-only, not
  shipped). Read the `SCTM` and `JCTM` sheets only.
- **Person matching:** match each roster row to All People by **Contact Email**
  (lowercased). Print every unmatched person; **never guess** a match.
- **Roster:** add matched people to the SCTP / JCTP `Volunteers` list.
- **Assignments:** write one SU 26 Schedule row per (dept, date) from the cell
  codes per §5. `A` cells contribute nothing (availability is not touched —
  see below).
- **Availability:** **not modified.** Availability keeps flowing from
  applications / self-updates. *Known consequence:* a person assigned on a date
  their application availability doesn't list will render as assigned-but-not-
  available in the grid. Accepted; directors can adjust via the existing
  availability override if needed.
- **Attributes:** set `Returning Volunteer` / `Spanish Speaking` on All People
  from the workbook columns.
- **Safety:** `--dry-run` is the **default** — prints planned writes + the
  unmatched-people report; `--apply` commits. Idempotent: upserts schedule rows
  per (dept, date) like `POST /assignment` already does, so re-running is safe.

## 12. Testing (`server/tests/*`, vitest)

- Cell-code → role-list mapping (C / C+T / W / S / CC / A), including the
  on-shift implication for role members.
- Email matching: exact, case-insensitive, and unmatched reporting.
- Dashboard metric computation: headcount under/at/over, Triage/Walk-in
  under/over warnings, capacity = multiplier × headcount, to-reschedule math.

## 13. Risks & open points

- **Availability mismatch** (per §11) is a cosmetic inconsistency, accepted by
  the user.
- **Spanish-speaking data** was blank in the sampled workbook; the badge/coverage
  count will simply read empty until directors populate it.
- **JCTP targets:** `Ideal Headcount` for JCTP was not evident in the workbook;
  needs to be set by the directors (SCTP = 11 is known).
- **Airtable field creation** is a manual step in the base (or via API) before
  the migration runs — the schema fields in §6 must exist first.

## 14. Suggested build sequence

1. Airtable schema fields (§6.1–6.3) + TS types (§6.4).
2. API read/write for roles + `patientsBooked` + dept config (§7).
3. Grid role controls + badges (§10).
4. Capacity dashboard (§8) and roster goal/tallies/badges (§9).
5. Migration script with dry-run (§11).
6. Tests throughout (§12).
