import { describe, it, expect } from "vitest";
import { shapePublicSchedule } from "../public";

describe("shapePublicSchedule", () => {
  const dept = {
    id: "dep1",
    name: "SCTS",
  };
  const people = new Map([
    ["p1", { id: "p1", name: "Alice Director" }],
    ["p2", { id: "p2", name: "Bob Volunteer" }],
    ["p3", { id: "p3", name: "Cara Volunteer" }],
  ]);
  const scheduleRows = [
    { date: "2026-05-30", directorIds: ["p1"], volunteerIds: ["p2", "p3"] },
    { date: "2026-06-06", directorIds: ["p1"], volunteerIds: [] },
  ];

  it("returns dept name and dates with only names per role", () => {
    const out = shapePublicSchedule({ dept, peopleById: people, scheduleRows });

    expect(out).toEqual({
      deptName: "SCTS",
      dates: [
        {
          date: "2026-05-30",
          directors: [{ name: "Alice Director" }],
          volunteers: [{ name: "Bob Volunteer" }, { name: "Cara Volunteer" }],
        },
        {
          date: "2026-06-06",
          directors: [{ name: "Alice Director" }],
          volunteers: [],
        },
      ],
    });
  });

  it("skips assignees whose id is not in the people map (deleted person)", () => {
    const out = shapePublicSchedule({
      dept,
      peopleById: people,
      scheduleRows: [
        { date: "2026-05-30", directorIds: ["p1", "ghost"], volunteerIds: ["p2"] },
      ],
    });
    expect(out.dates[0].directors).toEqual([{ name: "Alice Director" }]);
  });

  it("sorts dates chronologically by ISO key", () => {
    const out = shapePublicSchedule({
      dept,
      peopleById: people,
      scheduleRows: [
        { date: "2026-06-06", directorIds: ["p1"], volunteerIds: [] },
        { date: "2026-05-30", directorIds: ["p1"], volunteerIds: [] },
      ],
    });
    expect(out.dates.map((d) => d.date)).toEqual(["2026-05-30", "2026-06-06"]);
  });

  it("omits a person with empty name", () => {
    const peopleWithBlank = new Map([
      ["p1", { id: "p1", name: "Alice" }],
      ["p2", { id: "p2", name: "" }],
    ]);
    const out = shapePublicSchedule({
      dept,
      peopleById: peopleWithBlank,
      scheduleRows: [
        { date: "2026-05-30", directorIds: ["p1"], volunteerIds: ["p2"] },
      ],
    });
    expect(out.dates[0].volunteers).toEqual([]);
  });

  it("appends shadow volunteers with shadow=true and leaves regulars unmarked", () => {
    const out = shapePublicSchedule({
      dept,
      peopleById: people,
      scheduleRows: [
        {
          date: "2026-05-30",
          directorIds: ["p1"],
          volunteerIds: ["p2"],
          shadowIds: ["p3"],
        },
      ],
    });
    expect(out.dates[0].volunteers).toEqual([
      { name: "Bob Volunteer" },
      { name: "Cara Volunteer", shadow: true },
    ]);
  });
});
