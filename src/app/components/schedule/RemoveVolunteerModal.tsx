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
  onConfirm: () => void;
}) {
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
          <p className="text-slate-500">
            To re-add them later, edit the SU 26 row for {deptName} in Airtable and link
            them back to the Volunteers field.
          </p>
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
            onClick={onConfirm}
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
