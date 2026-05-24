import { CheckCircle2 } from "lucide-react";

export function SubmittedView({ deptName, submittedAt }: { deptName: string; submittedAt: string | null }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 text-amber-900">
      <CheckCircle2 className="w-5 h-5 mt-0.5" />
      <div>
        <div className="font-semibold">Schedule submitted</div>
        <div className="text-sm">
          {deptName} was published {submittedAt ? new Date(submittedAt).toLocaleString() : "earlier"}.
          You can still edit — any change will move the schedule back to Draft and
          hide it from volunteers until you resubmit.
        </div>
      </div>
    </div>
  );
}
