export type NonCompliantVolunteer = {
  id: string;
  name: string;
  /** Which items are missing. Non-empty. */
  missing: ("contract" | "training")[];
};

export type DepartmentRef = {
  id: string;
  name: string;
  pendingRequestCount: number;
  /** Volunteers in this department missing a contract and/or training.
   *  Empty array when everyone is compliant. */
  nonCompliantVolunteers: NonCompliantVolunteer[];
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
  /** Aggregated volunteer compliance from the HAVEN Management Compliance table.
   *  Volunteers only; null for directors. Missing flags appear as a "missing: …"
   *  badge next to the name in the scheduler. */
  compliance?: { contract: boolean; training: boolean } | null;
  /** True if the person self-identified as Spanish-speaking. */
  spanishSpeaking?: boolean;
  /** True if a returning volunteer (from application). */
  returning?: boolean;
  /** True if the person is a licensed RN (drives # RNs coverage + the depo flag). */
  licensedRN?: boolean;
  conflicts: {
    sameDay: { date: string; otherDept: string }[];
    crossTerm: { date: string; otherDept: string }[];
  };
};

export type Assignment = {
  date: string; // ISO
  directorIds: string[];
  volunteerIds: string[];
  /** Volunteers attending this Saturday in a shadow/observation role. */
  shadowIds: string[];
  /** Subset of on-shift ids attending remotely. */
  remoteIds: string[];
  /** Subset of volunteerIds designated the Triage SCTM (SCTP). */
  triageIds: string[];
  /** Subset of volunteerIds designated the Walk-in SCTM (SCTP). */
  walkinIds: string[];
  /** Subset of volunteerIds designated CC JCTM (JCTP). */
  ccIds: string[];
  /** Director-entered count of patients booked this Saturday. PHI-free aggregate;
   *  null when not entered. */
  patientsBooked: number | null;
};

export type ScheduleResponse = {
  callerIsDeptDirector: boolean;
  department: {
    id: string;
    name: string;
    /** Most recent /submit timestamp; null if never submitted. Informational
     *  only — the schedule is always editable and always public. */
    submittedAt: string | null;
    submittedByName: string | null;
    /** Per-day target headcount for the capacity dashboard; null if unset. */
    idealHeadcount: number | null;
    /** Patients one provider can see; max capacity = this × on-shift count. Null = no capacity math (e.g. JCTP). */
    patientCapacityPerProvider: number | null;
  };
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
  dates: Array<{
    date: string; // ISO Saturday key
    directors: Array<{ name: string; remote?: boolean }>;
    volunteers: Array<{ name: string; shadow?: boolean; remote?: boolean }>;
  }>;
};

export type MyAssignment = {
  deptId: string;
  deptName: string;
  date: string; // ISO
  role: "director" | "volunteer";
  /** True if this assignment is in the "Shadow Volunteers on Shift" list rather than the regular Volunteers list. */
  shadow?: boolean;
  /** True if this assignment is in the dept's "Remote on Shift" list. */
  remote?: boolean;
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

export type ProcedureStatus = "yes" | "no" | "unknown";
export type ProcedureKey = "iudIn" | "iudOut" | "nexplanon" | "gac" | "emb" | "seesMale";

export type Attending = {
  id: string;
  scheduleName: string;
  fullName: string;
  procedures: Record<ProcedureKey, ProcedureStatus>;
  notes?: string;
};

export type ClinicReadiness = {
  date: string;
  closed: boolean;
  attending: Attending | null;
  director: string | null;
  procedures: Record<ProcedureKey, ProcedureStatus>;
  coverage: { sctm: number; jctm: number; rn: number; spanish: number };
  depoOk: boolean;
  proceduresBooked: number | null;
  procedureCapWarning: boolean;
  emails: string[];
};

export type RhdReadinessResponse = {
  maxProceduresPerClinic: number;
  attendings: Attending[];
  clinics: ClinicReadiness[];
};

export type ComplianceCheckResponse =
  | { found: false }
  | {
      found: true;
      name: string;
      netid: string;
      contract: boolean;
      training: boolean;
      hipaaCompliant: boolean;
      overallCompliant: boolean;
    };
