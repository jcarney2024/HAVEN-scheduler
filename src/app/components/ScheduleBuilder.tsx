import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Assignment, DirectorIdentity, ScheduleResponse } from "@/api/types";
import { DepartmentSwitcher } from "./schedule/DepartmentSwitcher";
import { StatsBar } from "./schedule/StatsBar";
import { ViewToggle, type ViewMode } from "./schedule/ViewToggle";
import { SaturdayView } from "./schedule/SaturdayView";
import { SubmittedView } from "./SubmittedView";
import { useDebouncedSaver } from "@/lib/useDebouncedSaver";

export function ScheduleBuilder({ identity }: { identity: DirectorIdentity }) {
  const [selectedDeptId, setSelectedDeptId] = useState(identity.departments[0]?.id ?? "");
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("saturday");
  const [saving, setSaving] = useState(false);

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
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
      reload(); // revert by reloading server truth
    } finally {
      setSaving(false);
    }
  });

  const doubleBookedCount = useMemo(() => {
    if (!data) return 0;
    const set = new Set<string>();
    for (const p of [...data.roster.directors, ...data.roster.volunteers]) {
      if (p.conflicts.sameDay.length || p.conflicts.crossTerm.length) set.add(p.id);
    }
    return set.size;
  }, [data]);

  function handleToggle(date: string, kind: "director" | "volunteer", personId: string) {
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
      persist(`${date}`, { ...a }, next.department.id);

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

  if (loading || !data) {
    return <div className="bg-white rounded-xl p-8 shadow-lg text-slate-500">Loading…</div>;
  }

  const submitted = data.department.scheduleStatus === "Submitted";

  return (
    <div className="bg-white rounded-xl p-6 sm:p-8 shadow-lg space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
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
          {saving && <span className="text-xs text-slate-500">Saving…</span>}
        </div>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

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
          onToggle={handleToggle}
        />
      ) : (
        <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center text-slate-400">
          Grid view goes here (next task)
        </div>
      )}
    </div>
  );
}
