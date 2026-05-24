import { describe, expect, it } from "vitest";
import {
  CANONICAL_DATES,
  normalizeVolunteerDate,
  normalizeDirectorDate,
  displayDate,
} from "../dates";

describe("CANONICAL_DATES", () => {
  it("has 18 entries spanning May 30 → September 26", () => {
    expect(CANONICAL_DATES.length).toBe(18);
    expect(CANONICAL_DATES[0]).toBe("2026-05-30");
    expect(CANONICAL_DATES[17]).toBe("2026-09-26");
  });

  it("is sorted ascending", () => {
    const sorted = [...CANONICAL_DATES].sort();
    expect(CANONICAL_DATES).toEqual(sorted);
  });
});

describe("normalizeVolunteerDate", () => {
  it("maps 'June 6th' to ISO", () => {
    expect(normalizeVolunteerDate("June 6th")).toBe("2026-06-06");
  });
  it("maps 'May 30th' to ISO", () => {
    expect(normalizeVolunteerDate("May 30th")).toBe("2026-05-30");
  });
  it("maps 'September 26th' to ISO", () => {
    expect(normalizeVolunteerDate("September 26th")).toBe("2026-09-26");
  });
  // Regression: "august" ends in "st", so a naive ordinal-strip regex
  // turns "august 1st" into "augu 1" and parsing fails. Cover every August
  // Saturday so this can't slip back in.
  it.each(["August 1st", "August 8th", "August 15th", "August 22nd", "August 29th"])(
    "round-trips %s",
    (display) => {
      const iso = normalizeVolunteerDate(display);
      expect(iso).not.toBeNull();
      expect(displayDate(iso as string)).toBe(display);
    },
  );
  it("returns null for unknown input", () => {
    expect(normalizeVolunteerDate("Easter")).toBeNull();
  });
});

describe("normalizeDirectorDate", () => {
  it("maps 'June 6' to ISO", () => {
    expect(normalizeDirectorDate("June 6")).toBe("2026-06-06");
  });
  it("maps 'May 30th' to ISO too (accepts either suffix style)", () => {
    expect(normalizeDirectorDate("May 30th")).toBe("2026-05-30");
  });
  it("returns null for unknown input", () => {
    expect(normalizeDirectorDate("Halloween")).toBeNull();
  });
});

describe("displayDate", () => {
  it("formats ISO to 'May 30th'", () => {
    expect(displayDate("2026-05-30")).toBe("May 30th");
  });
  it("formats ISO to 'June 6th'", () => {
    expect(displayDate("2026-06-06")).toBe("June 6th");
  });
  it("formats ISO to 'July 1st'", () => {
    expect(displayDate("2026-07-01")).toBe("July 1st");
  });
});
