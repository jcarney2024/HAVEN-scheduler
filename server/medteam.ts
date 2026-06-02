export type CellAssignment = {
  onShift: boolean;
  triage: boolean;
  walkin: boolean;
  cc: boolean;
  shadow: boolean;
  available: boolean;
};

function blank(): CellAssignment {
  return { onShift: false, triage: false, walkin: false, cc: false, shadow: false, available: false };
}

/**
 * Map a workbook cell code to a normalized role. Returns null for empty/blank
 * or unrecognized codes (callers distinguish the two by pre-checking emptiness).
 *
 * The final `\s+` strip removes ALL whitespace, including non-breaking spaces
 * (U+00A0) that Excel often leaves in cells, so "C + T" / "C + T" both
 * normalize to "C+T".
 */
export function parseCellCode(raw: string): CellAssignment | null {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return null;
  switch (code) {
    case "C": return { ...blank(), onShift: true };
    case "C+T": return { ...blank(), onShift: true, triage: true };
    case "W": return { ...blank(), onShift: true, walkin: true };
    case "CC": return { ...blank(), onShift: true, cc: true };
    case "S": return { ...blank(), shadow: true };
    case "A":
    case "A*": return { ...blank(), available: true };
    default: return null;
  }
}

/**
 * The invariant for writes: anyone designated a role (triage/walk-in/cc) must
 * also appear in Volunteers on Shift. Returns the union, deduplicated.
 */
export function withRoleMembersOnShift(volunteerIds: string[], roleLists: string[][]): string[] {
  const set = new Set(volunteerIds);
  for (const list of roleLists) for (const id of list) set.add(id);
  return [...set];
}

export type SheetPersonRow = {
  name: string;
  /** Already-lowercased match key recommended, but we lowercase defensively. */
  email: string;
  /** ISO date → raw cell code. */
  cells: Record<string, string>;
};

export type DayPlan = {
  onShift: string[];
  triage: string[];
  walkin: string[];
  cc: string[];
  shadow: string[];
};

export type ImportPlan = {
  emails: string[];
  perDate: Record<string, DayPlan>;
  unknownCells: { email: string; date: string; raw: string }[];
};

export function buildImportPlan(rows: SheetPersonRow[], dates: string[]): ImportPlan {
  const perDate: Record<string, DayPlan> = {};
  for (const d of dates) perDate[d] = { onShift: [], triage: [], walkin: [], cc: [], shadow: [] };

  const emails: string[] = [];
  const seen = new Set<string>();
  const unknownCells: { email: string; date: string; raw: string }[] = [];

  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
    for (const date of dates) {
      const raw = row.cells[date] ?? "";
      if (!raw.trim()) continue; // empty cell: skip (trim() also drops a lone non-breaking space)
      const cell = parseCellCode(raw);
      if (!cell) {
        unknownCells.push({ email, date, raw });
        continue;
      }
      const day = perDate[date];
      if (cell.shadow) day.shadow.push(email);
      if (cell.onShift) day.onShift.push(email);
      if (cell.triage) day.triage.push(email);
      if (cell.walkin) day.walkin.push(email);
      if (cell.cc) day.cc.push(email);
    }
  }

  return { emails, perDate, unknownCells };
}
