import { describe, it, expect } from "vitest";
import {
  buildComplianceByPersonId,
  buildNonCompliantByDept,
  type ComplianceRow,
  type NonCompliantVolunteer,
} from "../compliance";

describe("buildComplianceByPersonId", () => {
  it("ORs contract and training across multiple rows for the same person", () => {
    const rows: ComplianceRow[] = [
      { personIds: ["p1"], contract: true, training: false },
      { personIds: ["p1"], contract: false, training: true },
    ];
    const map = buildComplianceByPersonId(rows);
    expect(map.get("p1")).toEqual({ contract: true, training: true });
  });

  it("handles a row linked to multiple people", () => {
    const rows: ComplianceRow[] = [
      { personIds: ["p1", "p2"], contract: true, training: false },
    ];
    const map = buildComplianceByPersonId(rows);
    expect(map.get("p1")).toEqual({ contract: true, training: false });
    expect(map.get("p2")).toEqual({ contract: true, training: false });
  });

  it("returns no entry for a person with no rows", () => {
    const map = buildComplianceByPersonId([]);
    expect(map.get("p1")).toBeUndefined();
  });
});

describe("buildNonCompliantByDept", () => {
  const complianceByPersonId = new Map([
    ["v1", { contract: true, training: true }],   // compliant
    ["v2", { contract: true, training: false }],  // missing training
    ["v3", { contract: false, training: false }], // missing both
    // v4 has no entry → treated as missing both
  ]);
  const nameById = new Map([
    ["v1", "Ada"],
    ["v2", "Bea"],
    ["v3", "Cy"],
    ["v4", "Dee"],
  ]);

  it("lists volunteers missing contract or training, with specific items", () => {
    const result = buildNonCompliantByDept({
      depts: [{ id: "d1", volunteerIds: ["v1", "v2", "v3", "v4"] }],
      complianceByPersonId,
      nameById,
    });
    expect(result.get("d1")).toEqual<NonCompliantVolunteer[]>([
      { id: "v2", name: "Bea", missing: ["training"] },
      { id: "v3", name: "Cy", missing: ["contract", "training"] },
      { id: "v4", name: "Dee", missing: ["contract", "training"] },
    ]);
  });

  it("returns an empty array for a department whose volunteers are all compliant", () => {
    const result = buildNonCompliantByDept({
      depts: [{ id: "d1", volunteerIds: ["v1"] }],
      complianceByPersonId,
      nameById,
    });
    expect(result.get("d1")).toEqual([]);
  });

  it("falls back to the id when no name is known", () => {
    const result = buildNonCompliantByDept({
      depts: [{ id: "d1", volunteerIds: ["vX"] }],
      complianceByPersonId,
      nameById,
    });
    expect(result.get("d1")).toEqual([
      { id: "vX", name: "vX", missing: ["contract", "training"] },
    ]);
  });
});
