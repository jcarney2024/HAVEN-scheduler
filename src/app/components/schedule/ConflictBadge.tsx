import { Popover, PopoverContent, PopoverTrigger } from "@/app/components/ui/popover";
import type { Person } from "@/api/types";

export function ConflictBadge({ person }: { person: Person }) {
  const { sameDay, crossTerm } = person.conflicts;
  if (!sameDay.length && !crossTerm.length) return null;
  const color = sameDay.length ? "bg-red-500" : "bg-amber-400";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-block w-2.5 h-2.5 rounded-full ${color}`}
          aria-label="conflict details"
        />
      </PopoverTrigger>
      <PopoverContent className="text-sm w-64">
        {sameDay.length > 0 && (
          <div className="text-red-700">
            <div className="font-semibold mb-1">Same-day conflict</div>
            <ul>
              {sameDay.map((c, i) => (
                <li key={i}>
                  {c.date} → {c.otherDept}
                </li>
              ))}
            </ul>
          </div>
        )}
        {crossTerm.length > 0 && (
          <div className="text-amber-700 mt-2">
            <div className="font-semibold mb-1">Cross-term conflict</div>
            <ul>
              {crossTerm.map((c, i) => (
                <li key={i}>
                  {c.date} → {c.otherDept}
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
