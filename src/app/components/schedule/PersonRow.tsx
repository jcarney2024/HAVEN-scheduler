import type { Person } from "@/api/types";
import { ConflictBadge } from "./ConflictBadge";

export function PersonRow({
  person,
  isAvailable,
  isAssigned,
  disabled,
  onToggle,
}: {
  person: Person;
  isAvailable: boolean;
  isAssigned: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
        disabled ? "cursor-not-allowed opacity-50" : "hover:bg-slate-50"
      } ${!isAvailable ? "text-slate-500" : ""}`}
    >
      <input
        type="checkbox"
        checked={isAssigned}
        disabled={disabled}
        onChange={onToggle}
        className="w-4 h-4 accent-[#0F4D92]"
      />
      <span className="flex-1">{person.name || person.netid}</span>
      {!isAvailable && (
        <span className="text-xs text-slate-400">not avail</span>
      )}
      <ConflictBadge person={person} />
    </label>
  );
}
