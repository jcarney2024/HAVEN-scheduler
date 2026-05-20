import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Assignment, DirectorIdentity, ScheduleResponse } from "@/api/types";
import { DepartmentSwitcher } from "./schedule/DepartmentSwitcher";
import { StatsBar } from "./schedule/StatsBar";
import { ViewToggle, type ViewMode } from "./schedule/ViewToggle";
import { SaturdayView } from "./schedule/SaturdayView";
import { GridView } from "./schedule/GridView";
import { SubmittedView } from "./SubmittedView";
import { SubmitModal } from "./schedule/SubmitModal";
import { RemoveVolunteerModal } from "./schedule/RemoveVolunteerModal";
import { useDebouncedSaver } from "@/lib/useDebouncedSaver";
import type { Person } from "@/api/types";

export function ScheduleBuilder({ identity }: { identity: DirectorIdentity }) {
  const [selectedDeptId, setSelectedDeptId] = useState(identity.departments[0]?.id ?? "");
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("saturday");
  const [editMode, setEditMode] = useState<"assign" | "availability">("assign");
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
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
      else list.push(personId);
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
      person.availabilityOverridden = true;
      persistAvailability.schedule(`${personId}|${kind}`, personId, kind, [...person.available]);
      return next;
    });
  }

  const handleToggle = editMode === "assign" ? handleAssignmentToggle : handleAvailabilityToggle;

  if (loading || !data) {
    return <div className="bg-white rounded-xl p-8 shadow-lg text-slate-500">Loading…</div>;
  }

  const submitted = data.department.scheduleStatus === "Submitted";

  const totalShifts = data.assignments.reduce(
    (sum, a) => sum + a.directorIds.length + a.volunteerIds.length,
    0,
  );
  const emptyDays = data.assignments.filter(
    (a) => a.directorIds.length === 0 && a.volunteerIds.length === 0,
  ).length;

  async function handleSubmit() {
    setSubmitLoading(true);
    try {
      await api.submit(data!.department.id, identity.person.netid, identity.person.email);
      toast.success("Schedule submitted.");
      setSubmitOpen(false);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitLoading(false);
    }
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    try {
      await persist.flush();
      toast.success("Draft saved — you can come back any time.");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save draft.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleConfirmRemove() {
    if (!data || !removeTarget) return;
    setRemoveLoading(true);
    try {
      const res = await api.removeVolunteer({
        callerNetid: identity.person.netid,
        callerEmail: identity.person.email,
        departmentId: data.department.id,
        personId: removeTarget.id,
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
    <div className="bg-white rounded-xl p-6 sm:p-8 shadow-lg space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
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
          <span
            className={`text-xs px-2 py-1 rounded-full ${
              submitted ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {data.department.scheduleStatus}
          </span>
          {saving ? (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
              Saving…
            </span>
          ) : lastSavedAt ? (
            <span className="text-xs text-emerald-700 flex items-center gap-1" title="Your edits are saved as a draft.">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Saved {formatSavedAt(lastSavedAt)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex border border-slate-300 rounded-lg overflow-hidden">
            {(["assign", "availability"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setEditMode(m)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  editMode === m
                    ? m === "availability"
                      ? "bg-amber-500 text-white"
                      : "bg-[#0F4D92] text-white"
                    : "bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {m === "assign" ? "Assign" : "Edit availability"}
              </button>
            ))}
          </div>
          <ViewToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      {editMode === "availability" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
          <strong>Availability edit mode.</strong>{" "}
          Checkboxes now toggle whether each person is <em>available</em> for the
          selected Saturday.
        </div>
      )}

      <StatsBar assignments={data.assignments} doubleBookedCount={doubleBookedCount} />

      {submitted && (
        <SubmittedView deptName={data.department.name} submittedAt={data.department.submittedAt} />
      )}

      {mode === "saturday" ? (
        <SaturdayView
          dates={data.dates}
          directors={data.roster.directors}
          volunteers={data.roster.volunteers}
          assignments={data.assignments}
          disabled={submitted || !data.callerIsDeptDirector}
          editMode={editMode}
          onToggle={handleToggle}
          onRemoveVolunteer={
            submitted || !data.callerIsDeptDirector ? undefined : (p) => setRemoveTarget(p)
          }
        />
      ) : (
        <GridView
          dates={data.dates}
          directors={data.roster.directors}
          volunteers={data.roster.volunteers}
          assignments={data.assignments}
          disabled={submitted || !data.callerIsDeptDirector}
          editMode={editMode}
          onToggle={handleToggle}
          onRemoveVolunteer={
            submitted || !data.callerIsDeptDirector ? undefined : (p) => setRemoveTarget(p)
          }
        />
      )}

      {!submitted && data.callerIsDeptDirector && (
        <div className="flex justify-end items-center gap-2 pt-4 border-t border-slate-200">
          <button
            onClick={handleSaveDraft}
            disabled={savingDraft || saving}
            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-md font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            {savingDraft ? "Saving…" : "Save draft"}
          </button>
          <button
            onClick={() => setSubmitOpen(true)}
            className="px-4 py-2 bg-[#0F4D92] text-white rounded-md font-medium hover:bg-[#0B3D75]"
          >
            Submit term schedule
          </button>
        </div>
      )}
      <SubmitModal
        open={submitOpen}
        deptName={data.department.name}
        totalShifts={totalShifts}
        emptyDays={emptyDays}
        loading={submitLoading}
        onCancel={() => setSubmitOpen(false)}
        onConfirm={handleSubmit}
      />
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
