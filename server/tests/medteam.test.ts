import { describe, it, expect } from "vitest";
import { parseCellCode, withRoleMembersOnShift } from "../medteam.js";

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
