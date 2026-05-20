export type ScheduleEntry = {
  date: string; // ISO
  departmentId: string;
  departmentName: string;
  directorIds: string[];
  volunteerIds: string[];
};

export type Conflicts = {
  sameDay: { date: string; otherDept: string }[];
  crossTerm: { date: string; otherDept: string }[];
};

export function computeConflicts(opts: {
  personId: string;
  thisDepartmentId: string;
  allSchedule: ScheduleEntry[];
}): Conflicts {
  const { personId, thisDepartmentId, allSchedule } = opts;
  const isPresent = (e: ScheduleEntry) =>
    e.directorIds.includes(personId) || e.volunteerIds.includes(personId);

  // Dates on which the person is assigned in the caller's department.
  const thisDeptDates = new Set<string>();
  for (const entry of allSchedule) {
    if (entry.departmentId !== thisDepartmentId) continue;
    if (!isPresent(entry)) continue;
    thisDeptDates.add(entry.date);
  }

  const sameDay = new Map<string, Set<string>>(); // date → set of other dept names
  const crossTerm = new Map<string, Set<string>>();
  for (const entry of allSchedule) {
    if (entry.departmentId === thisDepartmentId) continue;
    if (!isPresent(entry)) continue;
    const target = thisDeptDates.has(entry.date) ? sameDay : crossTerm;
    if (!target.has(entry.date)) target.set(entry.date, new Set());
    target.get(entry.date)!.add(entry.departmentName);
  }

  const toList = (m: Map<string, Set<string>>) =>
    [...m.entries()]
      .flatMap(([date, depts]) => [...depts].map((otherDept) => ({ date, otherDept })))
      .sort((a, b) => a.date.localeCompare(b.date) || a.otherDept.localeCompare(b.otherDept));

  return { sameDay: toList(sameDay), crossTerm: toList(crossTerm) };
}
