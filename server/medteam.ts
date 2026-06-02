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
 */
export function parseCellCode(raw: string): CellAssignment | null {
  const code = raw.replace(/ /g, " ").trim().toUpperCase().replace(/\s+/g, "");
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
