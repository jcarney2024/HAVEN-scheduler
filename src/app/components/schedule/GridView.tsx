import { useMemo } from "react";
import type { Assignment, Person } from "@/api/types";

type Props = {
  dates: { iso: string; display: string }[];
  directors: Person[];
  volunteers: Person[];
  assignments: Assignment[];
  disabled: boolean;
  onToggle: (date: string, kind: "director" | "volunteer", personId: string) => void;
};

export function GridView({ dates, directors, volunteers, assignments, disabled, onToggle }: Props) {
  const byDate = useMemo(
    () => Object.fromEntries(assignments.map((a) => [a.date, a])),
    [assignments],
  );

  function cell(person: Person, kind: "director" | "volunteer", iso: string) {
    const a = byDate[iso];
    const assignedIds = kind === "director" ? a?.directorIds ?? [] : a?.volunteerIds ?? [];
    const assigned = assignedIds.includes(person.id);
    const available = person.available.includes(iso);
    const sameDayConflict = person.conflicts.sameDay.some((c) => c.date === iso);
    const sym = assigned ? "●" : available ? "○" : "—";
    const color = sameDayConflict
      ? "text-red-600"
      : assigned
      ? "text-emerald-600"
      : available
      ? "text-slate-700"
      : "text-slate-300";

    return (
      <button
        key={`${person.id}-${iso}`}
        disabled={disabled}
        onClick={() => onToggle(iso, kind, person.id)}
        className={`w-8 h-8 flex items-center justify-center text-sm rounded hover:bg-slate-100 disabled:cursor-not-allowed ${color}`}
        title={
          sameDayConflict
            ? "Same-day conflict in another dept"
            : assigned
            ? "Assigned"
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
    return (
      <tr key={person.id}>
        <th scope="row" className="text-left sticky left-0 bg-white pr-3 py-1 text-sm font-normal">
          {person.name || person.netid}
        </th>
        {dates.map((d) => (
          <td key={d.iso} className="text-center">
            {cell(person, kind, d.iso)}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left sticky left-0 bg-white pr-3 pb-2"></th>
            {dates.map((d) => (
              <th key={d.iso} className="px-1 pb-2 font-medium text-slate-500">
                <div className="rotate-[-60deg] origin-bottom-left w-8 whitespace-nowrap">
                  {d.display}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-xs font-semibold text-slate-500 pt-2 pb-1" colSpan={dates.length + 1}>
              Directors
            </td>
          </tr>
          {directors.map((p) => row(p, "director"))}
          <tr>
            <td className="text-xs font-semibold text-slate-500 pt-3 pb-1" colSpan={dates.length + 1}>
              Volunteers
            </td>
          </tr>
          {volunteers.map((p) => row(p, "volunteer"))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 mt-3">
        ● assigned &nbsp; ○ available &nbsp; — not available &nbsp; <span className="text-red-600">●/○ in red</span> = same-day conflict in another dept
      </p>
    </div>
  );
}
