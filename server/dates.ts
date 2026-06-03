export const CANONICAL_DATES = [
  "2026-05-30",
  "2026-06-06",
  "2026-06-13",
  "2026-06-20",
  "2026-06-27",
  "2026-07-04",
  "2026-07-11",
  "2026-07-18",
  "2026-07-25",
  "2026-08-01",
  "2026-08-08",
  "2026-08-15",
  "2026-08-22",
  "2026-08-29",
  "2026-09-05",
  "2026-09-12",
  "2026-09-19",
  "2026-09-26",
] as const;

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function parseFlexibleDateString(input: string): string | null {
  const trimmed = input.trim();

  // Real Airtable Date fields return ISO 8601 — "2026-06-06" for a date-only
  // field, or "2026-06-06T00:00:00.000Z" if the field carries a time. Take the
  // leading YYYY-MM-DD and validate against the canonical Saturdays. A wrong or
  // off-day value fails the canonical check rather than corrupting a shift.
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const iso = isoMatch[1];
    return (CANONICAL_DATES as readonly string[]).includes(iso) ? iso : null;
  }

  // Legacy display strings: "June 6th" / "June 6" (single-select / text fields).
  // Lookbehind: only strip the ordinal when it actually follows a digit.
  // Without it, the "st" at the end of "august" gets stripped too, turning
  // "august 1st" into "augu 1" and breaking every August date.
  const cleaned = trimmed.toLowerCase().replace(/(?<=\d)(st|nd|rd|th)\b/g, "");
  const match = cleaned.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (!match) return null;
  const month = MONTHS[match[1]];
  const day = parseInt(match[2], 10);
  if (month === undefined || Number.isNaN(day)) return null;
  const iso = `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return (CANONICAL_DATES as readonly string[]).includes(iso) ? iso : null;
}

export function normalizeVolunteerDate(input: string): string | null {
  return parseFlexibleDateString(input);
}

export function normalizeDirectorDate(input: string): string | null {
  return parseFlexibleDateString(input);
}

const SUFFIX = (day: number): string => {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function displayDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}${SUFFIX(d)}`;
}
