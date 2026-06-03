/**
 * One-time migration: seed the RHD roster + clinic schedule + attending quals
 * from the HAVEN RHD workbook (schedule) and the Clinic Prep workbook.
 *
 * PHI SAFETY: reads ONLY the `Summer 2026` tab of the schedule workbook and the
 * `ATTENDING QUALS` / `SETTINGS` tabs of the prep workbook. NEVER opens the
 * per-patient / clinic-prep TEMPLATE tabs (e.g. `LCC RHD SCTMs`).
 *
 * Dry-run by default; pass --apply to write (writes are a separately-authorized
 * later step — do NOT pass --apply here).
 *
 * Usage:
 *   npm run import:rhd -- --schedule "HAVEN RHD Schedule.xlsx" --prep "HAVEN Clinic Prep Summer 2026.xlsx"
 *   npm run import:rhd -- --schedule "..." --prep "..." --apply
 */
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import * as XLSX from "xlsx";
import { createRecord, listAll, patchRecord, type AirtableRecord } from "../server/airtable.js";
import { loadConfig } from "../server/config.js";
import { CANONICAL_DATES, displayDate, normalizeVolunteerDate } from "../server/dates.js";
import { buildRhdImportPlan, type RhdDept, type RhdSheetPersonRow } from "../server/rhd.js";

dotenv.config({ path: ".env.local" });

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--apply");
const SCHEDULE_FILE = argValue("--schedule");
const PREP_FILE = argValue("--prep");

const SCHEDULE_SHEET = "Summer 2026";
const ATTENDING_QUALS_SHEET = "ATTENDING QUALS";

/** Section-header label (col A) → RHD department. Matches the workbook's actual
 *  headers: "SCTMs", "JCTMs", and "Care Coordinators" (the prep file also uses
 *  "CCs" historically, so accept both). */
const SECTION_TO_DEPT: { label: RegExp; dept: RhdDept }[] = [
  { label: /^sctms$/i, dept: "SCTS" },
  { label: /^jctms$/i, dept: "JCTS" },
  { label: /^(ccs|care coordinators)$/i, dept: "CCRH" },
];

const ALL_DEPTS: RhdDept[] = ["SCTS", "JCTS", "CCRH"];

/** Reuse import-medteam's header→ISO logic: a Date cell or a parseable string
 *  resolves to a canonical Saturday ISO, else null. */
function headerToIso(h: unknown): string | null {
  if (h instanceof Date) {
    const iso = `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, "0")}-${String(h.getUTCDate()).padStart(2, "0")}`;
    if ((CANONICAL_DATES as readonly string[]).includes(iso)) return iso;
    const local = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
    return (CANONICAL_DATES as readonly string[]).includes(local) ? local : null;
  }
  if (typeof h === "string") return normalizeVolunteerDate(h);
  return null;
}

type ScheduleExtract = {
  rows: RhdSheetPersonRow[];
  dateCols: { idx: number; iso: string }[];
  attendingByIso: Record<string, string>;
  directorByIso: Record<string, string>;
};

function extractScheduleSheet(ws: XLSX.WorkSheet): ScheduleExtract {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

  // Row 0 = "Clinic Date": detect the dated columns.
  const headerRow = (grid[0] ?? []) as unknown[];
  const dateCols: { idx: number; iso: string }[] = [];
  headerRow.forEach((h, idx) => {
    const iso = headerToIso(h);
    if (iso) dateCols.push({ idx, iso });
  });

  // Row 1 = "Attending", row 2 = "Director" — per-clinic values at the dated cols.
  const attendingByIso: Record<string, string> = {};
  const directorByIso: Record<string, string> = {};
  const attRow = (grid[1] ?? []) as unknown[];
  const dirRow = (grid[2] ?? []) as unknown[];
  for (const { idx, iso } of dateCols) {
    const a = String(attRow[idx] ?? "").trim();
    const d = String(dirRow[idx] ?? "").trim();
    if (a) attendingByIso[iso] = a;
    if (d) directorByIso[iso] = d;
  }

  // Find the roster header row: the one whose cells include both "Yale Email"
  // and "Licensed RN". Resolve those column indices by header name.
  let headerRowIdx = -1;
  let nameCol = 0;
  let statusCol = -1;
  let emailCol = -1;
  let rnCol = -1;
  for (let r = 0; r < grid.length; r++) {
    const row = (grid[r] ?? []) as unknown[];
    const labels = row.map((c) => String(c ?? "").trim());
    const hasEmail = labels.some((v) => /yale email/i.test(v));
    const hasRn = labels.some((v) => /licensed rn/i.test(v));
    if (hasEmail && hasRn) {
      headerRowIdx = r;
      labels.forEach((v, i) => {
        if (/^name$/i.test(v)) nameCol = i;
        else if (/^status$/i.test(v)) statusCol = i;
        else if (/yale email/i.test(v)) emailCol = i;
        else if (/licensed rn/i.test(v)) rnCol = i;
      });
      break;
    }
  }
  if (headerRowIdx < 0 || emailCol < 0 || rnCol < 0) {
    throw new Error(`Could not locate roster header row (needs "Yale Email" + "Licensed RN") in "${SCHEDULE_SHEET}".`);
  }

  // Walk rows below the header. Section-header rows (col A exactly a section
  // label) switch the active department. People rows appear below a section
  // header. Rows before the first section header (the Directors block) have a
  // null active dept and are skipped. Non-person rows (Totals, prep block,
  // blanks) lack an email and are skipped by the email guard.
  const rows: RhdSheetPersonRow[] = [];
  let currentDept: RhdDept | null = null;
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = (grid[r] ?? []) as unknown[];
    const colA = String(row[nameCol] ?? "").trim();

    const section = SECTION_TO_DEPT.find((s) => s.label.test(colA));
    if (section) {
      currentDept = section.dept;
      continue;
    }
    if (!currentDept) continue; // Directors block (before first section header)

    const email = String(row[emailCol] ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue; // Totals / prep / blank rows

    const name = colA;
    const status = statusCol >= 0 ? String(row[statusCol] ?? "").trim() : "";
    const returning = /^return/i.test(status);
    const rnRaw = String(row[rnCol] ?? "").trim().toUpperCase();
    const licensedRN = rnRaw === "RN" || rnRaw === "YES" || rnRaw === "Y";

    const cells: Record<string, string> = {};
    for (const { idx, iso } of dateCols) {
      const v = row[idx];
      if (v != null && String(v).trim() !== "") cells[iso] = String(v);
    }
    rows.push({ name, email, dept: currentDept, returning, licensedRN, cells });
  }

  return { rows, dateCols, attendingByIso, directorByIso };
}

type AttendingQual = {
  scheduleName: string;
  fullName: string;
  fields: Record<string, string>; // only set keys present
};

/** Map a procedure cell to the single-select string. "Yes"/"No" → as-is;
 *  blank → unset (returns undefined). */
function yesNoOrUnset(raw: unknown): string | undefined {
  const v = String(raw ?? "").trim();
  if (/^yes$/i.test(v)) return "Yes";
  if (/^no$/i.test(v)) return "No";
  return undefined;
}

function extractAttendingQuals(ws: XLSX.WorkSheet): AttendingQual[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });

  // Find the header row: has both "Schedule Name" and "Full Name".
  let headerRowIdx = -1;
  const colByHeader: Record<string, number> = {};
  for (let r = 0; r < grid.length; r++) {
    const labels = ((grid[r] ?? []) as unknown[]).map((c) => String(c ?? "").trim());
    const hasSched = labels.some((v) => /^schedule name$/i.test(v));
    const hasFull = labels.some((v) => /^full name$/i.test(v));
    if (hasSched && hasFull) {
      headerRowIdx = r;
      labels.forEach((v, i) => {
        if (v) colByHeader[v.toLowerCase()] = i;
      });
      break;
    }
  }
  if (headerRowIdx < 0) {
    throw new Error(`Could not locate "${ATTENDING_QUALS_SHEET}" header row (needs "Schedule Name" + "Full Name").`);
  }

  const col = (h: string) => colByHeader[h.toLowerCase()];
  // header label → Airtable field name (note Nxp→Nexplanon, Male→Sees Male).
  const PROC_MAP: { header: string; field: string }[] = [
    { header: "IUD In", field: "IUD In" },
    { header: "IUD Out", field: "IUD Out" },
    { header: "Nxp", field: "Nexplanon" },
    { header: "GAC", field: "GAC" },
    { header: "EMB", field: "EMB" },
    { header: "Male", field: "Sees Male" },
  ];
  const notesCol = col("Notes");
  const schedCol = col("Schedule Name");
  const fullCol = col("Full Name");

  const out: AttendingQual[] = [];
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = (grid[r] ?? []) as unknown[];
    const scheduleName = String(row[schedCol] ?? "").trim();
    const fullName = String(row[fullCol] ?? "").trim();
    // Require a real attending row: both a schedule name and a full name.
    if (!scheduleName || !fullName) continue;

    const fields: Record<string, string> = {};
    for (const { header, field } of PROC_MAP) {
      const c = col(header);
      if (c == null) continue;
      const val = yesNoOrUnset(row[c]);
      if (val !== undefined) fields[field] = val;
    }
    if (notesCol != null) {
      const notes = String(row[notesCol] ?? "").trim();
      if (notes) fields["Notes"] = notes;
    }
    out.push({ scheduleName, fullName, fields });
  }
  return out;
}

function linkIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : (v as { id?: string }).id ?? "")).filter(Boolean);
}

async function main() {
  if (!SCHEDULE_FILE || !PREP_FILE) {
    console.error("Usage: import:rhd -- --schedule <Summer2026.xlsx> --prep <ClinicPrep.xlsx> [--apply]");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) throw new Error("Missing Airtable config — check .env.local");
  if (!config.rhdAttendingsTableId || !config.rhdClinicsTableId) {
    console.error(
      "Missing RHD table IDs in .env.local: set RHD_ATTENDINGS_TABLE_ID and RHD_CLINICS_TABLE_ID. Cannot run the RHD import.",
    );
    process.exit(1);
  }
  const rhdAttendingsTableId = config.rhdAttendingsTableId;
  const rhdClinicsTableId = config.rhdClinicsTableId;

  // Hard-won fix from import-medteam: parse via XLSX.read(readFileSync(...)),
  // never XLSX.readFile.
  const scheduleWb = XLSX.read(readFileSync(SCHEDULE_FILE), { cellDates: true });
  const prepWb = XLSX.read(readFileSync(PREP_FILE), { cellDates: true });

  const scheduleWs = scheduleWb.Sheets[SCHEDULE_SHEET];
  if (!scheduleWs) throw new Error(`Schedule sheet "${SCHEDULE_SHEET}" not found in ${SCHEDULE_FILE}.`);
  const qualsWs = prepWb.Sheets[ATTENDING_QUALS_SHEET];
  if (!qualsWs) throw new Error(`Sheet "${ATTENDING_QUALS_SHEET}" not found in ${PREP_FILE}.`);

  const { rows, dateCols, attendingByIso, directorByIso } = extractScheduleSheet(scheduleWs);
  const attendingQuals = extractAttendingQuals(qualsWs);

  const dateIsos = dateCols.map((d) => d.iso);
  const plan = buildRhdImportPlan(rows, dateIsos);

  // Build All People email→id map.
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
  const toId = (e: string) => idByEmail.get(e);

  const matchedPeople = plan.people.filter((p) => idByEmail.has(p.email));
  const unmatchedPeople = plan.people.filter((p) => !idByEmail.has(p.email));

  // ----- DRY-RUN REPORT -----
  console.log(`\n${"=".repeat(64)}`);
  console.log(`[${APPLY ? "APPLY" : "DRY-RUN"}] RHD import`);
  console.log(`  schedule: ${SCHEDULE_FILE} → "${SCHEDULE_SHEET}"`);
  console.log(`  prep:     ${PREP_FILE} → "${ATTENDING_QUALS_SHEET}"`);
  console.log("=".repeat(64));

  console.log(`\nDATE COLUMNS (${dateCols.length}):`);
  for (const { idx, iso } of dateCols) {
    console.log(`  col ${idx} → ${iso} (${displayDate(iso)})`);
  }

  console.log(`\nPER-DEPARTMENT COUNTS:`);
  for (const dept of ALL_DEPTS) {
    const people = plan.people.filter((p) => p.dept === dept);
    const byDate = plan.perDeptDate[dept];
    let onShiftDays = 0;
    let shadowDays = 0;
    let onShiftSlots = 0;
    let shadowSlots = 0;
    for (const iso of dateIsos) {
      const d = byDate[iso];
      if (d.onShift.length) onShiftDays++;
      if (d.shadow.length) shadowDays++;
      onShiftSlots += d.onShift.length;
      shadowSlots += d.shadow.length;
    }
    console.log(
      `  ${dept}: ${people.length} people | on-shift: ${onShiftDays} days (${onShiftSlots} slots) | shadow: ${shadowDays} days (${shadowSlots} slots)`,
    );
  }

  console.log(`\nATTENDINGS PARSED FROM "${ATTENDING_QUALS_SHEET}" (${attendingQuals.length}):`);
  for (const a of attendingQuals) {
    const procs = Object.entries(a.fields)
      .filter(([k]) => k !== "Notes")
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    const notes = a.fields["Notes"] ? ` | Notes: ${a.fields["Notes"]}` : "";
    console.log(`  "${a.scheduleName}" (${a.fullName}): ${procs || "(no procedure quals set)"}${notes}`);
  }

  console.log(`\nATTENDING / DIRECTOR PER CLINIC:`);
  for (const { iso } of dateCols) {
    const att = attendingByIso[iso] ?? "(none)";
    const dir = directorByIso[iso] ?? "(none)";
    console.log(`  ${iso} (${displayDate(iso)}): attending="${att}" director="${dir}"`);
  }

  console.log(`\nALL PEOPLE MATCHING: ${matchedPeople.length} matched / ${plan.people.length} total`);
  console.log(`\nUNMATCHED PEOPLE (email not in All People) — ${unmatchedPeople.length}:`);
  if (unmatchedPeople.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of unmatchedPeople) {
      console.log(`  ${p.dept} | ${p.name} <${p.email}>`);
    }
  }

  console.log(`\nUNKNOWN CELLS (unparseable assignment tokens) — ${plan.unknownCells.length}:`);
  if (plan.unknownCells.length === 0) {
    console.log("  (none)");
  } else {
    for (const u of plan.unknownCells) {
      console.log(`  ${u.email} @ ${u.date} = "${u.raw}"`);
    }
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No writes performed. Re-run with --apply to write (separately authorized).`);
    return;
  }

  // ===================== APPLY (gated; NOT run in this task) =====================
  console.log(`\n[APPLY] Writing to Airtable...`);

  // Resolve dept → roster record id (SU 26 roster, by Department Name).
  const roster = await listAll<{ "Department Name"?: string; Volunteers?: unknown }>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const deptRowByName = new Map<RhdDept, AirtableRecord<{ "Department Name"?: string; Volunteers?: unknown }>>();
  for (const dept of ALL_DEPTS) {
    const row = roster.find((r) => r.fields["Department Name"] === dept);
    if (row) deptRowByName.set(dept, row);
    else console.log(`  WARNING: department "${dept}" not found in SU 26 roster — skipping its writes.`);
  }

  // 1) Upsert RHD Attendings by Schedule Name. Build scheduleName → record id.
  const existingAttendings = await listAll<{ "Schedule Name"?: string }>({
    baseId: config.haveNManagementBaseId,
    tableId: rhdAttendingsTableId,
  });
  const attendingIdByName = new Map<string, string>();
  for (const rec of existingAttendings) {
    const n = String(rec.fields["Schedule Name"] ?? "").trim();
    if (n) attendingIdByName.set(n.toLowerCase(), rec.id);
  }
  for (const a of attendingQuals) {
    const fields: Record<string, unknown> = {
      "Schedule Name": a.scheduleName,
      "Full Name": a.fullName,
      ...a.fields,
    };
    const existingId = attendingIdByName.get(a.scheduleName.toLowerCase());
    if (existingId) {
      await patchRecord({ baseId: config.haveNManagementBaseId, tableId: rhdAttendingsTableId, recordId: existingId, fields });
    } else {
      const created = await createRecord<{ "Schedule Name"?: string }>({
        baseId: config.haveNManagementBaseId,
        tableId: rhdAttendingsTableId,
        fields,
      });
      attendingIdByName.set(a.scheduleName.toLowerCase(), created.id);
    }
  }

  // 2) Union matched people into each dept's Volunteers (per dept).
  for (const dept of ALL_DEPTS) {
    const deptRow = deptRowByName.get(dept);
    if (!deptRow) continue;
    const deptMatched = matchedPeople.filter((p) => p.dept === dept).map((p) => toId(p.email)).filter(Boolean) as string[];
    const existing = linkIds(deptRow.fields.Volunteers);
    const union = [...new Set([...existing, ...deptMatched])];
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26RosterTableId,
      recordId: deptRow.id,
      fields: { Volunteers: union },
    });
  }

  // 3) Patch All People Licensed RN + Returning Volunteer (NOT Spanish — derived live).
  for (const p of matchedPeople) {
    const id = toId(p.email);
    if (!id) continue;
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.allPeopleTableId,
      recordId: id,
      fields: { "Licensed RN": p.licensedRN, "Returning Volunteer": p.returning },
    });
  }

  // 4) Upsert one SU 26 Schedule row per (dept, date).
  const existingSchedule = await listAll<{ Department?: unknown; Date?: unknown }>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
  });
  for (const dept of ALL_DEPTS) {
    const deptRow = deptRowByName.get(dept);
    if (!deptRow) continue;
    const deptId = deptRow.id;
    const rowFor = (iso: string): AirtableRecord | undefined =>
      existingSchedule.find((row) => {
        const dep = linkIds(row.fields.Department);
        const dateName = typeof row.fields.Date === "string" ? row.fields.Date : (row.fields.Date as { name?: string })?.name ?? "";
        return dep.includes(deptId) && normalizeVolunteerDate(dateName) === iso;
      });
    for (const { iso } of dateCols) {
      const d = plan.perDeptDate[dept][iso];
      if (d.onShift.length === 0 && d.shadow.length === 0) continue;
      const onShiftIds = d.onShift.map(toId).filter(Boolean) as string[];
      const shadowIds = d.shadow.map(toId).filter(Boolean) as string[];
      const fields: Record<string, unknown> = {
        Name: `${dept} — ${displayDate(iso)}`,
        Department: [deptId],
        Date: displayDate(iso),
        "Volunteers on Shift": onShiftIds,
        "Shadow Volunteers on Shift": shadowIds,
      };
      const existing = rowFor(iso);
      if (existing) {
        await patchRecord({ baseId: config.haveNManagementBaseId, tableId: config.su26ScheduleTableId, recordId: existing.id, fields });
      } else {
        await createRecord({ baseId: config.haveNManagementBaseId, tableId: config.su26ScheduleTableId, fields });
      }
    }
  }

  // 5) Upsert one RHD Clinics row per date.
  const existingClinics = await listAll<{ Date?: unknown }>({
    baseId: config.haveNManagementBaseId,
    tableId: rhdClinicsTableId,
  });
  const clinicRowFor = (iso: string): AirtableRecord | undefined =>
    existingClinics.find((row) => {
      const dateName = typeof row.fields.Date === "string" ? row.fields.Date : (row.fields.Date as { name?: string })?.name ?? "";
      return normalizeVolunteerDate(dateName) === iso;
    });
  for (const { iso } of dateCols) {
    const attName = attendingByIso[iso];
    const director = directorByIso[iso] ?? "";
    const fields: Record<string, unknown> = {
      Date: displayDate(iso),
      "Director on point": director,
    };
    if (attName) {
      const attId = attendingIdByName.get(attName.toLowerCase());
      if (attId) fields["Attending"] = [attId];
    }
    const existing = clinicRowFor(iso);
    if (existing) {
      await patchRecord({ baseId: config.haveNManagementBaseId, tableId: rhdClinicsTableId, recordId: existing.id, fields });
    } else {
      await createRecord({ baseId: config.haveNManagementBaseId, tableId: rhdClinicsTableId, fields });
    }
  }

  console.log(`[APPLY] Writes complete.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
