import { describe, it, expect } from "vitest";
import { computeClinicReadiness, type ClinicInput } from "../rhd.js";

const attending = {
  id: "att1",
  scheduleName: "Rivera",
  fullName: "Nina Rivera, MD",
  procedures: {
    iudIn: "yes", iudOut: "yes", nexplanon: "yes",
    gac: "no", emb: "yes", seesMale: "no",
  },
} as const;

function person(id: string, opts: { rn?: boolean; es?: boolean } = {}) {
  return { id, email: `${id}@yale.edu`, licensedRN: !!opts.rn, spanishSpeaking: !!opts.es };
}

const base: ClinicInput = {
  date: "2026-06-13",
  attending,
  director: "KM",
  sctsOnShift: [person("a"), person("b", { rn: true })],
  jctsOnShift: [person("c", { es: true })],
  ccrhOnShift: [person("d")],
  proceduresBooked: null,
  maxProceduresPerClinic: 3,
};

describe("computeClinicReadiness", () => {
  it("copies the attending's procedure statuses", () => {
    const r = computeClinicReadiness(base);
    expect(r.procedures.iudIn).toBe("yes");
    expect(r.procedures.gac).toBe("no");
  });

  it("marks every procedure unknown when there is no attending", () => {
    const r = computeClinicReadiness({ ...base, attending: null, sctsOnShift: [person("a")] });
    expect(r.procedures.iudIn).toBe("unknown");
    expect(r.procedures.seesMale).toBe("unknown");
    expect(r.closed).toBe(false); // people are on shift
  });

  it("counts coverage across the three departments", () => {
    const r = computeClinicReadiness(base);
    expect(r.coverage.sctm).toBe(2);
    expect(r.coverage.jctm).toBe(1);
    expect(r.coverage.rn).toBe(1);
    expect(r.coverage.spanish).toBe(1);
  });

  it("depoOk only when at least one RN is on shift", () => {
    expect(computeClinicReadiness(base).depoOk).toBe(true);
    const noRn = { ...base, sctsOnShift: [person("a")], ccrhOnShift: [person("d")], jctsOnShift: [] };
    expect(computeClinicReadiness(noRn).depoOk).toBe(false);
  });

  it("warns when booked procedures exceed the cap", () => {
    expect(computeClinicReadiness({ ...base, proceduresBooked: 4 }).procedureCapWarning).toBe(true);
    expect(computeClinicReadiness({ ...base, proceduresBooked: 3 }).procedureCapWarning).toBe(false);
    expect(computeClinicReadiness({ ...base, proceduresBooked: null }).procedureCapWarning).toBe(false);
  });

  it("treats an empty, attending-less clinic as closed with no warnings", () => {
    const r = computeClinicReadiness({
      ...base, attending: null, director: null,
      sctsOnShift: [], jctsOnShift: [], ccrhOnShift: [], proceduresBooked: 9,
    });
    expect(r.closed).toBe(true);
    expect(r.depoOk).toBe(true);
    expect(r.procedureCapWarning).toBe(false);
  });

  it("dedupes and sorts the clinic email list", () => {
    const r = computeClinicReadiness({
      ...base,
      sctsOnShift: [person("b"), person("a")],
      jctsOnShift: [{ id: "a", email: "a@yale.edu", licensedRN: false, spanishSpeaking: false }],
      ccrhOnShift: [],
    });
    expect(r.emails).toEqual(["a@yale.edu", "b@yale.edu"]);
  });
});

import { parseRhdCell, buildRhdImportPlan, type RhdSheetPersonRow } from "../rhd.js";

describe("parseRhdCell", () => {
  it("reads 1 as on-shift", () => {
    expect(parseRhdCell("1")).toEqual({ onShift: true, shadow: false, available: false });
  });
  it("reads available tokens", () => {
    expect(parseRhdCell("available")).toEqual({ onShift: false, shadow: false, available: true });
    expect(parseRhdCell("A")).toEqual({ onShift: false, shadow: false, available: true });
  });
  it("reads shadow tokens", () => {
    expect(parseRhdCell("shadow")).toEqual({ onShift: false, shadow: true, available: false });
    expect(parseRhdCell("S")).toEqual({ onShift: false, shadow: true, available: false });
  });
  it("returns null for empty and unknown", () => {
    expect(parseRhdCell("")).toBeNull();
    expect(parseRhdCell("   ")).toBeNull();
    expect(parseRhdCell("xyz")).toBeNull();
  });
});

describe("buildRhdImportPlan", () => {
  const dates = ["2026-05-30", "2026-06-06"];
  const rows: RhdSheetPersonRow[] = [
    { name: "Bridget Chen", email: "bridget.chen@yale.edu", dept: "SCTS", returning: true, licensedRN: false, cells: { "2026-05-30": "1", "2026-06-06": "available" } },
    { name: "Mirielle Ma", email: "mirielle.ma@yale.edu", dept: "JCTS", returning: false, licensedRN: false, cells: { "2026-05-30": "1" } },
    { name: "Ramy Triki", email: "ramy.triki@yale.edu", dept: "CCRH", returning: false, licensedRN: true, cells: { "2026-05-30": "S", "2026-06-06": "1" } },
    { name: "Mystery", email: "mystery@yale.edu", dept: "SCTS", returning: false, licensedRN: false, cells: { "2026-05-30": "??" } },
  ];

  it("groups assignments by dept and date and routes shadows", () => {
    const plan = buildRhdImportPlan(rows, dates);
    expect(plan.perDeptDate.SCTS["2026-05-30"].onShift).toEqual(["bridget.chen@yale.edu"]);
    expect(plan.perDeptDate.JCTS["2026-05-30"].onShift).toEqual(["mirielle.ma@yale.edu"]);
    expect(plan.perDeptDate.CCRH["2026-05-30"].shadow).toEqual(["ramy.triki@yale.edu"]);
    expect(plan.perDeptDate.CCRH["2026-06-06"].onShift).toEqual(["ramy.triki@yale.edu"]);
  });

  it("collects every distinct person with their dept + attributes", () => {
    const plan = buildRhdImportPlan(rows, dates);
    expect(plan.people.find((p) => p.email === "ramy.triki@yale.edu")).toMatchObject({ dept: "CCRH", licensedRN: true });
    expect(plan.people.find((p) => p.email === "bridget.chen@yale.edu")).toMatchObject({ dept: "SCTS", returning: true });
  });

  it("reports unknown cells instead of guessing", () => {
    const plan = buildRhdImportPlan(rows, dates);
    expect(plan.unknownCells).toEqual([{ email: "mystery@yale.edu", date: "2026-05-30", raw: "??" }]);
  });
});
