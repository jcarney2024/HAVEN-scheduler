import type { DepartmentRef } from "@/api/types";

export function DepartmentSwitcher({
  departments,
  selectedId,
  onSelect,
}: {
  departments: DepartmentRef[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (departments.length === 1) {
    const only = departments[0];
    return (
      <div className="text-lg font-semibold">
        {only.name}
        {only.pendingRequestCount > 0 && (
          <span className="ml-2 text-sm text-amber-600">({only.pendingRequestCount} pending)</span>
        )}
      </div>
    );
  }
  return (
    <select
      value={selectedId}
      onChange={(e) => onSelect(e.target.value)}
      className="p-2 border border-slate-300 rounded-md bg-white text-lg font-semibold"
    >
      {departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}{d.pendingRequestCount > 0 ? ` (${d.pendingRequestCount} pending)` : ""}
        </option>
      ))}
    </select>
  );
}
