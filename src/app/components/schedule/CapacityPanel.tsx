import type { Assignment, Person } from "@/api/types";
import { computeDayMetrics, type MedRole } from "./capacity";

export type CapacityConfig = {
  idealHeadcount: number | null;
  patientCapacityPerProvider: number | null;
  /** (date, value) — value is null when the input is cleared. */
  onPatientsBooked?: (date: string, value: number | null) => void;
};

const QUOTA_CLASS = {
  missing: "text-red-700",
  excess: "text-amber-700",
  ok: "text-emerald-700",
} as const;

export function CapacityPanel({
  assignment,
  volunteers,
  roles,
  config,
}: {
  assignment: Assignment;
  volunteers: Person[];
  roles: MedRole[];
  config: CapacityConfig;
}) {
  const spanishIds = new Set(volunteers.filter((p) => p.spanishSpeaking).map((p) => p.id));
  const m = computeDayMetrics(
    {
      onShift: assignment.volunteerIds.length,
      triage: assignment.triageIds.length,
      walkin: assignment.walkinIds.length,
      shadow: assignment.shadowIds.length,
      spanish: assignment.volunteerIds.filter((id) => spanishIds.has(id)).length,
      patientsBooked: assignment.patientsBooked,
    },
    { idealHeadcount: config.idealHeadcount, patientCapacityPerProvider: config.patientCapacityPerProvider },
  );

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <span>
        <strong className="tabular-nums">{m.headcount}</strong>
        {m.idealHeadcount != null ? ` / ${m.idealHeadcount}` : ""} on shift
        {m.headcountStatus === "under" && <span className="text-amber-700"> (under)</span>}
        {m.headcountStatus === "over" && <span className="text-amber-700"> (over)</span>}
      </span>
      {roles.includes("triage") && (
        <span className={QUOTA_CLASS[m.triageStatus]}>Triage: {assignment.triageIds.length}</span>
      )}
      {roles.includes("walkin") && (
        <span className={QUOTA_CLASS[m.walkinStatus]}>Walk-in: {assignment.walkinIds.length}</span>
      )}
      {roles.includes("cc") && <span>CC: {assignment.ccIds.length}</span>}
      <span>Shadow: {m.shadowCount}</span>
      <span>Spanish: {m.spanishCount}</span>
      {m.maxPatientCapacity != null && (
        <span>
          Max capacity: <strong className="tabular-nums">{m.maxPatientCapacity}</strong>
        </span>
      )}
      {m.maxPatientCapacity != null && (
        <label className="flex items-center gap-1">
          Patients booked:
          <input
            type="number"
            min={0}
            step={1}
            value={m.patientsBooked ?? ""}
            disabled={!config.onPatientsBooked}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return config.onPatientsBooked?.(assignment.date, null);
              const n = e.target.valueAsNumber;
              if (!Number.isFinite(n) || n < 0) return;
              config.onPatientsBooked?.(assignment.date, Math.trunc(n));
            }}
            className="w-16 border border-slate-300 rounded px-1 py-0.5 tabular-nums"
          />
        </label>
      )}
      {m.patientsToReschedule != null && m.patientsToReschedule > 0 && (
        <span className="text-red-700">To reschedule: {m.patientsToReschedule}</span>
      )}
      <span className="basis-full text-[11px] text-slate-400">Note: ≥3 shifts required to volunteer.</span>
    </div>
  );
}
