import type { Person } from "@/api/types";
import { ArrowLeftRight, Stethoscope, X } from "lucide-react";
import type { MedRole } from "./capacity";
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

/**
 * Returns the missing-compliance items for a volunteer, or null if the person
 * is fully compliant / not a volunteer (directors don't have a compliance field).
 */
function missingComplianceItems(person: Person): string[] | null {
  if (!person.compliance) return null;
  const missing: string[] = [];
  if (!person.compliance.contract) missing.push("contract");
  if (!person.compliance.training) missing.push("training");
  return missing.length > 0 ? missing : null;
}

const ROLE_LABEL: Record<"clinic" | MedRole, string> = {
  clinic: "Clinic",
  triage: "Triage",
  walkin: "Walk-in",
  cc: "CC",
};

export function PersonRow({
  person,
  isAvailable,
  isAssigned,
  disabled,
  editMode = "assign",
  readOnly = false,
  assignedCount,
  isShadow = false,
  isRemote = false,
  onToggleRemote,
  role,
  roleCycle,
  onCycleRole,
  roleTally,
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
  /** True if this person is currently marked remote for the active Saturday.
   *  Independent of shadow — a shadow can also be remote. */
  isRemote?: boolean;
  /** When provided + person is assigned, render an inline "In person / Remote"
   *  pill the director can click to flip. Undefined hides the affordance, e.g.
   *  in availability mode or in the public viewer. */
  onToggleRemote?: () => void;
  /** Current clinical role of an assigned volunteer (SCTP/JCTP). */
  role?: "clinic" | MedRole;
  /** Special roles available to cycle through for this dept. Empty/undefined hides the control. */
  roleCycle?: MedRole[];
  /** When provided + person assigned + roleCycle non-empty, shows a clickable role pill. */
  onCycleRole?: () => void;
  /** Term-wide role-count summary for the roster, e.g. "Triage 2 · Walk-in 1". */
  roleTally?: string;
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
  const missingCompliance = !readOnly ? missingComplianceItems(person) : null;

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
      {isAssigned && onToggleRemote && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleRemote();
          }}
          disabled={disabled}
          className={`group/remote inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border transition-colors ${
            isRemote
              ? "bg-sky-100 text-sky-800 border-sky-300 hover:bg-sky-200"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title={
            isRemote
              ? "Currently marked Remote. Click to switch to In person."
              : "Currently marked In person. Click to switch to Remote."
          }
        >
          <ArrowLeftRight
            className="w-3 h-3 opacity-60 group-hover/remote:opacity-100 transition-opacity"
            aria-hidden
          />
          {isRemote ? "Remote" : "In person"}
        </button>
      )}
      {isAssigned && roleCycle && roleCycle.length > 0 && onCycleRole && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCycleRole();
          }}
          disabled={disabled}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border transition-colors ${
            role && role !== "clinic"
              ? "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:border-slate-400"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="Click to change clinical role"
        >
          <Stethoscope className="w-3 h-3 opacity-60" aria-hidden />
          {ROLE_LABEL[role ?? "clinic"]}
        </button>
      )}
      {isRemote && !onToggleRemote && (
        <span
          className="text-[10px] uppercase tracking-wide text-sky-800 bg-sky-100 px-1.5 py-0.5 rounded font-semibold"
          title="Attending remotely"
        >
          remote
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
      {!readOnly && person.returning && (
        <span
          className="text-[10px] uppercase tracking-wide text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded font-semibold"
          title="Returning volunteer (from application)."
        >
          returning
        </span>
      )}
      {!readOnly && person.spanishSpeaking && (
        <span
          className="text-[10px] uppercase tracking-wide text-teal-800 bg-teal-100 px-1.5 py-0.5 rounded font-semibold"
          title="Spanish-speaking."
        >
          ES
        </span>
      )}
      {!readOnly && person.licensedRN && (
        <span
          className="text-[10px] uppercase tracking-wide text-rose-800 bg-rose-100 px-1.5 py-0.5 rounded font-semibold"
          title="Licensed RN."
        >
          RN
        </span>
      )}
      {!readOnly && roleTally && (
        <span
          className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded tabular-nums"
          title="Clinical-role assignments across the term."
        >
          {roleTally}
        </span>
      )}
      {missingCompliance && (
        <span
          className="text-[10px] uppercase tracking-wide text-red-800 bg-red-100 px-1.5 py-0.5 rounded font-semibold"
          title={`Compliance check (HAVEN Management → Compliance): missing ${missingCompliance.join(" + ")}.`}
        >
          missing: {missingCompliance.join(" + ")}
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
