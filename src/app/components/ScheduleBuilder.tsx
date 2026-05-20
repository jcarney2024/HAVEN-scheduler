import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { DirectorIdentity, ScheduleResponse } from "@/api/types";
import { DepartmentSwitcher } from "./schedule/DepartmentSwitcher";
import { StatsBar } from "./schedule/StatsBar";
import { ViewToggle, type ViewMode } from "./schedule/ViewToggle";
import { SubmittedView } from "./SubmittedView";

export function ScheduleBuilder({ identity }: { identity: DirectorIdentity }) {
  const [selectedDeptId, setSelectedDeptId] = useState(identity.departments[0]?.id ?? "");
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("saturday");

  useEffect(() => {
    if (!selectedDeptId) return;
    setLoading(true);
    api
      .schedule(selectedDeptId, identity.person.netid, identity.person.email)
      .then(setData)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedDeptId, identity.person.netid, identity.person.email]);

  const doubleBookedCount = useMemo(() => {
    if (!data) return 0;
    const set = new Set<string>();
    for (const p of [...data.roster.directors, ...data.roster.volunteers]) {
      if (p.conflicts.sameDay.length > 0 || p.conflicts.crossTerm.length > 0) {
        set.add(p.id);
      }
    }
    return set.size;
  }, [data]);

  if (loading || !data) {
    return (
      <div className="bg-white rounded-xl p-8 shadow-lg">
        <p className="text-slate-500">Loading {selectedDeptId}…</p>
      </div>
    );
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
        </div>
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <StatsBar assignments={data.assignments} doubleBookedCount={doubleBookedCount} />

      {submitted && <SubmittedView deptName={data.department.name} submittedAt={data.department.submittedAt} />}

      <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center text-slate-400">
        {mode === "saturday" ? "Saturday view goes here (next task)" : "Grid view goes here (next task)"}
      </div>
    </div>
  );
}
