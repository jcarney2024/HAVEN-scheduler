export type PublicScheduleInput = {
  dept: { id: string; name: string; scheduleStatus: "Draft" | "Submitted"; submittedAt: string | null };
  peopleById: Map<string, { id: string; name: string }>;
  scheduleRows: Array<{ date: string; directorIds: string[]; volunteerIds: string[] }>;
};

export type PublicSchedule = {
  deptName: string;
  submittedAt: string | null;
  dates: Array<{
    date: string;
    directors: Array<{ name: string }>;
    volunteers: Array<{ name: string }>;
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
    .map((row) => ({
      date: row.date,
      directors: row.directorIds.map(lookup).filter((x): x is { name: string } => x !== null),
      volunteers: row.volunteerIds.map(lookup).filter((x): x is { name: string } => x !== null),
    }));

  return {
    deptName: dept.name,
    submittedAt: dept.submittedAt,
    dates,
  };
}
