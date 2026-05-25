import type { AirtableRecord } from "./airtable.js";

export type ScheduleRowForValidation = {
  date: string; // ISO Saturday key
  directorIds: string[];
  volunteerIds: string[];
  shadowIds?: string[];
};

export type ValidateInput = {
  scheduleRows: ScheduleRowForValidation[];
  requesterId: string;
  requesterDate: string;
  targetId?: string;
  targetDate?: string;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

type Role = "director" | "volunteer" | "shadow";

function findRoleOnDate(
  rows: ScheduleRowForValidation[],
  personId: string,
  date: string,
): Role | null {
  const row = rows.find((r) => r.date === date);
  if (!row) return null;
  if (row.directorIds.includes(personId)) return "director";
  if (row.volunteerIds.includes(personId)) return "volunteer";
  if (row.shadowIds?.includes(personId)) return "shadow";
  return null;
}

export function validateRequest(input: ValidateInput): ValidationResult {
  const { scheduleRows, requesterId, requesterDate, targetId, targetDate } =
    input;

  const requesterRole = findRoleOnDate(
    scheduleRows,
    requesterId,
    requesterDate,
  );
  if (!requesterRole)
    return { ok: false, error: "Not assigned to that shift" };

  const hasTargetId = !!targetId;
  const hasTargetDate = !!targetDate;

  // Shadow shifts: drops only. Named swaps don't make sense because shadows
  // are observers, not a regular slot to trade in or out of.
  if (requesterRole === "shadow") {
    if (hasTargetId || hasTargetDate)
      return { ok: false, error: "Shadow shifts can only be dropped, not swapped" };
    return { ok: true };
  }

  if (!hasTargetId && !hasTargetDate) return { ok: true };
  if (hasTargetId !== hasTargetDate)
    return { ok: false, error: "Partner is not eligible" };

  if (targetId === requesterId)
    return { ok: false, error: "Partner is not eligible" };

  const targetRole = findRoleOnDate(
    scheduleRows,
    targetId as string,
    targetDate as string,
  );
  if (!targetRole)
    return { ok: false, error: "Partner is not eligible" };
  if (targetRole === "shadow")
    return { ok: false, error: "Partner is not eligible" };
  if (targetRole !== requesterRole)
    return { ok: false, error: "Partner is not eligible" };

  return { ok: true };
}

export type ScheduleRowForApply = {
  id: string;
  date: string;
  directorIds: string[];
  volunteerIds: string[];
  shadowIds?: string[];
};

export type PatchOp = {
  recordId: string;
  fields: Record<string, string[]>;
};

export type ApplyInput = {
  scheduleRows: ScheduleRowForApply[];
  requesterId: string;
  requesterDate: string;
  targetId?: string;
  targetDate?: string;
};

type ApplyRole = "director" | "volunteer" | "shadow";

function roleOf(row: ScheduleRowForApply, personId: string): ApplyRole | null {
  if (row.directorIds.includes(personId)) return "director";
  if (row.volunteerIds.includes(personId)) return "volunteer";
  if (row.shadowIds?.includes(personId)) return "shadow";
  return null;
}

function fieldForRole(role: ApplyRole): string {
  if (role === "director") return "Directors on Shift";
  if (role === "volunteer") return "Volunteers on Shift";
  return "Shadow Volunteers on Shift";
}

function listForRole(row: ScheduleRowForApply, role: ApplyRole): string[] {
  if (role === "director") return row.directorIds;
  if (role === "volunteer") return row.volunteerIds;
  return row.shadowIds ?? [];
}

function withRemoved(row: ScheduleRowForApply, role: ApplyRole, personId: string): string[] {
  return listForRole(row, role).filter((id) => id !== personId);
}

function withAdded(row: ScheduleRowForApply, role: ApplyRole, personId: string): string[] {
  const list = listForRole(row, role);
  return list.includes(personId) ? list : [...list, personId];
}

export function planApply(input: ApplyInput): PatchOp[] {
  const { scheduleRows, requesterId, requesterDate, targetId, targetDate } = input;

  const requesterRow = scheduleRows.find((r) => r.date === requesterDate);
  if (!requesterRow) throw new Error("Requester's row not found");
  const requesterRole = roleOf(requesterRow, requesterId);
  if (!requesterRole) throw new Error("Requester not assigned to requester date");

  if (!targetId || !targetDate) {
    return [
      {
        recordId: requesterRow.id,
        fields: {
          [fieldForRole(requesterRole)]: withRemoved(requesterRow, requesterRole, requesterId),
        },
      },
    ];
  }

  // Named swaps don't apply to shadow shifts — validate should have rejected this.
  if (requesterRole === "shadow") {
    throw new Error("Shadow shifts cannot be swapped");
  }

  const targetRow = scheduleRows.find((r) => r.date === targetDate);
  if (!targetRow) throw new Error("Target's row not found");

  const requesterListKey = requesterRole === "director" ? "directorIds" : "volunteerIds";

  const requesterPatch: PatchOp = {
    recordId: requesterRow.id,
    fields: {
      [fieldForRole(requesterRole)]: withAdded(
        { ...requesterRow, [requesterListKey]:
            withRemoved(requesterRow, requesterRole, requesterId) },
        requesterRole,
        targetId,
      ),
    },
  };

  const targetPatch: PatchOp = {
    recordId: targetRow.id,
    fields: {
      [fieldForRole(requesterRole)]: withAdded(
        { ...targetRow, [requesterListKey]:
            withRemoved(targetRow, requesterRole, targetId) },
        requesterRole,
        requesterId,
      ),
    },
  };

  return [requesterPatch, targetPatch];
}

export type PatchRecordFn = (opts: {
  baseId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
}) => Promise<AirtableRecord>;

export type ExecuteApplyInput = {
  baseId: string;
  scheduleTableId: string;
  ops: PatchOp[];
  /** Maps recordId → its row as it was BEFORE this apply. Used for rollback. */
  originalRows: Map<string, ScheduleRowForApply>;
  patchRecord: PatchRecordFn;
};

function rollbackFieldsFor(
  row: ScheduleRowForApply,
  changedField: string,
): Record<string, string[]> {
  if (changedField === "Directors on Shift") return { "Directors on Shift": row.directorIds };
  if (changedField === "Volunteers on Shift") return { "Volunteers on Shift": row.volunteerIds };
  if (changedField === "Shadow Volunteers on Shift")
    return { "Shadow Volunteers on Shift": row.shadowIds ?? [] };
  return {};
}

export async function executeApply(input: ExecuteApplyInput): Promise<void> {
  const { baseId, scheduleTableId, ops, originalRows, patchRecord } = input;

  const applied: Array<{ recordId: string; field: string }> = [];

  for (const op of ops) {
    try {
      const [field] = Object.keys(op.fields);
      await patchRecord({
        baseId,
        tableId: scheduleTableId,
        recordId: op.recordId,
        fields: op.fields,
      });
      applied.push({ recordId: op.recordId, field });
    } catch (err) {
      for (const a of applied.reverse()) {
        const original = originalRows.get(a.recordId);
        if (!original) continue;
        try {
          await patchRecord({
            baseId,
            tableId: scheduleTableId,
            recordId: a.recordId,
            fields: rollbackFieldsFor(original, a.field),
          });
        } catch (rollbackErr) {
          console.error("rollback failed for", a.recordId, rollbackErr);
        }
      }
      throw err;
    }
  }
}
