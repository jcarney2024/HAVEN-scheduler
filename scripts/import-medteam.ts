/**
 * One-time migration: seed SCTP/JCTP roster + assignment grid (with clinical
 * roles) from the Med Team workbook. Reads ONLY the SCTM/JCTM tabs — never the
 * PHI patient tabs. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   npm run import:medteam -- --file "Med Team Schedule Summer 2026.xlsx"
 *   npm run import:medteam -- --file "Med Team Schedule Summer 2026.xlsx" --apply
 */
import { readFileSync } from "node:fs";
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

  // Parse from a buffer (XLSX.readFile isn't reliably exposed under tsx/ESM).
  const wb = XLSX.read(readFileSync(FILE), { type: "buffer", cellDates: true });

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
      // Spanish Speaking is intentionally NOT written — it's derived live from
      // application proficiency (see buildPerson). Only seed Returning here.
      await patchRecord({
        baseId: config.haveNManagementBaseId,
        tableId: config.allPeopleTableId,
        recordId: id,
        fields: { "Returning Volunteer": a.returning },
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
