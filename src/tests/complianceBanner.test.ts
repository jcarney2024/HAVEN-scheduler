import { describe, it, expect } from "vitest";
import { summarizeCompliance, formatMissing } from "@/app/components/schedule/ComplianceBanner";
import type { DepartmentRef } from "@/api/types";

function dept(over: Partial<DepartmentRef>): DepartmentRef {
  return { id: "d", name: "Dept", pendingRequestCount: 0, nonCompliantVolunteers: [], ...over };
}

describe("formatMissing", () => {
  it("joins missing items with a plus", () => {
    expect(formatMissing(["training"])).toBe("training");
    expect(formatMissing(["contract", "training"])).toBe("contract + training");
  });
});

describe("summarizeCompliance", () => {
  it("reports zero total when everyone is compliant", () => {
    const s = summarizeCompliance([dept({})]);
    expect(s.total).toBe(0);
    expect(s.withIssues).toEqual([]);
    expect(s.multiDept).toBe(false);
  });

  it("counts non-compliant volunteers across departments and flags multiDept", () => {
    const s = summarizeCompliance([
      dept({ id: "d1", name: "SRHD", nonCompliantVolunteers: [{ id: "v1", name: "Ada", missing: ["contract"] }] }),
      dept({ id: "d2", name: "SCTS", nonCompliantVolunteers: [
        { id: "v2", name: "Bea", missing: ["training"] },
        { id: "v3", name: "Cy", missing: ["contract", "training"] },
      ] }),
      dept({ id: "d3", name: "CCRH", nonCompliantVolunteers: [] }),
    ]);
    expect(s.total).toBe(3);
    expect(s.withIssues.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(s.multiDept).toBe(true);
  });

  it("does not flag multiDept when only one department has issues", () => {
    const s = summarizeCompliance([
      dept({ id: "d1", name: "SRHD", nonCompliantVolunteers: [{ id: "v1", name: "Ada", missing: ["contract"] }] }),
      dept({ id: "d2", name: "SCTS", nonCompliantVolunteers: [] }),
    ]);
    expect(s.total).toBe(1);
    expect(s.multiDept).toBe(false);
  });
});
