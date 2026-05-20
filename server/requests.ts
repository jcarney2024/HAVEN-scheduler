export type ScheduleRowForValidation = {
  date: string; // ISO Saturday key
  directorIds: string[];
  volunteerIds: string[];
};

export type ValidateInput = {
  scheduleRows: ScheduleRowForValidation[];
  requesterId: string;
  requesterDate: string;
  targetId?: string;
  targetDate?: string;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

type Role = "director" | "volunteer";

function findRoleOnDate(
  rows: ScheduleRowForValidation[],
  personId: string,
  date: string,
): Role | null {
  const row = rows.find((r) => r.date === date);
  if (!row) return null;
  if (row.directorIds.includes(personId)) return "director";
  if (row.volunteerIds.includes(personId)) return "volunteer";
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
  if (targetRole !== requesterRole)
    return { ok: false, error: "Partner is not eligible" };

  return { ok: true };
}

export type ScheduleRowForApply = {
  id: string;
  date: string;
  directorIds: string[];
  volunteerIds: string[];
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

function roleOf(row: ScheduleRowForApply, personId: string): "director" | "volunteer" | null {
  if (row.directorIds.includes(personId)) return "director";
  if (row.volunteerIds.includes(personId)) return "volunteer";
  return null;
}

function fieldForRole(role: "director" | "volunteer"): string {
  return role === "director" ? "Directors on Shift" : "Volunteers on Shift";
}

function withRemoved(row: ScheduleRowForApply, role: "director" | "volunteer", personId: string): string[] {
  const list = role === "director" ? row.directorIds : row.volunteerIds;
  return list.filter((id) => id !== personId);
}

function withAdded(row: ScheduleRowForApply, role: "director" | "volunteer", personId: string): string[] {
  const list = role === "director" ? row.directorIds : row.volunteerIds;
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

  const targetRow = scheduleRows.find((r) => r.date === targetDate);
  if (!targetRow) throw new Error("Target's row not found");

  const requesterPatch: PatchOp = {
    recordId: requesterRow.id,
    fields: {
      [fieldForRole(requesterRole)]: withAdded(
        { ...requesterRow, [requesterRole === "director" ? "directorIds" : "volunteerIds"]:
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
        { ...targetRow, [requesterRole === "director" ? "directorIds" : "volunteerIds"]:
            withRemoved(targetRow, requesterRole, targetId) },
        requesterRole,
        requesterId,
      ),
    },
  };

  return [requesterPatch, targetPatch];
}
