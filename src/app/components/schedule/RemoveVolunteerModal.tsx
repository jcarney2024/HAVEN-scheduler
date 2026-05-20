import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";

export function RemoveVolunteerModal({
  open,
  personName,
  deptName,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  personName: string;
  deptName: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {personName} from {deptName}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            This drops <strong>{personName}</strong> from the {deptName} volunteer roster
            and unschedules them from every Saturday they were on.
          </p>
          <div className="space-y-1">
            <label htmlFor="remove-reason" className="block text-xs font-medium text-slate-600">
              Reason <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="remove-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              rows={3}
              placeholder="e.g. dropped department, no longer at HAVEN"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4D92] focus:border-transparent disabled:opacity-50"
            />
            <p className="text-xs text-slate-500">Saved to the removal log for the record.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={loading}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Removing…" : "Remove from department"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
