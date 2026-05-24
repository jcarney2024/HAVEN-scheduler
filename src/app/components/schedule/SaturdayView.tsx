import { useMemo, useState } from "react";
import type { Person, Assignment } from "@/api/types";
import { PersonRow } from "./PersonRow";
import { DateTabStrip } from "./DateTabStrip";

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
  onAcknowledgeVolunteerUpdate,
  readOnly = false,
}: {
  dates: { iso: string; display: string }[];
  directors: Person[];
  volunteers: Person[];
  assignments: Assignment[];
  disabled: boolean;
  editMode: "assign" | "shadow" | "availability";
  onToggle: (date: string, kind: Kind, personId: string) => void;
  onRemoveVolunteer?: (person: Person) => void;
  onAcknowledgeVolunteerUpdate?: (person: Person) => void;
  readOnly?: boolean;
}) {
  const [activeIso, setActiveIso] = useState(dates[0]?.iso ?? "");
  const assignmentByIso = useMemo(
    () => Object.fromEntries(assignments.map((a) => [a.date, a])),
    [assignments],
  );
  const active = assignmentByIso[activeIso] ?? { date: activeIso, directorIds: [], volunteerIds: [] };

  // Per-volunteer count of in-department shifts already assigned, derived from
  // the current assignments array so it updates live as the director toggles.
  // Includes shadow shifts so the "X / N" pill reflects total time commitment.
  const volunteerAssignedCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assignments) {
      for (const id of a.volunteerIds) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const id of a.shadowIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [assignments]);

  function tabHasAssignments(iso: string) {
    const a = assignmentByIso[iso];
    return !!a && (a.directorIds.length + a.volunteerIds.length > 0);
  }

  function column(title: string, people: Person[], kind: Kind, assignedIds: string[]) {
    // Per-row remove handler — volunteers only, never directors.
    const removeFor = (p: Person) =>
      !readOnly && kind === "volunteer" && onRemoveVolunteer ? () => onRemoveVolunteer(p) : undefined;
    const ackFor = (p: Person) =>
      !readOnly && kind === "volunteer" && onAcknowledgeVolunteerUpdate
        ? () => onAcknowledgeVolunteerUpdate(p)
        : undefined;

    const countFor = (p: Person) =>
      kind === "volunteer" ? volunteerAssignedCount.get(p.id) ?? 0 : undefined;

    if (editMode === "shadow") {
      // Shadow mode is volunteers-only; directors render as a static read-only
      // list so the director can still see who's on the shift for context.
      if (kind === "director") {
        return (
          <div>
            <h3 className="font-semibold text-slate-700 mb-2">{title}</h3>
            <div className="space-y-1 opacity-70">
              {people.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  isAvailable
                  isAssigned={assignedIds.includes(p.id)}
                  disabled={true}
                  editMode="assign"
                  readOnly
                  onToggle={() => {}}
                />
              ))}
            </div>
          </div>
        );
      }
      const shadowIds = active.shadowIds ?? [];
      const available = people.filter((p) => p.available.includes(activeIso));
      const unavailable = people.filter((p) => !p.available.includes(activeIso));
      return (
        <div>
          <h3 className="font-semibold text-slate-700 mb-2">
            Shadow Volunteers ({shadowIds.length} shadowing)
          </h3>
          <div className="space-y-1">
            {available.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                isAvailable
                isAssigned={shadowIds.includes(p.id)}
                disabled={disabled}
                editMode="assign"
                readOnly={readOnly}
                assignedCount={countFor(p)}
                onToggle={readOnly ? () => {} : () => onToggle(activeIso, kind, p.id)}
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
                    isAssigned={shadowIds.includes(p.id)}
                    disabled={disabled}
                    editMode="assign"
                    readOnly={readOnly}
                    assignedCount={countFor(p)}
                    onToggle={readOnly ? () => {} : () => onToggle(activeIso, kind, p.id)}
                    onRemove={removeFor(p)}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      );
    }

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
                isAvailable={readOnly ? true : p.available.includes(activeIso)}
                isAssigned={p.available.includes(activeIso)}
                disabled={disabled}
                editMode="availability"
                readOnly={readOnly}
                onToggle={readOnly ? () => {} : () => onToggle(activeIso, kind, p.id)}
                onRemove={removeFor(p)}
                onAcknowledgeUpdate={ackFor(p)}
              />
            ))}
          </div>
        </div>
      );
    }

    // assign mode (existing behavior)
    const available = people.filter((p) => p.available.includes(activeIso));
    const unavailable = people.filter((p) => !p.available.includes(activeIso));
    const shadowIds = active.shadowIds ?? [];
    const isShadowOn = (p: Person) => kind === "volunteer" && shadowIds.includes(p.id);

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
              readOnly={readOnly}
              assignedCount={countFor(p)}
              isShadow={isShadowOn(p)}
              onToggle={readOnly ? () => {} : () => onToggle(activeIso, kind, p.id)}
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
                  isAvailable={readOnly ? true : false}
                  isAssigned={assignedIds.includes(p.id)}
                  disabled={disabled}
                  editMode="assign"
                  readOnly={readOnly}
                  assignedCount={countFor(p)}
                  isShadow={isShadowOn(p)}
                  onToggle={readOnly ? () => {} : () => onToggle(activeIso, kind, p.id)}
                  onRemove={removeFor(p)}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  const tabs = dates.map((d) => ({
    iso: d.iso,
    display: d.display,
    hasDot: editMode === "assign" && tabHasAssignments(d.iso),
  }));

  return (
    <div className="space-y-6">
      <DateTabStrip tabs={tabs} activeIso={activeIso} onSelect={setActiveIso} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {column("Directors", directors, "director", active.directorIds)}
        {column("Volunteers", volunteers, "volunteer", active.volunteerIds)}
      </div>
    </div>
  );
}
