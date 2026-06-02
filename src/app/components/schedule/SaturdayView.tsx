import { useMemo, useState } from "react";
import type { Person, Assignment } from "@/api/types";
import { PersonRow } from "./PersonRow";
import { DateTabStrip } from "./DateTabStrip";
import type { MedRole } from "./capacity";
import { CapacityPanel, type CapacityConfig } from "./CapacityPanel";

type Kind = "director" | "volunteer";

export function SaturdayView({
  dates,
  directors,
  volunteers,
  assignments,
  disabled,
  editMode,
  onToggle,
  onToggleRemote,
  roles = [],
  onCycleRole,
  capacity,
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
  /** Optional. When provided + person is currently assigned, an "In person /
   *  Remote" pill appears next to their name in assign mode. */
  onToggleRemote?: (date: string, kind: Kind, personId: string) => void;
  /** Special clinical roles available for this dept (assign mode). Empty hides role controls. */
  roles?: MedRole[];
  /** Cycle a volunteer's clinical role on the active date. */
  onCycleRole?: (date: string, personId: string) => void;
  /** When provided (assign mode), renders the per-Saturday capacity panel. */
  capacity?: CapacityConfig;
  onRemoveVolunteer?: (person: Person) => void;
  onAcknowledgeVolunteerUpdate?: (person: Person) => void;
  readOnly?: boolean;
}) {
  const [activeIso, setActiveIso] = useState(dates[0]?.iso ?? "");
  const assignmentByIso = useMemo(
    () => Object.fromEntries(assignments.map((a) => [a.date, a])),
    [assignments],
  );
  const active = assignmentByIso[activeIso] ?? {
    date: activeIso,
    directorIds: [],
    volunteerIds: [],
    shadowIds: [],
    remoteIds: [],
    triageIds: [],
    walkinIds: [],
    ccIds: [],
    patientsBooked: null,
  };

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

  const roleTallyById = useMemo(() => {
    const t = new Map<string, { triage: number; walkin: number; cc: number }>();
    const bump = (id: string, key: "triage" | "walkin" | "cc") => {
      const cur = t.get(id) ?? { triage: 0, walkin: 0, cc: 0 };
      cur[key] += 1;
      t.set(id, cur);
    };
    for (const a of assignments) {
      for (const id of a.triageIds ?? []) bump(id, "triage");
      for (const id of a.walkinIds ?? []) bump(id, "walkin");
      for (const id of a.ccIds ?? []) bump(id, "cc");
    }
    return t;
  }, [assignments]);

  function roleTallyFor(p: Person): string | undefined {
    const t = roleTallyById.get(p.id);
    if (!t) return undefined;
    const parts: string[] = [];
    if (roles.includes("triage") && t.triage) parts.push(`Triage ${t.triage}`);
    if (roles.includes("walkin") && t.walkin) parts.push(`Walk-in ${t.walkin}`);
    if (roles.includes("cc") && t.cc) parts.push(`CC ${t.cc}`);
    return parts.length ? parts.join(" · ") : undefined;
  }

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
    const remoteIds = active.remoteIds ?? [];
    const isShadowOn = (p: Person) => kind === "volunteer" && shadowIds.includes(p.id);
    const isRemoteOn = (p: Person) => remoteIds.includes(p.id);
    const remoteHandler = (p: Person) =>
      !readOnly && onToggleRemote ? () => onToggleRemote(activeIso, kind, p.id) : undefined;

    // In read-only mode (public viewer), "available" really means "assigned for
    // this Saturday" — the public schedule data carries no separate availability
    // signal. Skip the "not available this date" disclosure and use plainer copy.
    const heading = readOnly
      ? `${title} (${available.length} on shift)`
      : `${title} (${available.length} of ${people.length} available)`;

    return (
      <div>
        <h3 className="font-semibold text-slate-700 mb-2">{heading}</h3>
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
              isRemote={isRemoteOn(p)}
              onToggleRemote={remoteHandler(p)}
              role={
                active.triageIds?.includes(p.id)
                  ? "triage"
                  : active.walkinIds?.includes(p.id)
                    ? "walkin"
                    : active.ccIds?.includes(p.id)
                      ? "cc"
                      : "clinic"
              }
              roleCycle={kind === "volunteer" ? roles : undefined}
              roleTally={kind === "volunteer" ? roleTallyFor(p) : undefined}
              onCycleRole={
                kind === "volunteer" && !readOnly && onCycleRole
                  ? () => onCycleRole(activeIso, p.id)
                  : undefined
              }
              onToggle={readOnly ? () => {} : () => onToggle(activeIso, kind, p.id)}
              onRemove={removeFor(p)}
            />
          ))}
        </div>
        {!readOnly && unavailable.length > 0 && (
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
                  readOnly={readOnly}
                  assignedCount={countFor(p)}
                  isShadow={isShadowOn(p)}
                  isRemote={isRemoteOn(p)}
                  onToggleRemote={remoteHandler(p)}
                  role={
                    active.triageIds?.includes(p.id)
                      ? "triage"
                      : active.walkinIds?.includes(p.id)
                        ? "walkin"
                        : active.ccIds?.includes(p.id)
                          ? "cc"
                          : "clinic"
                  }
                  roleCycle={kind === "volunteer" ? roles : undefined}
                  roleTally={kind === "volunteer" ? roleTallyFor(p) : undefined}
                  onCycleRole={
                    kind === "volunteer" && !readOnly && onCycleRole
                      ? () => onCycleRole(activeIso, p.id)
                      : undefined
                  }
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

  const tabs = dates.map((d) => ({
    iso: d.iso,
    display: d.display,
    hasDot: editMode === "assign" && tabHasAssignments(d.iso),
  }));

  return (
    <div className="space-y-6">
      <DateTabStrip tabs={tabs} activeIso={activeIso} onSelect={setActiveIso} />

      {editMode === "assign" && capacity && (
        <CapacityPanel
          assignment={active as Assignment}
          volunteers={volunteers}
          roles={roles}
          config={capacity}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {column("Directors", directors, "director", active.directorIds)}
        {column("Volunteers", volunteers, "volunteer", active.volunteerIds)}
      </div>
    </div>
  );
}
