import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { MyAssignment, PublicSchedule } from "@/api/types";
import { displayDate } from "./displayDate";

type Mode = "drop" | "named";

export function RequestSwapModal({
  assignment,
  credentials,
  onClose,
  onSubmitted,
  dropOnly = false,
}: {
  assignment: MyAssignment;
  credentials: { netid: string; email: string };
  onClose: () => void;
  onSubmitted: () => void;
  /** When true, hide the named-swap option (used for shadow shifts). */
  dropOnly?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("drop");
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null);
  const [targetName, setTargetName] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .viewSchedule(assignment.deptId)
      .then(setSchedule)
      .catch((err) => toast.error((err as Error).message ?? "Failed to load dept schedule"));
  }, [assignment.deptId]);

  // Map "name" → list of dates that person is on (same role, not our own date).
  const peopleWithDates = (() => {
    if (!schedule) return new Map<string, string[]>();
    const roleKey = assignment.role === "director" ? "directors" : "volunteers";
    const out = new Map<string, string[]>();
    for (const d of schedule.dates) {
      if (d.date === assignment.date) continue;
      for (const p of d[roleKey]) {
        if (!out.has(p.name)) out.set(p.name, []);
        out.get(p.name)!.push(d.date);
      }
    }
    return out;
  })();

  const partnerOptions = [...peopleWithDates.keys()].sort();
  const partnerDateOptions = targetName ? peopleWithDates.get(targetName) ?? [] : [];

  async function submit() {
    if (mode === "named" && (!targetName || !targetDate)) {
      toast.error("Pick a partner and their date");
      return;
    }
    setSubmitting(true);
    try {
      // The partner picker selects by display name (PublicSchedule omits NetID).
      // The server's /requests route resolves targetNetid as a name fallback.
      const targetNetid = mode === "named" ? targetName : undefined;
      await api.createRequest({
        callerNetid: credentials.netid,
        callerEmail: credentials.email,
        deptId: assignment.deptId,
        requesterDate: assignment.date,
        targetNetid,
        targetDate: mode === "named" ? targetDate : undefined,
        note: note || undefined,
      });
      toast.success("Request submitted");
      onSubmitted();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-semibold">
          {dropOnly ? "Request to drop" : "Request a swap"} — {displayDate(assignment.date)} · {assignment.deptName}
        </h2>

        {dropOnly ? (
          <p className="text-sm text-slate-600">
            Shadow shifts can be dropped through the portal but can't be swapped — your director will be notified.
          </p>
        ) : (
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "drop"}
                onChange={() => setMode("drop")}
              />
              Just drop this shift
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "named"}
                onChange={() => setMode("named")}
              />
              Swap with a specific person
            </label>
          </div>
        )}

        {mode === "named" && (
          <>
            <select
              value={targetName}
              onChange={(e) => {
                setTargetName(e.target.value);
                setTargetDate("");
              }}
              className="w-full p-2 border border-slate-300 rounded-md"
            >
              <option value="">Select a partner</option>
              {partnerOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            {targetName && (
              <select
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-md"
              >
                <option value="">Take which of their shifts?</option>
                {partnerDateOptions.map((iso) => (
                  <option key={iso} value={iso}>{displayDate(iso)}</option>
                ))}
              </select>
            )}
          </>
        )}

        <textarea
          placeholder="Optional note for the director"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full p-2 border border-slate-300 rounded-md min-h-24"
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="bg-[#0F4D92] text-white rounded-md px-4 py-2 font-semibold hover:bg-[#0B3D75] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
