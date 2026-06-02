import { X, AlertTriangle } from "lucide-react";
import type { DepartmentRef } from "@/api/types";

export function formatMissing(missing: ("contract" | "training")[]): string {
  return missing.join(" + ");
}

/** Pure summary of compliance state across the director's departments. */
export function summarizeCompliance(departments: DepartmentRef[]): {
  withIssues: DepartmentRef[];
  total: number;
  multiDept: boolean;
} {
  const withIssues = departments.filter((d) => d.nonCompliantVolunteers.length > 0);
  const total = withIssues.reduce((n, d) => n + d.nonCompliantVolunteers.length, 0);
  return { withIssues, total, multiDept: withIssues.length > 1 };
}

export function ComplianceBanner({
  departments,
  onDismiss,
}: {
  departments: DepartmentRef[];
  onDismiss: () => void;
}) {
  const { withIssues, total, multiDept } = summarizeCompliance(departments);
  if (total === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-900">
          {total} volunteer{total === 1 ? "" : "s"}
          {multiDept ? " across your departments" : ""} {total === 1 ? "isn't" : "aren't"}{" "}
          compliant
        </p>
        <p className="text-sm text-amber-800 mt-0.5">
          Missing a signed volunteer contract and/or required training.
        </p>
        <div className="mt-3 space-y-3">
          {withIssues.map((d) => (
            <div key={d.id}>
              {multiDept && (
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">
                  {d.name}
                </p>
              )}
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {d.nonCompliantVolunteers.map((v) => (
                  <li key={v.id} className="flex items-center gap-1.5 text-sm text-slate-800">
                    <span className="font-medium">{v.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-red-800 bg-red-100 px-1.5 py-0.5 rounded font-semibold">
                      {formatMissing(v.missing)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss compliance banner"
        className="text-amber-600 hover:text-amber-900 transition-colors shrink-0"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
