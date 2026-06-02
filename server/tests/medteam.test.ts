import { describe, it, expect } from "vitest";
import { parseCellCode, withRoleMembersOnShift, buildImportPlan } from "../medteam.js";

describe("parseCellCode", () => {
  it("maps clinic and role codes", () => {
    expect(parseCellCode("C")).toEqual({ onShift: true, triage: false, walkin: false, cc: false, shadow: false, available: false });
    expect(parseCellCode("C+T")).toEqual({ onShift: true, triage: true, walkin: false, cc: false, shadow: false, available: false });
    expect(parseCellCode("W")).toEqual({ onShift: true, triage: false, walkin: true, cc: false, shadow: false, available: false });
    expect(parseCellCode("CC")).toEqual({ onShift: true, triage: false, walkin: false, cc: true, shadow: false, available: false });
    expect(parseCellCode("S")).toEqual({ onShift: false, triage: false, walkin: false, cc: false, shadow: true, available: false });
  });
  it("treats A / A* as available-only", () => {
    expect(parseCellCode("A")?.available).toBe(true);
    expect(parseCellCode("A*")?.available).toBe(true);
    expect(parseCellCode("A")?.onShift).toBe(false);
  });
  it("normalizes whitespace, case, and non-breaking spaces", () => {
    expect(parseCellCode(" c + t ")?.triage).toBe(true);
    expect(parseCellCode("c ")?.onShift).toBe(true);
  });
  it("returns null for empty or unknown codes", () => {
    expect(parseCellCode("")).toBeNull();
    expect(parseCellCode("   ")).toBeNull();
    expect(parseCellCode("X")).toBeNull();
  });
});

describe("withRoleMembersOnShift", () => {
  it("adds any role member missing from the on-shift list", () => {
    expect(withRoleMembersOnShift(["a"], [["b"], ["c"]]).sort()).toEqual(["a", "b", "c"]);
  });
  it("deduplicates and preserves existing members", () => {
    expect(withRoleMembersOnShift(["a", "b"], [["b"]]).sort()).toEqual(["a", "b"]);
  });
  it("handles empty role lists", () => {
    expect(withRoleMembersOnShift(["a"], [])).toEqual(["a"]);
  });
});

describe("buildImportPlan", () => {
  const dates = ["2026-05-30", "2026-06-06"];
  const rows = [
    { name: "Aa", email: "AA@yale.edu", cells: { "2026-05-30": "C+T", "2026-06-06": "A" } },
    { name: "Bb", email: "bb@yale.edu", cells: { "2026-05-30": "W", "2026-06-06": "S" } },
    { name: "Cc", email: "cc@yale.edu", cells: { "2026-05-30": "Z" } }, // unknown code
  ];

  it("lowercases and collects all roster emails", () => {
    expect(buildImportPlan(rows, dates).emails).toEqual(["aa@yale.edu", "bb@yale.edu", "cc@yale.edu"]);
  });
  it("routes codes into per-date role buckets; A contributes nothing", () => {
    const p = buildImportPlan(rows, dates);
    expect(p.perDate["2026-05-30"]).toEqual({
      onShift: ["aa@yale.edu", "bb@yale.edu"],
      triage: ["aa@yale.edu"],
      walkin: ["bb@yale.edu"],
      cc: [],
      shadow: [],
    });
    expect(p.perDate["2026-06-06"]).toEqual({
      onShift: [], triage: [], walkin: [], cc: [], shadow: ["bb@yale.edu"],
    });
  });
  it("reports unknown non-empty cells", () => {
    expect(buildImportPlan(rows, dates).unknownCells).toEqual([
      { email: "cc@yale.edu", date: "2026-05-30", raw: "Z" },
    ]);
  });
});
