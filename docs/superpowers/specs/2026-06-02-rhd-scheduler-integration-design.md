# RHD Scheduler Integration (SCTS / JCTS / CCRH) + Clinic-Readiness + Workbook Migration

**Date:** 2026-06-02
**Status:** Design — pending user review
**Owner:** Jack C

## 1. Background & motivation

The SRHD (Reproductive Health & Doula) directors run RHD clinic the same way the
PCAR Med Team directors did before their integration: out of Excel. They keep two
connected workbooks:

1. **`HAVEN RHD Schedule.xlsx`** — the assignment engine. Its active `Summer 2026`
   tab is a roster × Saturday grid (same cadence as the Med Team grid) with an
   **Attending** row and **Director** row per clinic, four auto-computed coverage
   rows (# SCTMs / # JCTMs / # RNs / # Spanish speakers), a derived per-clinic
   **email list**, and people grouped into **SCTMs / JCTMs / CCs** sections with
   per-person attributes and `1`-cell assignments. Separate tabs track CLIA / RHD /
   Pharm training status.
2. **`HAVEN Clinic Prep Summer 2026.xlsx`** — a *derived* operational layer. Its
   engine is the **`ATTENDING QUALS`** tab (each attending × which procedures they
   will perform) plus **`SETTINGS`** (max procedures per clinic). The per-clinic
   prep tab cross-references the day's scheduled attending and RN coverage to tell
   directors which procedures are allowed and what to prepare (e.g. depo-provera
   injections require an RN present).

Today the directors maintain these spreadsheets *and* Airtable by hand — the same
double-entry the PCAR work eliminated. This spec replicates the PCAR integration
for the three RHD departments **and** ports the clinic-prep decision logic into the
portal so both spreadsheets can be retired in a single cutover.

## 2. Goals

- **Assignment grid** for the three RHD departments, reusing the PCAR machinery:
  SCTMs → **SCTS**, JCTMs → **JCTS**, CCs → **CCRH**. Click-to-assign, shadows,
  per-person badges.
- **Person attributes:** add **Licensed RN**; reuse Returning, Spanish (auto-synced
  from application proficiency), and Desired shifts (`minShiftsWanted`).
- **Per-clinic facts** set in the portal: the scheduled **Attending** (chosen from a
  small reference table of attendings) and an optional **Director on point**.
- **Clinic-readiness panel** (eligibility & coverage summary) per Saturday, computed
  live with **no patient data**:
  - the scheduled attending's **allowed procedures** (IUD In / IUD Out / Nexplanon /
    GAC / EMB) and **sees-male** flag, green/red/grey;
  - a **depo / injections** flag derived from RN coverage ("OK" vs "reschedule — no
    RN");
  - **coverage counts** (# SCTMs / JCTMs / RNs / Spanish speakers);
  - a manual **Procedures Booked** count with a warning past the configured max (3);
  - a copyable **email list** of assigned volunteers for the clinic.
- **One-time migration** that seeds the three rosters + assignment grid from the
  `Summer 2026` tab and seeds the attendings reference table from `ATTENDING QUALS`,
  after which the directors work entirely in the platform.

## 3. Non-goals

- **No patient data of any kind.** Readiness is driven purely by staffing and the
  attending's qualifications. Any "procedures booked" figure is a manual aggregate
  count (no identifiers), exactly like PCAR's `Patients Booked`. The migration reads
  only the `Summer 2026` and `ATTENDING QUALS` tabs and never touches the
  `LCC RHD SCTMs` tab or any per-patient prep tab.
- **No supply checklist / sign-out** porting in this cutover (user chose the
  "Eligibility & coverage summary" depth). The per-clinic supply list and sign-out
  section stay out of the portal for now.
- **No in-app `.xlsx` upload.** Import is a one-time script; the platform becomes the
  system of record afterward.
- **No training-compliance wiring in v1.** CLIA / RHD / Pharm tracking slots into the
  already-merged compliance subsystem as a **fast-follow**, not part of this spec
  (see §13).
- No in-portal editor for the attendings qualification matrix in v1 — it is
  maintained in Airtable and read by the portal (revisit later).

## 4. Key decisions (resolved with user)

| Decision | Choice |
| --- | --- |
| End state | **Everything at once** — assignment grid + clinic-readiness panel; retire both spreadsheets in a single cutover |
| Readiness depth | **Eligibility & coverage summary** (no supply checklist / sign-out) |
| Department mapping | **SCTM = SCTS, JCTM = JCTS, CC = CCRH** (the three depts PCAR-style `MANAGES_OTHER_DEPTS` already grants SRHD) |
| RN model | **Person attribute** `Licensed RN`; "# RNs" and the depo flag are derived, not a separate role-flag list |
| Attending model | A small **RHD Attendings** reference table holding the quals matrix; per-clinic attending is a **link** chosen in the portal |
| Clinic-level facts | A dedicated **RHD Clinics** table keyed by date (Attending, Director, Procedures Booked) — *not* triplicated onto the three schedule rows |
| Procedure cap | **3** (from workbook `SETTINGS`), surfaced as a warning, configurable |
| Shift goal / Spanish / Returning | Reuse existing `minShiftsWanted`, live Spanish sync, and `Returning Volunteer` |
| Import model | **One-time migration** script (mirrors `import-medteam.ts`); Excel retired afterward |
| Training compliance | **Fast-follow**, out of scope for this cutover |

## 5. Domain reference — workbook structure

### 5.1 `HAVEN RHD Schedule.xlsx` → `Summer 2026`
Column layout (date columns begin at the first dated header, Saturdays
2026-05-30 → August, matching `CANONICAL_DATES`):

- **Row "Clinic Date"** — date headers.
- **Row "Attending"** — attending short name per date (e.g. `Achong`, `Ami`,
  `Rivera`, `CLOSED`). → seeds `RHD Clinics.Attending`.
- **Row "Director"** — student-director initials per date (e.g. `JJ`, `KS`). →
  seeds `RHD Clinics.Director on point` (stored as-is, text).
- **Rows "# SCTMs / # JCTMs / # RNs / # Spanish Speakers Scheduled"** — computed in
  the sheet; the portal **derives** these, so they are read for reconciliation only,
  never written.
- **Row "Email List for Clinic"** — derived; the portal regenerates it.
- **Header row** for the roster: `Name`, `Status` (Return/New → Returning), `Yale
  Email` (matching key), `NetID`, `Phone #`, `Program`, `Licensed RN` (Yes/No),
  `Spanish Proficiency`, `Desired Shifts` (→ goal, reuse `minShiftsWanted`),
  `Total Shifts` (derived), `EPIC Access?`.
- **Section headers `SCTMs` / `JCTMs` / `CCs`** delimit the three department blocks.
- **Assignment cells:** `1` = assigned to that date's shift; blank / `available` =
  offered/available (no assignment); other tokens seen in the legend
  (`1st-shift ever`, `Director shadow`, `Elect #1`) exist in the directors' block.
  **The exact cell vocabulary for the data rows is confirmed via the migration's
  dry-run unknown-cell report (§11) before `--apply`** — `1`=assigned is the known
  primary code; the script reports any token it does not recognize rather than
  guessing.

### 5.2 `HAVEN Clinic Prep Summer 2026.xlsx` → `ATTENDING QUALS`
One row per attending: `Schedule Name` (the short name used in the schedule grid,
the join key), `Full Name`, and Yes/No per procedure — `IUD In`, `IUD Out`,
`Nxp` (Nexplanon), `GAC`, `EMB`, `Male` (sees male patients) — plus `Notes`. Blank
= unspecified. → seeds the **RHD Attendings** table.

### 5.3 `HAVEN Clinic Prep Summer 2026.xlsx` → `SETTINGS`
`Max Procedures Per Clinic = 3` → the readiness cap (§8). Other settings
(`Schedule File Name`, `Current Term Sheet`) are spreadsheet-plumbing and are not
ported.

## 6. Data model changes

### 6.1 All People table (person attributes)
- `Licensed RN` (checkbox) — drives the # RNs coverage count and the depo flag.
- Reuse existing `Spanish Speaking` (checkbox; live-synced from application
  proficiency) and `Returning Volunteer` (checkbox), and `minShiftsWanted`.
- *(Optional, on request: surface `EPIC Access`, `Program`, `Phone` as read-only
  display fields — not required for the readiness logic.)*

### 6.2 RHD Attendings table (new) — one row per attending
- `Schedule Name` (singleLineText) — join key to the schedule grid's Attending row.
- `Full Name` (singleLineText).
- `IUD In`, `IUD Out`, `Nexplanon`, `GAC`, `EMB`, `Sees Male` (checkbox each).
- `Notes` (long text, optional).

Maintained in Airtable; read by the portal. ~11 rows, semi-static.

### 6.3 RHD Clinics table (new) — one row per Saturday (the clinic-level facts)
- `Date` (single-select or date matching `CANONICAL_DATES`).
- `Attending` (multipleRecordLinks → RHD Attendings, single value).
- `Director on point` (singleLineText) — initials/name, as entered.
- `Procedures Booked` (number, optional) — manual, PHI-free aggregate count.

Rationale: attending / director / procedures-booked are facts about the **clinic
day**, shared by all three departments, so they live once here rather than being
triplicated onto the SCTS/JCTS/CCRH schedule rows.

### 6.4 SU 26 Schedule table (per Department + Date row)
**No new fields.** RHD reuses `Volunteers on Shift` and `Shadow Volunteers on Shift`
exactly as they exist. The department *is* the role (SCTS = SCTM, JCTS = JCTM,
CCRH = CC), so RHD needs none of PCAR's Triage/Walk-in/CC role-flag lists.

### 6.5 TypeScript types (`src/api/types.ts`)
- `Person`: add `licensedRN?: boolean` (alongside existing `spanishSpeaking?`,
  `returning?`).
- New `Attending` type: `{ id; scheduleName; fullName; iudIn; iudOut; nexplanon;
  gac; emb; seesMale: boolean; notes?: string }`.
- New `ClinicReadiness` type (one per date): `{ date; attending: Attending | null;
  director: string | null; coverage: { sctm; jctm; rn; spanish: number };
  depoOk: boolean; proceduresBooked: number | null; procedureCapWarning: boolean;
  emails: string[] }`.
- New `RhdReadinessResponse`: `{ maxProceduresPerClinic: number; clinics:
  ClinicReadiness[] }`.

## 7. API changes (`server/app.ts`)

- **`POST /schedule/:deptId` (read):** add `licensedRN` to `buildPerson` (mirrors
  the existing `spanishSpeaking` / `returning` reads). No other change — the three
  RHD departments load through the existing per-dept schedule path.
- **New read endpoint `POST /rhd/readiness`** (director-scoped, SRHD group): returns
  `RhdReadinessResponse`. Server-side it loads the three SRHD schedule rows per date,
  the RHD Clinics rows, the RHD Attendings rows, and the max-procedures setting, then
  delegates the per-date computation to the pure `server/rhd.ts` module (§8). One
  call returns every Saturday's readiness so the panel needs no client-side
  cross-department stitching.
- **New write endpoint `POST /rhd/clinic`** (director-scoped): upsert one RHD Clinics
  row — set `Attending` (link), `Director on point`, and/or `Procedures Booked` for a
  date. Only the provided fields are written (same conditional pattern as the
  existing assignment writes).
- No auth/permission changes — SRHD already manages SCTS/JCTS/CCRH via
  `MANAGES_OTHER_DEPTS`. `Licensed RN` membership flows from All People.

## 8. Clinic-readiness computation (`server/rhd.ts`, pure)

Mirrors `server/medteam.ts`: pure, fully unit-testable, no Airtable. Given, for a
date, the assigned people across the three SRHD departments (each with
`licensedRN` / `spanishSpeaking`), the clinic's attending (with quals) and director,
the booked-procedures count, and the cap, it returns one `ClinicReadiness`:

- **Allowed procedures:** for the attending, map each quals checkbox →
  `yes` (allowed) / `no` (not allowed) / `unknown` (blank → "verify"). `Sees Male`
  surfaced the same way.
- **Depo / injections:** `depoOk = rnCount >= 1`. When false, the panel shows
  "reschedule — no RN".
- **Coverage counts:** `sctm` = # on-shift in SCTS, `jctm` = # on-shift in JCTS,
  `rn` = # on-shift across all three with `licensedRN`, `spanish` = # on-shift across
  all three with `spanishSpeaking`. (Derived — the spreadsheet's rows 3–6.)
- **Procedure cap:** `procedureCapWarning = proceduresBooked != null &&
  proceduresBooked > maxProceduresPerClinic`.
- **Emails:** sorted, de-duplicated emails of all assigned volunteers for the date.
- A `CLOSED` attending name (e.g. 2026-07-04) yields an explicitly "closed" clinic
  with no warnings.

## 9. Frontend

- **`PersonRow`:** add a **Licensed RN** badge alongside the existing Spanish /
  Returning badges.
- **Clinic Readiness panel** (new component, styled like the PCAR `CapacityPanel`):
  for the SRHD director view, one card per Saturday showing the attending picker, the
  green/red/grey procedure chips + sees-male, the depo/RN flag, the four coverage
  counts, the `Procedures Booked` input with the cap warning, the director field, and
  a copy-to-clipboard email list. Data comes from the new `POST /rhd/readiness`;
  edits (attending / director / procedures booked) post to `POST /rhd/clinic`.
- The three department grids are unchanged from the PCAR pattern; assignment still
  happens inside each department's grid, and the readiness panel rolls them up by
  date. No mockup (per standing user preference); match existing capacity-panel
  styling.

## 10. Pure computation lives in testable modules

- `server/rhd.ts` — cell-code parsing for the import + `computeClinicReadiness` +
  `buildRhdImportPlan`. No Airtable, no I/O.
- `src/app/components/schedule/` — any client-side derivations (e.g. badge tallies)
  follow the existing `capacity.ts` pattern.

## 11. One-time migration script (`scripts/import-rhd.ts`, run via `tsx`)

Mirrors `scripts/import-medteam.ts`, with PCAR's two hard-won fixes applied from the
start: parse via `XLSX.read(readFileSync(path))` (not `XLSX.readFile`), and **never**
write `Spanish Speaking` (it is derived live; only seed `Returning Volunteer`).

- **Files / tabs:** `--schedule "HAVEN RHD Schedule.xlsx"` (reads `Summer 2026` only)
  and `--prep "HAVEN Clinic Prep Summer 2026.xlsx"` (reads `ATTENDING QUALS` and
  `SETTINGS` only). Never reads `LCC RHD SCTMs` or any per-patient tab.
- **Attendings:** upsert RHD Attendings from `ATTENDING QUALS` by `Schedule Name`.
- **Person matching:** match each roster row to All People by **Yale Email**
  (lowercased). Print every unmatched person; **never guess** a match (the PCAR import
  legitimately skipped one unmatched person this way).
- **Roster:** union matched people into the SCTS / JCTS / CCRH `Volunteers` lists.
- **Attributes:** set `Licensed RN` (from the `Licensed RN` column) and
  `Returning Volunteer` (from `Status`) on All People. Do **not** write Spanish.
- **Assignments:** one SU 26 Schedule row per (dept, date) from the `1`-cells;
  shadows → `Shadow Volunteers on Shift`. Unknown cell tokens are reported, not
  written.
- **Clinics:** upsert one RHD Clinics row per date from the `Attending` and `Director`
  rows (linking the attending by `Schedule Name`).
- **Availability:** **not modified** (same accepted consequence as PCAR §11 — an
  assigned-but-not-available cell can appear; directors adjust via the existing
  override).
- **Safety:** **dry-run is the default** — prints the planned writes, the
  unmatched-people report, and the unknown-cell report; `--apply` commits. Idempotent:
  upserts by (dept, date) / `Schedule Name` / clinic date, so re-running is safe.

## 12. Testing (`server/tests/*` + `src/tests/*`, vitest)

- `computeClinicReadiness`: allowed/blocked/unknown procedure mapping; depo flag at
  rn = 0 vs ≥1; coverage counts across three departments; cap warning at/over/under;
  `CLOSED` clinic; email de-duplication.
- `buildRhdImportPlan`: section detection (SCTMs/JCTMs/CCs → SCTS/JCTS/CCRH), `1`-cell
  → assignment, shadow handling, unknown-cell reporting, attending/director extraction.
- Email matching: exact, case-insensitive, unmatched reporting.
- A small `src/tests` check for any client-side badge/tally derivation.

## 13. Training compliance — fast-follow (out of scope here)

The RHD training tabs (CLIA UA / CLIA hCG / RHD Training / Pharm Training) map onto
the already-merged compliance subsystem (the "missing: contract/training" badge).
Wiring CLIA/RHD/Pharm as tracked required-items is a separate, smaller change and is
intentionally **not** part of this cutover. Flagged for a follow-up if the directors
want those gating the schedule.

## 14. Risks & open points

- **Cell vocabulary:** only the schedule's header/structure rows were sampled; the
  exact assignment-cell tokens are confirmed via the dry-run unknown-cell report
  before `--apply`.
- **Director resolution:** stored as raw initials/text in v1 (no person link) to avoid
  mis-resolving initials; can become a link later.
- **Attending blanks:** an attending with unspecified quals (e.g. a new attending)
  renders procedures as grey "verify" rather than allowed/blocked.
- **Cross-department coverage** assumes the three SRHD departments share the same
  Saturday cadence (`CANONICAL_DATES`) — true for Summer 2026.
- **Airtable schema** (the two new tables + `Licensed RN`) must exist before the
  migration runs; created via the Airtable MCP/API as a first build step.

## 15. Suggested build sequence

1. Airtable schema: `Licensed RN` on All People; **RHD Attendings** + **RHD Clinics**
   tables (§6.1–6.3) + TS types (§6.5).
2. `server/rhd.ts` pure module — `computeClinicReadiness` + `buildRhdImportPlan` +
   cell parsing, with tests (§8, §12).
3. API: `licensedRN` in `buildPerson`; `POST /rhd/readiness` (read) and
   `POST /rhd/clinic` (write) (§7).
4. Frontend: `PersonRow` RN badge; Clinic Readiness panel (§9).
5. Migration script with dry-run (§11).
6. Tests throughout (§12).
