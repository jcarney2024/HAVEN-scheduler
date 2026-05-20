import { describe, it, expect } from "vitest";
import { planApply, type ScheduleRowForApply } from "../requests";

const baseRows: ScheduleRowForApply[] = [
  { id: "rec530", date: "2026-05-30", directorIds: ["dA"], volunteerIds: ["vA", "vB"] },
  { id: "rec606", date: "2026-06-06", directorIds: ["dA"], volunteerIds: ["vC"] },
];

describe("planApply", () => {
  it("for a drop, removes requester from the (Department, Requester Date) row", () => {
    const plan = planApply({
      scheduleRows: baseRows,
      requesterId: "vA",
      requesterDate: "2026-05-30",
    });
    expect(plan).toEqual([
      {
        recordId: "rec530",
        fields: { "Volunteers on Shift": ["vB"] },
      },
    ]);
  });

  it("for a named swap, produces two patches in deterministic order", () => {
    const plan = planApply({
      scheduleRows: baseRows,
      requesterId: "vA",
      requesterDate: "2026-05-30",
      targetId: "vC",
      targetDate: "2026-06-06",
    });
    expect(plan).toEqual([
      {
        recordId: "rec530",
        fields: { "Volunteers on Shift": ["vB", "vC"] },
      },
      {
        recordId: "rec606",
        fields: { "Volunteers on Shift": ["vA"] },
      },
    ]);
  });

  it("for a director-director swap, patches Directors on Shift instead", () => {
    const rows: ScheduleRowForApply[] = [
      { id: "r1", date: "2026-05-30", directorIds: ["dA", "dB"], volunteerIds: [] },
      { id: "r2", date: "2026-06-06", directorIds: ["dC"], volunteerIds: [] },
    ];
    expect(
      planApply({
        scheduleRows: rows,
        requesterId: "dA",
        requesterDate: "2026-05-30",
        targetId: "dC",
        targetDate: "2026-06-06",
      }),
    ).toEqual([
      {
        recordId: "r1",
        fields: { "Directors on Shift": ["dB", "dC"] },
      },
      {
        recordId: "r2",
        fields: { "Directors on Shift": ["dA"] },
      },
    ]);
  });

  it("throws if the requester's row is missing (caller should re-validate first)", () => {
    expect(() =>
      planApply({
        scheduleRows: baseRows,
        requesterId: "vZ",
        requesterDate: "2026-05-30",
      }),
    ).toThrow(/not assigned/i);
  });
});
