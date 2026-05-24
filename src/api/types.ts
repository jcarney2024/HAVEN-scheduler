export type DepartmentRef = {
  id: string;
  name: string;
  scheduleStatus: "Draft" | "Submitted";
  submittedAt: string | null;
  pendingRequestCount: number;
};

export type Person = {
  id: string;
  netid: string;
  name: string;
  available: string[]; // ISO dates
  /** True if the availability comes from a director-set override on All People, not the apps base. */
  availabilityOverridden?: boolean;
  /** ISO timestamp of the volunteer's most recent self-update via the public portal, or null. */
  volunteerUpdatedAt?: string | null;
  /** ISO timestamp a director acknowledged the volunteer's most recent self-update. */
  volunteerUpdateAcknowledgedAt?: string | null;
  /** Raw "Minimum Shifts Wanted" choice from Volunteer Training Attendance ("4"–"9+"). Volunteers only; null if no training record or no value set. */
  minShiftsWanted?: string | null;
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

export type PublicDeptListItem = {
  id: string;
  name: string;
};

export type PublicSchedule = {
  deptName: string;
  submittedAt: string | null;
  dates: Array<{
    date: string; // ISO Saturday key
    directors: Array<{ name: string }>;
    volunteers: Array<{ name: string }>;
  }>;
};

export type MyAssignment = {
  deptId: string;
  deptName: string;
  date: string; // ISO
  role: "director" | "volunteer";
  pendingRequestId: string | null;
};

export type MyAssignmentsResponse = {
  person: { id: string; name: string; netid: string; email: string };
  assignments: MyAssignment[];
  dates: { iso: string; display: string }[];
  volunteerAvailability: {
    /** What the volunteer would see as their own current choices: prior self-update or app baseline. */
    myDates: string[];
    source: "volunteer-updated" | "application" | "none";
    /** True if a director has manually overridden this volunteer's availability — their edits will be saved but not used. */
    directorOverrideActive: boolean;
    volunteerUpdatedAt: string | null;
  };
};

export type ShiftRequest = {
  id: string;
  type: "Drop" | "Named swap";
  requester: { id: string; name: string; netid: string; role: "director" | "volunteer" };
  requesterDate: string; // ISO
  target: { id: string; name: string; netid: string } | null;
  targetDate: string | null;
  note: string;
  status: "Pending" | "Approved" | "Rejected" | "Withdrawn";
  submittedAt: string;
  resolvedAt: string | null;
  resolver: { id: string; name: string } | null;
};

export type RequestsForDept = {
  pending: ShiftRequest[];
  recent: ShiftRequest[];
};
