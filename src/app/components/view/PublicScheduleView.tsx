import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { PublicDeptListItem, PublicSchedule } from "@/api/types";
import { SaturdayView } from "../schedule/SaturdayView";
import { displayDate } from "./displayDate";

export function PublicScheduleView() {
  const [depts, setDepts] = useState<PublicDeptListItem[] | null>(null);
  const [deptId, setDeptId] = useState<string>("");
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [notPublished, setNotPublished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .viewList()
      .then((list) => {
        if (cancelled) return;
        setDepts(list);
        if (list.length > 0) setDeptId(list[0].id);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.message ?? "Failed to load departments");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!deptId) {
      setSchedule(null);
      setNotPublished(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotPublished(false);
    api
      .viewSchedule(deptId)
      .then((s) => {
        if (!cancelled) setSchedule(s);
      })
      .catch((err: Error & { status?: number }) => {
        if (cancelled) return;
        if (err.status === 403) {
          setNotPublished(true);
          setSchedule(null);
        } else if (err.status === 404) {
          toast.error("Department not found");
          setSchedule(null);
        } else {
          toast.error(err.message ?? "Failed to load schedule");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deptId]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="w-full max-w-4xl mt-8 space-y-6"
    >
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-3">Browse a submitted schedule</h2>
        {depts === null ? (
          <p className="text-sm text-slate-500">Loading departments…</p>
        ) : depts.length === 0 ? (
          <p className="text-sm text-slate-500">No schedules have been published yet.</p>
        ) : (
          <select
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            className="p-2 border border-slate-300 rounded-md bg-white text-base font-semibold"
          >
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div className="bg-white rounded-xl shadow-lg p-6 text-sm text-slate-500">
          Loading schedule…
        </div>
      )}

      {notPublished && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900">
          This schedule hasn't been published yet.
        </div>
      )}

      {schedule && !loading && !notPublished && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="mb-4">
            <h3 className="text-xl font-semibold">{schedule.deptName}</h3>
            {schedule.submittedAt && (
              <p className="text-sm text-slate-500">
                Published {new Date(schedule.submittedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          <SaturdayView
            dates={schedule.dates.map((d) => ({ iso: d.date, display: displayDate(d.date) }))}
            directors={schedule.dates.flatMap((d) => d.directors).map(toPseudoPerson("director"))}
            volunteers={schedule.dates.flatMap((d) => d.volunteers).map(toPseudoPerson("volunteer"))}
            assignments={schedule.dates.map((d) => ({
              date: d.date,
              directorIds: d.directors.map((p) => pseudoId("director", p.name)),
              volunteerIds: d.volunteers.map((p) => pseudoId("volunteer", p.name)),
            }))}
            disabled
            editMode="assign"
            onToggle={() => {}}
            readOnly
          />
        </div>
      )}
    </motion.div>
  );
}

function pseudoId(kind: "director" | "volunteer", name: string): string {
  return `${kind}:${name}`;
}

function toPseudoPerson(kind: "director" | "volunteer") {
  return (p: { name: string }) => ({
    id: pseudoId(kind, p.name),
    netid: "",
    name: p.name,
    available: [],
    conflicts: { sameDay: [], crossTerm: [] },
  });
}
