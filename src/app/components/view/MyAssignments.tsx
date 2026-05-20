import type { MyAssignmentsResponse } from "@/api/types";

export function MyAssignments({
  data,
  credentials: _credentials,
  onChanged: _onChanged,
}: {
  data: MyAssignmentsResponse;
  credentials: { netid: string; email: string };
  onChanged: () => void;
}) {
  // P2.14 will use _credentials + _onChanged
  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h2 className="text-lg font-semibold mb-2">My assignments</h2>
      <pre className="text-xs">{JSON.stringify(data.assignments, null, 2)}</pre>
    </div>
  );
}
