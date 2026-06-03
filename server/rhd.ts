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

export type RhdDept = "SCTS" | "JCTS" | "CCRH";

export type RhdCell = { onShift: boolean; shadow: boolean; available: boolean };

/** Map an RHD grid cell to a normalized assignment. null = empty or unknown
 *  (callers pre-check emptiness so they can report unknowns). `1` = on shift;
 *  shadow + available tokens are recognized; everything else is unknown. */
export function parseRhdCell(raw: string): RhdCell | null {
  const code = raw.trim().toLowerCase().replace(/&amp;/gi, "&").replace(/\s+/g, "");
  if (!code) return null;
  // Shadow shifts are sometimes written verbosely (e.g. "SCTM SHADOW") — match on substring.
  if (code.includes("shadow") || code === "s") return { onShift: false, shadow: true, available: false };
  // "1" = assigned; "1&on call" = assigned with an on-call note → still on shift.
  if (code === "1" || code === "1.0" || code === "1&oncall") return { onShift: true, shadow: false, available: false };
  // Recognized non-assignments (offered / backup). Not written to any shift list,
  // so an on-call or if-needed volunteer does not inflate coverage counts.
  if (["a", "available", "avail", "oncall", "ifneeded"].includes(code)) {
    return { onShift: false, shadow: false, available: true };
  }
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
