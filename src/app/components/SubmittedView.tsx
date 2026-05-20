import { Lock } from "lucide-react";

export function SubmittedView({ deptName, submittedAt }: { deptName: string; submittedAt: string | null }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 text-amber-900">
      <Lock className="w-5 h-5 mt-0.5" />
      <div>
        <div className="font-semibold">Schedule locked</div>
        <div className="text-sm">
          {deptName} was submitted {submittedAt ? new Date(submittedAt).toLocaleString() : "earlier"}. Edits are read-only — contact the IT department to unlock.
        </div>
      </div>
    </div>
  );
}
