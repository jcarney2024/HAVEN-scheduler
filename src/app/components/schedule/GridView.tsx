import { useMemo } from "react";
import { X } from "lucide-react";
import type { Assignment, Person } from "@/api/types";

type Props = {
  dates: { iso: string; display: string }[];
  directors: Person[];
  volunteers: Person[];
  assignments: Assignment[];
  disabled: boolean;
  editMode: "assign" | "shadow" | "availability";
  onToggle: (date: string, kind: "director" | "volunteer", personId: string) => void;
  onRemoveVolunteer?: (person: Person) => void;
  onAcknowledgeVolunteerUpdate?: (person: Person) => void;
};

function hasUnacknowledgedUpdate(person: Person): boolean {
  if (!person.volunteerUpdatedAt) return false;
  if (!person.volunteerUpdateAcknowledgedAt) return true;
  return person.volunteerUpdateAcknowledgedAt < person.volunteerUpdatedAt;
}

function splitDisplay(display: string): { month: string; day: string } {
  // "May 30th" → { month: "May", day: "30" }
  const m = display.match(/^([A-Za-z]+)\s+(\d+)/);
  if (!m) return { month: display, day: "" };
  return { month: m[1].slice(0, 3), day: m[2] };
}

export function GridView({
  dates,
  directors,
  volunteers,
  assignments,
  disabled,
  editMode,
  onToggle,
  onRemoveVolunteer,
  onAcknowledgeVolunteerUpdate,
}: Props) {
  const byDate = useMemo(
    () => Object.fromEntries(assignments.map((a) => [a.date, a])),
    [assignments],
  );

  // Per-volunteer count of in-department shifts assigned. Updates live.
  // Includes shadow shifts so the pill matches SaturdayView.
  const volunteerAssignedCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assignments) {
      for (const id of a.volunteerIds) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const id of a.shadowIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [assignments]);

  function cell(person: Person, kind: "director" | "volunteer", iso: string) {
    const available = person.available.includes(iso);
    const a = byDate[iso];
    const regularIds = kind === "director" ? a?.directorIds ?? [] : a?.volunteerIds ?? [];
    const shadowIds = a?.shadowIds ?? [];
    const remoteIds = a?.remoteIds ?? [];
    const isShadow = kind === "volunteer" && shadowIds.includes(person.id);
    const isRegular = regularIds.includes(person.id);
    const isRemote = (isRegular || isShadow) && remoteIds.includes(person.id);

    if (editMode === "availability") {
      const sym = available ? "●" : "○";
      const color = available ? "text-amber-600" : "text-slate-300";
      return (
        <button
          disabled={disabled}
          onClick={() => onToggle(iso, kind, person.id)}
          className={`w-9 h-9 flex items-center justify-center text-sm rounded hover:bg-amber-50 disabled:cursor-not-allowed ${color}`}
          title={available ? "Available — click to mark unavailable" : "Not available — click to mark available"}
        >
          {sym}
        </button>
      );
    }

    if (editMode === "shadow") {
      // Directors don't shadow — render an inert dash in their rows.
      if (kind === "director") {
        return (
          <div className="w-9 h-9 flex items-center justify-center text-sm text-slate-300" aria-hidden>
            —
          </div>
        );
      }
      const sym = isShadow ? "◐" : available ? "○" : "—";
      const color = isShadow
        ? "text-purple-600"
        : available
        ? "text-slate-700"
        : "text-slate-300";
      return (
        <button
          disabled={disabled}
          onClick={() => onToggle(iso, kind, person.id)}
          className={`w-9 h-9 flex items-center justify-center text-sm rounded hover:bg-purple-50 disabled:cursor-not-allowed ${color}`}
          title={
            isShadow
              ? "Shadowing — click to remove"
              : available
              ? "Click to mark as shadow"
              : "Not available, but click to mark as shadow anyway"
          }
        >
          {sym}
        </button>
      );
    }

    // assign mode — shadows render as ◐ alongside regular ●, and remote
    // assignments render in sky blue (vs emerald for in-person) so the
    // director can spot the difference without flipping modes. Clicking
    // still toggles the regular assignment (use Saturday view to flip
    // remote / shadow).
    const sameDayConflict = person.conflicts.sameDay.some((c) => c.date === iso);
    const sym = isRegular ? "●" : isShadow ? "◐" : available ? "○" : "—";
    const color = sameDayConflict
      ? "text-red-600"
      : isRegular && isRemote
      ? "text-sky-600"
      : isRegular
      ? "text-emerald-600"
      : isShadow && isRemote
      ? "text-fuchsia-600"
      : isShadow
      ? "text-purple-600"
      : available
      ? "text-slate-700"
      : "text-slate-300";

    return (
      <button
        disabled={disabled}
        onClick={() => onToggle(iso, kind, person.id)}
        className={`w-9 h-9 flex items-center justify-center text-sm rounded hover:bg-slate-100 disabled:cursor-not-allowed ${color}`}
        title={
          sameDayConflict
            ? "Same-day conflict in another dept"
            : isRegular && isRemote
            ? "Assigned (remote) — use Saturday view to flip in person / remote"
            : isRegular
            ? "Assigned (in person)"
            : isShadow && isRemote
            ? "Shadowing remotely — use Saturday view to edit"
            : isShadow
            ? "Shadowing — use Shadow mode to edit"
            : available
            ? "Available"
            : "Not available"
        }
      >
        {sym}
      </button>
    );
  }

  function row(person: Person, kind: "director" | "volunteer") {
    const canRemove = kind === "volunteer" && !!onRemoveVolunteer && !disabled;
    const showUpdated = kind === "volunteer" && hasUnacknowledgedUpdate(person);
    const updatedTooltip = person.volunteerUpdatedAt
      ? `Volunteer updated their availability on ${new Date(
          person.volunteerUpdatedAt,
        ).toLocaleDateString()}. Click to acknowledge.`
      : "Volunteer updated their availability.";
    return (
      <tr key={person.id} className="group border-b border-slate-100 last:border-b-0">
        <th
          scope="row"
          className="text-left sticky left-0 bg-white pr-2 py-1 text-sm font-normal whitespace-nowrap min-w-[160px] max-w-[220px]"
          title={person.name || person.netid}
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate flex-1">{person.name || person.netid}</span>
            {kind === "volunteer" &&
              editMode === "assign" &&
              person.minShiftsWanted != null && (
                <span
                  className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1 py-0.5 rounded tabular-nums shrink-0"
                  title={`Wants at least ${person.minShiftsWanted} shift${person.minShiftsWanted === "1" ? "" : "s"} this term. Currently assigned to ${volunteerAssignedCount.get(person.id) ?? 0} in this department.`}
                >
                  {volunteerAssignedCount.get(person.id) ?? 0} / {person.minShiftsWanted}
                </span>
              )}
            {showUpdated && (
              <button
                type="button"
                onClick={() =>
                  onAcknowledgeVolunteerUpdate && onAcknowledgeVolunteerUpdate(person)
                }
                disabled={!onAcknowledgeVolunteerUpdate}
                className="text-[10px] uppercase tracking-wide text-yellow-900 bg-yellow-200 hover:bg-yellow-300 disabled:hover:bg-yellow-200 disabled:cursor-default px-1.5 py-0.5 rounded font-semibold"
                title={updatedTooltip}
              >
                updated
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                onClick={() => onRemoveVolunteer!(person)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-slate-400 hover:text-red-600 p-0.5"
                title="Remove from department"
                aria-label="Remove from department"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </th>
        {dates.map((d) => (
          <td key={d.iso} className="text-center px-0.5">
            {cell(person, kind, d.iso)}
          </td>
        ))}
      </tr>
    );
  }

  function sectionRow(label: string) {
    return (
      <tr>
        <td
          className="text-xs font-semibold text-slate-500 uppercase tracking-wider pt-4 pb-1 sticky left-0 bg-white"
          colSpan={dates.length + 1}
        >
          {label}
        </td>
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="border-collapse">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="sticky left-0 bg-white min-w-[160px]"></th>
            {dates.map((d) => {
              const { month, day } = splitDisplay(d.display);
              return (
                <th
                  key={d.iso}
                  className="px-0.5 pb-2 font-medium text-slate-500 text-center align-bottom"
                >
                  <div className="flex flex-col items-center leading-tight">
                    <span className="text-[10px] uppercase tracking-wide">{month}</span>
                    <span className="text-sm font-semibold text-slate-700">{day}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sectionRow("Directors")}
          {directors.length === 0 ? (
            <tr>
              <td colSpan={dates.length + 1} className="text-sm text-slate-400 italic py-2 sticky left-0 bg-white">
                No directors on this department's roster.
              </td>
            </tr>
          ) : (
            directors.map((p) => row(p, "director"))
          )}
          {sectionRow("Volunteers")}
          {volunteers.length === 0 ? (
            <tr>
              <td colSpan={dates.length + 1} className="text-sm text-slate-400 italic py-2 sticky left-0 bg-white">
                No volunteers on this department's roster.
              </td>
            </tr>
          ) : (
            volunteers.map((p) => row(p, "volunteer"))
          )}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 mt-3">
        {editMode === "availability" ? (
          <>
            <span className="text-amber-600">●</span> available &nbsp; ○ not
            available &nbsp; — click any cell to toggle the person's availability
            for that Saturday.
          </>
        ) : editMode === "shadow" ? (
          <>
            <span className="text-purple-600">◐</span> shadowing &nbsp; ○ available &nbsp; — not available &nbsp;
            — click a volunteer cell to toggle shadow status.
          </>
        ) : (
          <>
            <span className="text-emerald-600">●</span> in person &nbsp;{" "}
            <span className="text-sky-600">●</span> remote &nbsp;{" "}
            <span className="text-purple-600">◐</span> shadowing &nbsp; ○ available &nbsp; — not available &nbsp;{" "}
            <span className="text-red-600">●/○ in red</span> = same-day conflict
            in another dept
          </>
        )}
      </p>
    </div>
  );
}
