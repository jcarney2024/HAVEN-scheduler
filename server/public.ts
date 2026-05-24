export type PublicScheduleInput = {
  dept: { id: string; name: string; scheduleStatus: "Draft" | "Submitted"; submittedAt: string | null };
  peopleById: Map<string, { id: string; name: string }>;
  scheduleRows: Array<{
    date: string;
    directorIds: string[];
    volunteerIds: string[];
    shadowIds?: string[];
  }>;
};

export type PublicSchedule = {
  deptName: string;
  submittedAt: string | null;
  dates: Array<{
    date: string;
    directors: Array<{ name: string }>;
    /** Volunteers in alphabetical-ish order; shadow flag means observation role. */
    volunteers: Array<{ name: string; shadow?: boolean }>;
  }>;
};

export function shapePublicSchedule(input: PublicScheduleInput): PublicSchedule {
  const { dept, peopleById, scheduleRows } = input;

  const lookup = (id: string): { name: string } | null => {
    const p = peopleById.get(id);
    if (!p) return null;
    if (!p.name) return null;
    return { name: p.name };
  };

  const dates = [...scheduleRows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => {
      const directors = row.directorIds.map(lookup).filter((x): x is { name: string } => x !== null);
      const regulars = row.volunteerIds
        .map(lookup)
        .filter((x): x is { name: string } => x !== null)
        .map((p) => ({ name: p.name }));
      const shadows = (row.shadowIds ?? [])
        .map(lookup)
        .filter((x): x is { name: string } => x !== null)
        .map((p) => ({ name: p.name, shadow: true as const }));
      return {
        date: row.date,
        directors,
        volunteers: [...regulars, ...shadows],
      };
    });

  return {
    deptName: dept.name,
    submittedAt: dept.submittedAt,
    dates,
  };
}
