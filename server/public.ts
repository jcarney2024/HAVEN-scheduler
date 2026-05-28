export type PublicScheduleInput = {
  dept: { id: string; name: string };
  peopleById: Map<string, { id: string; name: string }>;
  scheduleRows: Array<{
    date: string;
    directorIds: string[];
    volunteerIds: string[];
    shadowIds?: string[];
    remoteIds?: string[];
  }>;
};

export type PublicSchedule = {
  deptName: string;
  dates: Array<{
    date: string;
    directors: Array<{ name: string; remote?: boolean }>;
    /** Volunteers in alphabetical-ish order; shadow flag means observation role. */
    volunteers: Array<{ name: string; shadow?: boolean; remote?: boolean }>;
  }>;
};

export function shapePublicSchedule(input: PublicScheduleInput): PublicSchedule {
  const { dept, peopleById, scheduleRows } = input;

  const lookup = (id: string): { id: string; name: string } | null => {
    const p = peopleById.get(id);
    if (!p) return null;
    if (!p.name) return null;
    return { id: p.id, name: p.name };
  };

  const dates = [...scheduleRows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => {
      const remoteSet = new Set(row.remoteIds ?? []);
      const tagRemote = <T extends { id: string; name: string }>(p: T) =>
        remoteSet.has(p.id) ? { name: p.name, remote: true as const } : { name: p.name };

      const directors = row.directorIds
        .map(lookup)
        .filter((x): x is { id: string; name: string } => x !== null)
        .map(tagRemote);
      const regulars = row.volunteerIds
        .map(lookup)
        .filter((x): x is { id: string; name: string } => x !== null)
        .map((p) =>
          remoteSet.has(p.id) ? { name: p.name, remote: true as const } : { name: p.name },
        );
      const shadows = (row.shadowIds ?? [])
        .map(lookup)
        .filter((x): x is { id: string; name: string } => x !== null)
        .map((p) =>
          remoteSet.has(p.id)
            ? { name: p.name, shadow: true as const, remote: true as const }
            : { name: p.name, shadow: true as const },
        );
      return {
        date: row.date,
        directors,
        volunteers: [...regulars, ...shadows],
      };
    });

  return {
    deptName: dept.name,
    dates,
  };
}
