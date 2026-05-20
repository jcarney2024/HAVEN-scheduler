import type { Assignment } from "@/api/types";

export function StatsBar({
  assignments,
  doubleBookedCount,
}: {
  assignments: Assignment[];
  doubleBookedCount: number;
}) {
  const total = assignments.reduce(
    (sum, a) => sum + a.directorIds.length + a.volunteerIds.length,
    0,
  );
  const emptyDays = assignments.filter(
    (a) => a.directorIds.length === 0 && a.volunteerIds.length === 0,
  ).length;
  const avg = assignments.length > 0 ? (total / assignments.length).toFixed(1) : "0.0";

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
      <Stat label="Shifts assigned" value={String(total)} />
      <Stat label="Avg per Saturday" value={avg} />
      <Stat label="Saturdays with 0 assignments" value={String(emptyDays)} />
      <Stat label="People double-booked" value={String(doubleBookedCount)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-slate-500">{label}</div>
    </div>
  );
}
