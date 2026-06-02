export type MedRole = "triage" | "walkin" | "cc";

export type DayCounts = {
  onShift: number;
  triage: number;
  walkin: number;
  shadow: number;
  spanish: number;
  patientsBooked: number | null;
};

export type DayConfig = {
  idealHeadcount: number | null;
  patientCapacityPerProvider: number | null;
};

export type Quota = "missing" | "ok" | "excess";

export type DayMetrics = {
  headcount: number;
  idealHeadcount: number | null;
  headcountStatus: "under" | "at" | "over" | "unknown";
  triageStatus: Quota;
  walkinStatus: Quota;
  shadowCount: number;
  spanishCount: number;
  maxPatientCapacity: number | null;
  patientsBooked: number | null;
  patientsToReschedule: number | null;
};

function quotaOf(n: number): Quota {
  return n === 0 ? "missing" : n === 1 ? "ok" : "excess";
}

export function computeDayMetrics(c: DayCounts, cfg: DayConfig): DayMetrics {
  const headcountStatus =
    cfg.idealHeadcount == null
      ? "unknown"
      : c.onShift < cfg.idealHeadcount
        ? "under"
        : c.onShift === cfg.idealHeadcount
          ? "at"
          : "over";
  const maxPatientCapacity =
    cfg.patientCapacityPerProvider == null ? null : cfg.patientCapacityPerProvider * c.onShift;
  const patientsToReschedule =
    c.patientsBooked != null && maxPatientCapacity != null ? c.patientsBooked - maxPatientCapacity : null;

  return {
    headcount: c.onShift,
    idealHeadcount: cfg.idealHeadcount,
    headcountStatus,
    triageStatus: quotaOf(c.triage),
    walkinStatus: quotaOf(c.walkin),
    shadowCount: c.shadow,
    spanishCount: c.spanish,
    maxPatientCapacity,
    patientsBooked: c.patientsBooked,
    patientsToReschedule,
  };
}

/** Which special roles a department uses. Empty for non-PCAR departments. */
export function rolesForDept(deptName: string): MedRole[] {
  if (deptName === "SCTP") return ["triage", "walkin"];
  if (deptName === "JCTP") return ["cc"];
  return [];
}
