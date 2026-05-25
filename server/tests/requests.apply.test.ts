import { describe, it, expect } from "vitest";
import { planApply, executeApply, type ScheduleRowForApply } from "../requests";

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

  it("for a shadow drop, patches Shadow Volunteers on Shift", () => {
    const rows: ScheduleRowForApply[] = [
      { id: "r1", date: "2026-05-30", directorIds: [], volunteerIds: ["vA"], shadowIds: ["sA", "sB"] },
    ];
    expect(
      planApply({
        scheduleRows: rows,
        requesterId: "sA",
        requesterDate: "2026-05-30",
      }),
    ).toEqual([
      { recordId: "r1", fields: { "Shadow Volunteers on Shift": ["sB"] } },
    ]);
  });

  it("throws if a shadow named-swap somehow reaches planApply (validate should have caught it)", () => {
    const rows: ScheduleRowForApply[] = [
      { id: "r1", date: "2026-05-30", directorIds: [], volunteerIds: [], shadowIds: ["sA"] },
      { id: "r2", date: "2026-06-06", directorIds: [], volunteerIds: [], shadowIds: ["sB"] },
    ];
    expect(() =>
      planApply({
        scheduleRows: rows,
        requesterId: "sA",
        requesterDate: "2026-05-30",
        targetId: "sB",
        targetDate: "2026-06-06",
      }),
    ).toThrow(/shadow/i);
  });
});

describe("executeApply", () => {
  it("calls patchRecord for each op in order", async () => {
    const calls: Array<{ tableId: string; recordId: string; fields: Record<string, unknown> }> = [];
    const patchRecord = async (opts: { tableId: string; recordId: string; fields: Record<string, unknown> }) => {
      calls.push({ tableId: opts.tableId, recordId: opts.recordId, fields: opts.fields });
      return { id: opts.recordId, createdTime: "", fields: opts.fields } as any;
    };

    await executeApply({
      baseId: "appX",
      scheduleTableId: "tblS",
      ops: [
        { recordId: "r1", fields: { "Volunteers on Shift": ["vB"] } },
        { recordId: "r2", fields: { "Volunteers on Shift": ["vA"] } },
      ],
      originalRows: new Map([
        ["r1", { id: "r1", date: "x", directorIds: [], volunteerIds: ["vA", "vB"] }],
        ["r2", { id: "r2", date: "y", directorIds: [], volunteerIds: ["vC"] }],
      ]),
      patchRecord,
    });

    expect(calls.map((c) => c.recordId)).toEqual(["r1", "r2"]);
  });

  it("attempts rollback when a later op fails", async () => {
    const calls: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
    let opIndex = 0;
    const patchRecord = async (opts: { tableId: string; recordId: string; fields: Record<string, unknown> }) => {
      calls.push({ recordId: opts.recordId, fields: opts.fields });
      opIndex++;
      if (opIndex === 2) throw new Error("Airtable boom");
      return { id: opts.recordId, createdTime: "", fields: opts.fields } as any;
    };

    await expect(
      executeApply({
        baseId: "appX",
        scheduleTableId: "tblS",
        ops: [
          { recordId: "r1", fields: { "Volunteers on Shift": ["vB"] } },
          { recordId: "r2", fields: { "Volunteers on Shift": ["vA"] } },
        ],
        originalRows: new Map([
          ["r1", { id: "r1", date: "x", directorIds: [], volunteerIds: ["vA", "vB"] }],
          ["r2", { id: "r2", date: "y", directorIds: [], volunteerIds: ["vC"] }],
        ]),
        patchRecord,
      }),
    ).rejects.toThrow(/Airtable boom/);

    // 3 calls expected: forward(r1), forward(r2)=FAIL, rollback(r1) restoring original.
    expect(calls.length).toBe(3);
    expect(calls[0].recordId).toBe("r1");
    expect(calls[1].recordId).toBe("r2");
    expect(calls[2].recordId).toBe("r1");
    expect(calls[2].fields).toEqual({ "Volunteers on Shift": ["vA", "vB"] });
  });
});
