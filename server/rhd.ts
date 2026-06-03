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
