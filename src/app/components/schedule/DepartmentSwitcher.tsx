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
    return (
      <div className="text-lg font-semibold">
        {departments[0].name}
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
          {d.name}
        </option>
      ))}
    </select>
  );
}
