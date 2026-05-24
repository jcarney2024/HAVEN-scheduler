import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { MyAssignmentsResponse, PublicDeptListItem, PublicSchedule } from "@/api/types";
import { SaturdayView } from "../schedule/SaturdayView";
import { displayDate } from "./displayDate";
import { SignInToRequest } from "./SignInToRequest";
import { MyAssignments } from "./MyAssignments";
import { MyAvailability } from "./MyAvailability";

export function PublicScheduleView({ autoSignIn = false }: { autoSignIn?: boolean } = {}) {
  const [depts, setDepts] = useState<PublicDeptListItem[] | null>(null);
  const [deptId, setDeptId] = useState<string>("");
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState<{
    data: MyAssignmentsResponse;
    credentials: { netid: string; email: string };
  } | null>(null);

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
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .viewSchedule(deptId)
      .then((s) => {
        if (!cancelled) setSchedule(s);
      })
      .catch((err: Error & { status?: number }) => {
        if (cancelled) return;
        if (err.status === 404) {
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

  function refetchAssignments() {
    if (!signedIn) return;
    api
      .myAssignments(signedIn.credentials.netid, signedIn.credentials.email)
      .then((data) => setSignedIn({ ...signedIn, data }))
      .catch((err) => toast.error((err as Error).message ?? "Failed to refresh"));
  }

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

      {schedule && !loading && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="mb-4">
            <h3 className="text-xl font-semibold">{schedule.deptName}</h3>
          </div>

          <SaturdayView
            dates={schedule.dates.map((d) => ({ iso: d.date, display: displayDate(d.date) }))}
            directors={schedule.dates.flatMap((d) => d.directors).map(toPseudoPerson("director"))}
            volunteers={schedule.dates
              .flatMap((d) => d.volunteers)
              .map(toPseudoVolunteer)}
            assignments={schedule.dates.map((d) => ({
              date: d.date,
              directorIds: d.directors.map((p) => pseudoId("director", p.name)),
              volunteerIds: d.volunteers.map((p) => pseudoVolunteerId(p)),
              shadowIds: [],
            }))}
            disabled
            editMode="assign"
            onToggle={() => {}}
            readOnly
          />
        </div>
      )}

      {signedIn ? (
        <>
          <MyAssignments
            data={signedIn.data}
            credentials={signedIn.credentials}
            onChanged={refetchAssignments}
          />
          <MyAvailability
            data={signedIn.data}
            credentials={signedIn.credentials}
            onSaved={refetchAssignments}
          />
        </>
      ) : (
        <SignInToRequest
          autoOpen={autoSignIn}
          onSignedIn={(data, credentials) => setSignedIn({ data, credentials })}
        />
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

// Volunteers may be shadows; suffix the displayed name so it's obvious. The
// pseudo-ID has to differ from the regular variant to avoid collisions on
// Saturdays where someone appears as a regular in one dept and shadow in
// another, even though that's an unusual case for the read-only view.
function pseudoVolunteerId(p: { name: string; shadow?: boolean }): string {
  return p.shadow ? `volunteer-shadow:${p.name}` : pseudoId("volunteer", p.name);
}

function toPseudoVolunteer(p: { name: string; shadow?: boolean }) {
  return {
    id: pseudoVolunteerId(p),
    netid: "",
    name: p.shadow ? `${p.name} (shadow)` : p.name,
    available: [],
    conflicts: { sameDay: [], crossTerm: [] },
  };
}
