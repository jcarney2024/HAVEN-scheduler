import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { MyAssignment, MyAssignmentsResponse } from "@/api/types";
import { RequestSwapModal } from "./RequestSwapModal";
import { displayDate } from "./displayDate";

export function MyAssignments({
  data,
  credentials,
  onChanged,
}: {
  data: MyAssignmentsResponse;
  credentials: { netid: string; email: string };
  onChanged: () => void;
}) {
  const [openFor, setOpenFor] = useState<MyAssignment | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  async function withdraw(requestId: string) {
    setWithdrawing(requestId);
    try {
      await api.withdrawRequest(requestId, credentials.netid, credentials.email);
      toast.success("Request withdrawn");
      onChanged();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to withdraw");
    } finally {
      setWithdrawing(null);
    }
  }

  if (data.assignments.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-2">My assignments</h2>
        <p className="text-sm text-slate-500">You're not currently scheduled for any clinic Saturdays.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-lg p-6 space-y-3">
        <h2 className="text-lg font-semibold">My assignments</h2>
        {data.assignments.map((a, idx) => (
          <div
            key={`${a.deptId}|${a.date}|${idx}`}
            className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-b-0"
          >
            <div>
              <div className="font-medium">
                {displayDate(a.date)} — {a.deptName}
                {a.shadow && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-purple-800 bg-purple-100 px-1.5 py-0.5 rounded font-semibold align-middle">
                    shadow
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">
                {a.role}
              </div>
            </div>
            {a.pendingRequestId ? (
              <button
                type="button"
                onClick={() => withdraw(a.pendingRequestId!)}
                disabled={withdrawing === a.pendingRequestId}
                className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {withdrawing === a.pendingRequestId ? "Withdrawing…" : "Pending — withdraw"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setOpenFor(a)}
                className="text-sm bg-[#0F4D92] text-white rounded-md px-3 py-1.5 hover:bg-[#0B3D75]"
              >
                {a.shadow ? "Request drop" : "Request swap"}
              </button>
            )}
          </div>
        ))}
      </div>

      {openFor && (
        <RequestSwapModal
          assignment={openFor}
          credentials={credentials}
          dropOnly={openFor.shadow ?? false}
          onClose={() => setOpenFor(null)}
          onSubmitted={() => {
            setOpenFor(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}
