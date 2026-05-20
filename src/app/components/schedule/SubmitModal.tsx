import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/components/ui/dialog";

export function SubmitModal({
  open,
  deptName,
  totalShifts,
  emptyDays,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  deptName: string;
  totalShifts: number;
  emptyDays: number;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit {deptName} schedule for SU 26?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            You're about to lock all 18 Saturdays for <strong>{deptName}</strong>. After this,
            the schedule becomes read-only — IT can unlock if needed.
          </p>
          <ul className="bg-slate-50 rounded-md p-3 list-disc list-inside text-slate-700">
            <li>{totalShifts} total shifts assigned</li>
            <li>{emptyDays} Saturdays with no assignments</li>
          </ul>
          {emptyDays > 0 && (
            <p className="text-amber-700 text-sm">
              Heads up — you have {emptyDays} Saturday{emptyDays === 1 ? "" : "s"} with no assignments. You can still submit.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-[#0F4D92] text-white rounded-md hover:bg-[#0B3D75] disabled:opacity-50"
          >
            {loading ? "Submitting…" : "Submit and lock"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
