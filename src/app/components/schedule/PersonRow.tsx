import type { Person } from "@/api/types";
import { X } from "lucide-react";
import { ConflictBadge } from "./ConflictBadge";

/**
 * True if the volunteer has submitted a self-update of their availability AND
 * a director hasn't acknowledged it yet (or acked an older update).
 */
function hasUnacknowledgedUpdate(person: Person): boolean {
  if (!person.volunteerUpdatedAt) return false;
  if (!person.volunteerUpdateAcknowledgedAt) return true;
  return person.volunteerUpdateAcknowledgedAt < person.volunteerUpdatedAt;
}

export function PersonRow({
  person,
  isAvailable,
  isAssigned,
  disabled,
  editMode = "assign",
  readOnly = false,
  assignedCount,
  isShadow = false,
  onToggle,
  onRemove,
  onAcknowledgeUpdate,
}: {
  person: Person;
  isAvailable: boolean;
  isAssigned: boolean;
  disabled: boolean;
  editMode?: "assign" | "availability";
  readOnly?: boolean;
  /** Count of in-department shifts this volunteer is already assigned to. When
   *  provided alongside person.minShiftsWanted, the row shows an "X / N" pill. */
  assignedCount?: number;
  /** True if this volunteer is currently a shadow on the active Saturday. Used
   *  in assign mode to show a "shadow" badge so directors can tell at a glance. */
  isShadow?: boolean;
  onToggle: () => void;
  /** If provided, shows a small ✕ button. Used to drop a volunteer from a dept. */
  onRemove?: () => void;
  /** If provided and the volunteer has an unacknowledged self-update, shows an
   *  "updated" chip that, when clicked, calls this to ack the update. */
  onAcknowledgeUpdate?: () => void;
}) {
  const accent = editMode === "availability" ? "accent-amber-500" : "accent-[#0F4D92]";
  const interactive = !readOnly && !disabled;
  const showUpdatedBadge = !readOnly && hasUnacknowledgedUpdate(person);
  const updatedTooltip = person.volunteerUpdatedAt
    ? `Volunteer updated their availability on ${new Date(
        person.volunteerUpdatedAt,
      ).toLocaleDateString()}. Click to acknowledge.`
    : "Volunteer updated their availability since application time.";

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
      {isShadow && (
        <span
          className="text-[10px] uppercase tracking-wide text-purple-800 bg-purple-100 px-1.5 py-0.5 rounded font-semibold"
          title="Shadowing this shift"
        >
          shadow
        </span>
      )}
      {!readOnly &&
        editMode === "assign" &&
        person.minShiftsWanted != null &&
        assignedCount != null && (
          <span
            className="text-[11px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded tabular-nums"
            title={`Wants at least ${person.minShiftsWanted} shift${person.minShiftsWanted === "1" ? "" : "s"} this term. Currently assigned to ${assignedCount} in this department.`}
          >
            {assignedCount} / {person.minShiftsWanted}
          </span>
        )}
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
      {showUpdatedBadge && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAcknowledgeUpdate?.();
          }}
          disabled={!onAcknowledgeUpdate}
          className="text-[10px] uppercase tracking-wide text-yellow-900 bg-yellow-200 hover:bg-yellow-300 disabled:hover:bg-yellow-200 disabled:cursor-default px-1.5 py-0.5 rounded font-semibold"
          title={updatedTooltip}
        >
          updated
        </button>
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
