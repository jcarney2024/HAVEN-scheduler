export type DepartmentRef = {
  id: string;
  name: string;
  scheduleStatus: "Draft" | "Submitted";
  submittedAt: string | null;
};

export type Person = {
  id: string;
  netid: string;
  name: string;
  available: string[]; // ISO dates
  /** True if the availability comes from a director-set override on All People, not the apps base. */
  availabilityOverridden?: boolean;
  conflicts: {
    sameDay: { date: string; otherDept: string }[];
    crossTerm: { date: string; otherDept: string }[];
  };
};

export type Assignment = {
  date: string; // ISO
  directorIds: string[];
  volunteerIds: string[];
};

export type ScheduleResponse = {
  callerIsDeptDirector: boolean;
  department: { id: string; name: string; scheduleStatus: string; submittedAt: string | null };
  dates: { iso: string; display: string }[];
  roster: { directors: Person[]; volunteers: Person[] };
  assignments: Assignment[];
};

export type DirectorIdentity = {
  person: { id: string; name: string; netid: string; email: string };
  /** True if the person is on ITCM or EXEC — has master edit access to every department. */
  isAdmin?: boolean;
  departments: DepartmentRef[];
};
