import { useMemo, useState } from "react";
import type { Person, Assignment } from "@/api/types";
import { PersonRow } from "./PersonRow";

type Kind = "director" | "volunteer";

export function SaturdayView({
  dates,
  directors,
  volunteers,
  assignments,
  disabled,
  editMode,
  onToggle,
  onRemoveVolunteer,
}: {
  dates: { iso: string; display: string }[];
  directors: Person[];
  volunteers: Person[];
  assignments: Assignment[];
  disabled: boolean;
  editMode: "assign" | "availability";
  onToggle: (date: string, kind: Kind, personId: string) => void;
  onRemoveVolunteer?: (person: Person) => void;
}) {
  const [activeIso, setActiveIso] = useState(dates[0]?.iso ?? "");
  const assignmentByIso = useMemo(
    () => Object.fromEntries(assignments.map((a) => [a.date, a])),
    [assignments],
  );
  const active = assignmentByIso[activeIso] ?? { date: activeIso, directorIds: [], volunteerIds: [] };

  function tabHasAssignments(iso: string) {
    const a = assignmentByIso[iso];
    return !!a && (a.directorIds.length + a.volunteerIds.length > 0);
  }

  function column(title: string, people: Person[], kind: Kind, assignedIds: string[]) {
    // Per-row remove handler — volunteers only, never directors.
    const removeFor = (p: Person) =>
      kind === "volunteer" && onRemoveVolunteer ? () => onRemoveVolunteer(p) : undefined;

    if (editMode === "availability") {
      // Show everyone, checkbox = availability for active date.
      return (
        <div>
          <h3 className="font-semibold text-slate-700 mb-2">
            {title} ({people.filter((p) => p.available.includes(activeIso)).length} of {people.length} available)
          </h3>
          <div className="space-y-1">
            {people.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                isAvailable={p.available.includes(activeIso)}
                isAssigned={p.available.includes(activeIso)}
                disabled={disabled}
                editMode="availability"
                onToggle={() => onToggle(activeIso, kind, p.id)}
                onRemove={removeFor(p)}
              />
            ))}
          </div>
        </div>
      );
    }

    // assign mode (existing behavior)
    const available = people.filter((p) => p.available.includes(activeIso));
    const unavailable = people.filter((p) => !p.available.includes(activeIso));

    return (
      <div>
        <h3 className="font-semibold text-slate-700 mb-2">
          {title} ({available.length} of {people.length} available)
        </h3>
        <div className="space-y-1">
          {available.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              isAvailable
              isAssigned={assignedIds.includes(p.id)}
              disabled={disabled}
              editMode="assign"
              onToggle={() => onToggle(activeIso, kind, p.id)}
              onRemove={removeFor(p)}
            />
          ))}
        </div>
        {unavailable.length > 0 && (
          <details className="mt-3">
            <summary className="text-sm text-slate-500 cursor-pointer">
              {unavailable.length} not available this date
            </summary>
            <div className="space-y-1 mt-2">
              {unavailable.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  isAvailable={false}
                  isAssigned={assignedIds.includes(p.id)}
                  disabled={disabled}
                  editMode="assign"
                  onToggle={() => onToggle(activeIso, kind, p.id)}
                  onRemove={removeFor(p)}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto pb-2">
        {dates.map((d) => (
          <button
            key={d.iso}
            onClick={() => setActiveIso(d.iso)}
            className={`flex-shrink-0 px-3 py-1.5 text-sm rounded-full border transition-colors ${
              activeIso === d.iso
                ? "bg-[#0F4D92] text-white border-[#0F4D92]"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {d.display}
            {editMode === "assign" && tabHasAssignments(d.iso) && (
              <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {column("Directors", directors, "director", active.directorIds)}
        {column("Volunteers", volunteers, "volunteer", active.volunteerIds)}
      </div>
    </div>
  );
}
