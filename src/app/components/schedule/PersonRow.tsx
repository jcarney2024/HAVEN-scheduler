import type { Person } from "@/api/types";
import { X } from "lucide-react";
import { ConflictBadge } from "./ConflictBadge";

export function PersonRow({
  person,
  isAvailable,
  isAssigned,
  disabled,
  editMode = "assign",
  readOnly = false,
  onToggle,
  onRemove,
}: {
  person: Person;
  isAvailable: boolean;
  isAssigned: boolean;
  disabled: boolean;
  editMode?: "assign" | "availability";
  readOnly?: boolean;
  onToggle: () => void;
  /** If provided, shows a small ✕ button. Used to drop a volunteer from a dept. */
  onRemove?: () => void;
}) {
  const accent = editMode === "availability" ? "accent-amber-500" : "accent-[#0F4D92]";
  const interactive = !readOnly && !disabled;

  return (
    <label
      className={`group flex items-center gap-3 p-2 rounded-md transition-colors ${
        interactive ? "cursor-pointer hover:bg-slate-50" : "cursor-default"
      } ${!readOnly && disabled ? "cursor-not-allowed opacity-50" : ""} ${
        editMode === "assign" && !isAvailable && !readOnly ? "text-slate-500" : ""
      }`}
    >
      {!readOnly && (
        <input
          type="checkbox"
          checked={isAssigned}
          disabled={disabled}
          onChange={onToggle}
          className={`w-4 h-4 ${accent}`}
        />
      )}
      <span className="flex-1">{person.name || person.netid}</span>
      {!readOnly && editMode === "assign" && !isAvailable && (
        <span className="text-xs text-slate-400">not avail</span>
      )}
      {!readOnly && person.availabilityOverridden && (
        <span
          className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
          title="Availability has been overridden by a director."
        >
          override
        </span>
      )}
      {!readOnly && <ConflictBadge person={person} />}
      {!readOnly && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          disabled={disabled}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-slate-400 hover:text-red-600 disabled:hover:text-slate-400 disabled:cursor-not-allowed p-1"
          title="Remove from department"
          aria-label="Remove from department"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </label>
  );
}
