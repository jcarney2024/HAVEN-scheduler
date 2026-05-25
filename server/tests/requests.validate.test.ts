import { describe, it, expect } from "vitest";
import { validateRequest, type ScheduleRowForValidation } from "../requests";

const rows: ScheduleRowForValidation[] = [
  { date: "2026-05-30", directorIds: ["dA"], volunteerIds: ["vA", "vB"] },
  { date: "2026-06-06", directorIds: ["dB"], volunteerIds: ["vA"] },
];

describe("validateRequest", () => {
  it("accepts a drop where the requester is assigned to that date", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a drop where the requester is not on that date", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vC",
        requesterDate: "2026-05-30",
      }),
    ).toEqual({ ok: false, error: "Not assigned to that shift" });
  });

  it("rejects a self-target (requester == target)", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "vA",
        targetDate: "2026-06-06",
      }),
    ).toEqual({ ok: false, error: "Partner is not eligible" });
  });

  it("accepts a named swap between two different volunteers", () => {
    const r: ScheduleRowForValidation[] = [
      { date: "2026-05-30", directorIds: [], volunteerIds: ["vA"] },
      { date: "2026-06-06", directorIds: [], volunteerIds: ["vB"] },
    ];
    expect(
      validateRequest({
        scheduleRows: r,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "vB",
        targetDate: "2026-06-06",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a named swap where the target is not on the target date", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "vB",
        targetDate: "2026-06-06",
      }),
    ).toEqual({ ok: false, error: "Partner is not eligible" });
  });

  it("rejects a named swap with mismatched roles (volunteer requester, director target)", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "dB",
        targetDate: "2026-06-06",
      }),
    ).toEqual({ ok: false, error: "Partner is not eligible" });
  });

  it("rejects when targetId is provided without targetDate", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
        targetId: "vB",
      }),
    ).toEqual({ ok: false, error: "Partner is not eligible" });
  });

  it("treats request as a drop when targetId and targetDate are both omitted", () => {
    expect(
      validateRequest({
        scheduleRows: rows,
        requesterId: "vA",
        requesterDate: "2026-05-30",
      }),
    ).toEqual({ ok: true });
  });

  describe("shadow shifts", () => {
    const shadowRows: ScheduleRowForValidation[] = [
      { date: "2026-05-30", directorIds: ["dA"], volunteerIds: ["vA"], shadowIds: ["sA"] },
      { date: "2026-06-06", directorIds: [], volunteerIds: ["vB"], shadowIds: ["sB"] },
    ];

    it("accepts a shadow drop (no target)", () => {
      expect(
        validateRequest({
          scheduleRows: shadowRows,
          requesterId: "sA",
          requesterDate: "2026-05-30",
        }),
      ).toEqual({ ok: true });
    });

    it("rejects a shadow named-swap with a clear message", () => {
      expect(
        validateRequest({
          scheduleRows: shadowRows,
          requesterId: "sA",
          requesterDate: "2026-05-30",
          targetId: "sB",
          targetDate: "2026-06-06",
        }),
      ).toEqual({ ok: false, error: "Shadow shifts can only be dropped, not swapped" });
    });

    it("rejects a regular volunteer trying to name a shadow as the swap target", () => {
      expect(
        validateRequest({
          scheduleRows: shadowRows,
          requesterId: "vA",
          requesterDate: "2026-05-30",
          targetId: "sB",
          targetDate: "2026-06-06",
        }),
      ).toEqual({ ok: false, error: "Partner is not eligible" });
    });
  });
});
