import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type {
  Assignment,
  MyAssignmentsResponse,
  Person,
  PublicDeptListItem,
  PublicSchedule,
} from "@/api/types";
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

          <PublicScheduleBody schedule={schedule} />
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

/**
 * Reuses SaturdayView in read-only mode by building the same data shape it
 * already understands. Two non-obvious bits:
 *
 *   1) Pseudo-people must be deduped by (name, role) — a volunteer on N
 *      Saturdays should appear once in `volunteers`, not N times. Their
 *      `available` array carries the list of dates they're actually on so
 *      SaturdayView's "show available" filter renders them on the right tabs.
 *   2) Shadow volunteers get a separate pseudo-ID and a "(shadow)" name
 *      suffix so they're visually distinct without leaning on the shadow
 *      pill (which we don't wire up for the public view).
 */
function PublicScheduleBody({ schedule }: { schedule: PublicSchedule }) {
  const { dates, directors, volunteers, assignments } = useMemo(() => {
    const directorDates = new Map<string, string[]>();
    const volunteerEntries = new Map<
      string,
      { name: string; shadow: boolean; available: string[] }
    >();

    for (const d of schedule.dates) {
      for (const dr of d.directors) {
        if (!dr.name) continue;
        if (!directorDates.has(dr.name)) directorDates.set(dr.name, []);
        directorDates.get(dr.name)!.push(d.date);
      }
      for (const v of d.volunteers) {
        if (!v.name) continue;
        const shadow = !!v.shadow;
        const key = `${v.name}|${shadow ? "s" : "r"}`;
        let entry = volunteerEntries.get(key);
        if (!entry) {
          entry = { name: v.name, shadow, available: [] };
          volunteerEntries.set(key, entry);
        }
        entry.available.push(d.date);
      }
    }

    const directorPeople: Person[] = [...directorDates.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, available]) => ({
        id: `director:${name}`,
        netid: "",
        name,
        available,
        conflicts: { sameDay: [], crossTerm: [] },
      }));

    const volunteerPeople: Person[] = [...volunteerEntries.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        id: `${entry.shadow ? "volunteer-shadow" : "volunteer"}:${entry.name}`,
        netid: "",
        name: entry.shadow ? `${entry.name} (shadow)` : entry.name,
        available: entry.available,
        conflicts: { sameDay: [], crossTerm: [] },
      }));

    const assignmentList: Assignment[] = schedule.dates.map((d) => {
      const regulars = d.volunteers.filter((v) => !v.shadow);
      const shadows = d.volunteers.filter((v) => v.shadow);
      const remoteDirectorIds = d.directors
        .filter((p) => !!p.name && p.remote)
        .map((p) => `director:${p.name}`);
      const remoteVolunteerIds = regulars
        .filter((v) => !!v.name && v.remote)
        .map((v) => `volunteer:${v.name}`);
      const remoteShadowIds = shadows
        .filter((v) => !!v.name && v.remote)
        .map((v) => `volunteer-shadow:${v.name}`);
      return {
        date: d.date,
        directorIds: d.directors.filter((p) => !!p.name).map((p) => `director:${p.name}`),
        volunteerIds: regulars.filter((v) => !!v.name).map((v) => `volunteer:${v.name}`),
        shadowIds: shadows.filter((v) => !!v.name).map((v) => `volunteer-shadow:${v.name}`),
        remoteIds: [...remoteDirectorIds, ...remoteVolunteerIds, ...remoteShadowIds],
        triageIds: [],
        walkinIds: [],
        ccIds: [],
        patientsBooked: null,
      };
    });

    const dateRefs = schedule.dates.map((d) => ({
      iso: d.date,
      display: displayDate(d.date),
    }));

    return {
      dates: dateRefs,
      directors: directorPeople,
      volunteers: volunteerPeople,
      assignments: assignmentList,
    };
  }, [schedule]);

  return (
    <SaturdayView
      dates={dates}
      directors={directors}
      volunteers={volunteers}
      assignments={assignments}
      disabled
      editMode="assign"
      onToggle={() => {}}
      readOnly
    />
  );
}
