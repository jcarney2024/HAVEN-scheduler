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
