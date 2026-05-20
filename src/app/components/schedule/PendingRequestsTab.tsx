import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { RequestsForDept, ShiftRequest } from "@/api/types";
import { displayDate } from "../view/displayDate";

export function PendingRequestsTab({
  deptId,
  credentials,
  onChanged,
}: {
  deptId: string;
  credentials: { netid: string; email: string };
  onChanged: () => void;
}) {
  const [data, setData] = useState<RequestsForDept | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectNoteOpen, setRejectNoteOpen] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  function refresh() {
    api
      .requestsForDept(deptId, credentials.netid, credentials.email)
      .then(setData)
      .catch((err) => toast.error((err as Error).message ?? "Failed to load requests"));
  }

  useEffect(refresh, [deptId, credentials.netid, credentials.email]);

  async function resolve(id: string, action: "approve" | "reject", note?: string) {
    setBusy(id);
    try {
      await api.resolveRequest(id, {
        callerNetid: credentials.netid,
        callerEmail: credentials.email,
        action,
        note,
      });
      toast.success(action === "approve" ? "Approved — schedule updated" : "Request rejected");
      onChanged();
      refresh();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to resolve");
    } finally {
      setBusy(null);
      setRejectNoteOpen(null);
      setRejectNote("");
    }
  }

  if (!data) return <div className="text-sm text-slate-500 p-4">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-2">Pending</h3>
        {data.pending.length === 0 ? (
          <p className="text-sm text-slate-500">No pending requests for this department.</p>
        ) : (
          <ul className="space-y-3">
            {data.pending.map((r) => (
              <li key={r.id} className="border border-slate-200 rounded-md p-3">
                <div className="font-medium">{summary(r)}</div>
                {r.note && <div className="text-sm text-slate-600 mt-1">"{r.note}"</div>}
                <div className="text-xs text-slate-500 mt-1">
                  Submitted {new Date(r.submittedAt).toLocaleString()}
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => resolve(r.id, "approve")}
                    disabled={busy === r.id}
                    className="bg-[#0F4D92] text-white rounded-md px-3 py-1.5 text-sm hover:bg-[#0B3D75] disabled:opacity-50"
                  >
                    {busy === r.id ? "Working…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectNoteOpen(rejectNoteOpen === r.id ? null : r.id)}
                    disabled={busy === r.id}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Reject
                  </button>
                </div>
                {rejectNoteOpen === r.id && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Optional note for the requester"
                      className="w-full p-2 border border-slate-300 rounded-md text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => resolve(r.id, "reject", rejectNote || undefined)}
                      disabled={busy === r.id}
                      className="bg-red-600 text-white rounded-md px-3 py-1.5 text-sm hover:bg-red-700 disabled:opacity-50"
                    >
                      Confirm reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.recent.length > 0 && (
        <div>
          <h3 className="text-base font-semibold mb-2 text-slate-500">Recently resolved (last 14 days)</h3>
          <ul className="space-y-2">
            {data.recent.map((r) => (
              <li key={r.id} className="text-sm text-slate-500">
                <span className="uppercase text-xs tracking-wide mr-2">{r.status}</span>
                {summary(r)} — {r.resolver?.name ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function summary(r: ShiftRequest): string {
  const requesterStr = `${r.requester.name} (${r.requester.role})`;
  if (r.type === "Drop") {
    return `Drop ${requesterStr}'s ${displayDate(r.requesterDate)} shift`;
  }
  return `Swap ${requesterStr}'s ${displayDate(r.requesterDate)} for ${r.target?.name}'s ${
    r.targetDate ? displayDate(r.targetDate) : "?"
  }`;
}
