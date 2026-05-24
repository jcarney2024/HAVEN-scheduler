import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Assignment, DirectorIdentity, ScheduleResponse } from "@/api/types";
import { DepartmentSwitcher } from "./schedule/DepartmentSwitcher";
import { StatsBar } from "./schedule/StatsBar";
import { ViewToggle, type ViewMode } from "./schedule/ViewToggle";
import { SaturdayView } from "./schedule/SaturdayView";
import { GridView } from "./schedule/GridView";
import { RemoveVolunteerModal } from "./schedule/RemoveVolunteerModal";
import { PendingRequestsTab } from "./schedule/PendingRequestsTab";
import { useDebouncedSaver } from "@/lib/useDebouncedSaver";
import type { Person } from "@/api/types";

export function ScheduleBuilder({ identity }: { identity: DirectorIdentity }) {
  const [selectedDeptId, setSelectedDeptId] = useState(identity.departments[0]?.id ?? "");
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("saturday");
  const [editMode, setEditMode] = useState<"assign" | "shadow" | "availability" | "requests">(
    "assign",
  );
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  const reload = useCallback(() => {
    if (!selectedDeptId) return;
    setLoading(true);
    api
      .schedule(selectedDeptId, identity.person.netid, identity.person.email)
      .then(setData)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedDeptId, identity.person.netid, identity.person.email]);

  useEffect(() => {
    reload();
  }, [reload]);

  // refresh on focus
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") reload();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reload]);

  const persist = useDebouncedSaver(async (assignment: Assignment, deptId: string) => {
    setSaving(true);
    try {
      await api.assign({
        callerNetid: identity.person.netid,
        callerEmail: identity.person.email,
        departmentId: deptId,
        date: assignment.date,
        directorIds: assignment.directorIds,
        volunteerIds: assignment.volunteerIds,
        shadowIds: assignment.shadowIds,
      });
      setLastSavedAt(new Date());
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
      reload(); // revert by reloading server truth
    } finally {
      setSaving(false);
    }
  });

  const persistAvailability = useDebouncedSaver(
    async (personId: string, kind: "director" | "volunteer", availableDates: string[]) => {
      setSaving(true);
      try {
        await api.setAvailability({
          callerNetid: identity.person.netid,
          callerEmail: identity.person.email,
          personId,
          kind,
          availableDates,
        });
        setLastSavedAt(new Date());
      } catch (e) {
        toast.error((e as Error).message || "Couldn't save availability");
        reload();
      } finally {
        setSaving(false);
      }
    },
  );

  const doubleBookedCount = useMemo(() => {
    if (!data) return 0;
    const set = new Set<string>();
    for (const p of [...data.roster.directors, ...data.roster.volunteers]) {
      if (p.conflicts.sameDay.length || p.conflicts.crossTerm.length) set.add(p.id);
    }
    return set.size;
  }, [data]);

  const pendingCount =
    identity.departments.find((d) => d.id === selectedDeptId)?.pendingRequestCount ?? 0;

  function handleAssignmentToggle(date: string, kind: "director" | "volunteer", personId: string) {
    if (!data) return;
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ScheduleResponse;
      const a = next.assignments.find((x) => x.date === date);
      if (!a) return prev;
      const list = kind === "director" ? a.directorIds : a.volunteerIds;
      const idx = list.indexOf(personId);
      if (idx >= 0) list.splice(idx, 1);
      else {
        list.push(personId);
        // Moving someone INTO regular assigned implicitly takes them out of
        // shadow on the same Saturday. Otherwise they'd appear in both lists.
        if (kind === "volunteer") {
          const sIdx = a.shadowIds.indexOf(personId);
          if (sIdx >= 0) a.shadowIds.splice(sIdx, 1);
        }
      }
      persist.schedule(`${date}`, { ...a }, next.department.id);

      // same-day conflict warning
      const person = [...next.roster.directors, ...next.roster.volunteers].find((p) => p.id === personId);
      const newlyAdded = idx < 0;
      if (newlyAdded && person) {
        const sameDay = person.conflicts.sameDay.find((c) => c.date === date);
        if (sameDay) {
          toast.warning(`Conflict — ${person.name} is already on ${sameDay.otherDept} this Saturday.`);
        } else if (!person.available.includes(date)) {
          toast.message(`Heads up — ${person.name} didn't mark ${date} available.`);
        }
      }
      return next;
    });
  }

  function handleShadowToggle(date: string, kind: "director" | "volunteer", personId: string) {
    if (!data) return;
    if (kind !== "volunteer") return; // directors don't shadow
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ScheduleResponse;
      const a = next.assignments.find((x) => x.date === date);
      if (!a) return prev;
      const sIdx = a.shadowIds.indexOf(personId);
      if (sIdx >= 0) {
        a.shadowIds.splice(sIdx, 1);
      } else {
        a.shadowIds.push(personId);
        // Same exclusivity rule the other way — flipping to shadow removes
        // them from regular Volunteers on Shift if they were there.
        const vIdx = a.volunteerIds.indexOf(personId);
        if (vIdx >= 0) a.volunteerIds.splice(vIdx, 1);
      }
      persist.schedule(`${date}`, { ...a }, next.department.id);
      return next;
    });
  }

  function handleAvailabilityToggle(date: string, kind: "director" | "volunteer", personId: string) {
    if (!data) return;
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ScheduleResponse;
      const list = kind === "director" ? next.roster.directors : next.roster.volunteers;
      const person = list.find((p) => p.id === personId);
      if (!person) return prev;
      const idx = person.available.indexOf(date);
      if (idx >= 0) person.available.splice(idx, 1);
      else person.available.push(date);
      // The server treats an empty All People field as "no override" and falls
      // back to applicant-base data. Mirror that here so the badge clears
      // immediately when the user unchecks the last date.
      person.availabilityOverridden = person.available.length > 0;
      persistAvailability.schedule(`${personId}|${kind}`, personId, kind, [...person.available]);
      return next;
    });
  }

  const handleToggle =
    editMode === "assign"
      ? handleAssignmentToggle
      : editMode === "shadow"
      ? handleShadowToggle
      : handleAvailabilityToggle;

  async function handleAcknowledgeVolunteerUpdate(person: Person) {
    if (!data) return;
    // Optimistic: stamp acknowledgedAt locally so the badge clears immediately.
    const now = new Date().toISOString();
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ScheduleResponse;
      const target = next.roster.volunteers.find((p) => p.id === person.id);
      if (target) target.volunteerUpdateAcknowledgedAt = now;
      return next;
    });
    try {
      await api.acknowledgeVolunteerUpdate({
        callerNetid: identity.person.netid,
        callerEmail: identity.person.email,
        personId: person.id,
      });
      toast.success(`Acknowledged ${person.name || person.netid}'s availability update.`);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't acknowledge update");
      reload();
    }
  }

  if (loading || !data) {
    return <div className="bg-white rounded-xl p-8 shadow-lg text-slate-500">Loading…</div>;
  }

  async function handleConfirmRemove(reason: string) {
    if (!data || !removeTarget) return;
    setRemoveLoading(true);
    try {
      const res = await api.removeVolunteer({
        callerNetid: identity.person.netid,
        callerEmail: identity.person.email,
        departmentId: data.department.id,
        personId: removeTarget.id,
        ...(reason ? { reason } : {}),
      });
      const note =
        res.unscheduledCount > 0
          ? ` and unscheduled from ${res.unscheduledCount} Saturday${res.unscheduledCount === 1 ? "" : "s"}`
          : "";
      toast.success(`${removeTarget.name || removeTarget.netid} removed from ${data.department.name}${note}.`);
      setRemoveTarget(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't remove volunteer.");
    } finally {
      setRemoveLoading(false);
    }
  }

  function formatSavedAt(d: Date | null): string {
    if (!d) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="bg-white rounded-xl p-4 sm:p-6 lg:p-8 shadow-lg space-y-6 w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {identity.isAdmin && (
            <span
              className="text-xs px-2 py-1 rounded-full bg-[#0F4D92] text-white font-medium uppercase tracking-wide"
              title="You can view and edit every department's schedule."
            >
              Master access
            </span>
          )}
          <span className="text-slate-500 text-sm">Department:</span>
          <DepartmentSwitcher
            departments={identity.departments}
            selectedId={selectedDeptId}
            onSelect={setSelectedDeptId}
          />
          {saving ? (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
              Saving…
            </span>
          ) : lastSavedAt ? (
            <span className="text-xs text-emerald-700 flex items-center gap-1" title="Edits save automatically.">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Saved {formatSavedAt(lastSavedAt)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex border border-slate-300 rounded-lg overflow-hidden">
            {(["assign", "shadow", "availability", "requests"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setEditMode(m)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  editMode === m
                    ? m === "availability"
                      ? "bg-amber-500 text-white"
                      : m === "shadow"
                      ? "bg-purple-600 text-white"
                      : "bg-[#0F4D92] text-white"
                    : "bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {m === "assign" ? (
                  "Assign"
                ) : m === "shadow" ? (
                  "Shadow"
                ) : m === "availability" ? (
                  <>
                    <span className="sm:hidden">Availability</span>
                    <span className="hidden sm:inline">Edit availability</span>
                  </>
                ) : (
                  <>
                    <span className="sm:hidden">Requests{pendingCount > 0 ? ` (${pendingCount})` : ""}</span>
                    <span className="hidden sm:inline">
                      Pending Requests{pendingCount > 0 ? ` (${pendingCount})` : ""}
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
          {editMode !== "requests" && <ViewToggle mode={mode} onChange={setMode} />}
        </div>
      </div>

      {editMode !== "requests" && editMode === "availability" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
          <strong>Availability edit mode.</strong>{" "}
          Checkboxes now toggle whether each person is <em>available</em> for the
          selected Saturday.
        </div>
      )}

      {editMode === "shadow" && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-900">
          <strong>Shadow mode.</strong>{" "}
          Checkboxes now toggle whether each volunteer is <em>shadowing</em> the
          selected Saturday. A volunteer can be a regular or a shadow on any given
          Saturday, but not both — flipping one clears the other.
        </div>
      )}

      {editMode !== "requests" && (
        <StatsBar assignments={data.assignments} doubleBookedCount={doubleBookedCount} />
      )}

      {editMode === "requests" ? (
        <PendingRequestsTab
          deptId={selectedDeptId}
          credentials={{ netid: identity.person.netid, email: identity.person.email }}
          onChanged={reload}
        />
      ) : mode === "saturday" ? (
        <SaturdayView
          dates={data.dates}
          directors={data.roster.directors}
          volunteers={data.roster.volunteers}
          assignments={data.assignments}
          disabled={!data.callerIsDeptDirector}
          editMode={editMode}
          onToggle={handleToggle}
          onRemoveVolunteer={
            !data.callerIsDeptDirector ? undefined : (p) => setRemoveTarget(p)
          }
          onAcknowledgeVolunteerUpdate={
            data.callerIsDeptDirector ? handleAcknowledgeVolunteerUpdate : undefined
          }
        />
      ) : (
        <GridView
          dates={data.dates}
          directors={data.roster.directors}
          volunteers={data.roster.volunteers}
          assignments={data.assignments}
          disabled={!data.callerIsDeptDirector}
          editMode={editMode}
          onToggle={handleToggle}
          onRemoveVolunteer={
            !data.callerIsDeptDirector ? undefined : (p) => setRemoveTarget(p)
          }
          onAcknowledgeVolunteerUpdate={
            data.callerIsDeptDirector ? handleAcknowledgeVolunteerUpdate : undefined
          }
        />
      )}

      <RemoveVolunteerModal
        open={!!removeTarget}
        personName={removeTarget ? removeTarget.name || removeTarget.netid : ""}
        deptName={data.department.name}
        loading={removeLoading}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemove}
      />
    </div>
  );
}
