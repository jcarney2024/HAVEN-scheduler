export type ComplianceFlags = { contract: boolean; training: boolean };

export type ComplianceRow = {
  /** All People record ids linked via the Compliance row's "Names" field. */
  personIds: string[];
  contract: boolean;
  training: boolean;
};

/**
 * Aggregate Compliance rows into a per-person map. OR'd across all rows: a
 * contract on file once is enough, even if it lives on a different role's row.
 */
export function buildComplianceByPersonId(
  rows: ComplianceRow[],
): Map<string, ComplianceFlags> {
  const out = new Map<string, ComplianceFlags>();
  for (const row of rows) {
    for (const pid of row.personIds) {
      const prev = out.get(pid) ?? { contract: false, training: false };
      out.set(pid, {
        contract: prev.contract || row.contract,
        training: prev.training || row.training,
      });
    }
  }
  return out;
}

export type NonCompliantVolunteer = {
  id: string;
  name: string;
  missing: ("contract" | "training")[]; // non-empty
};

/**
 * For each department, the volunteers missing a contract and/or training.
 * No compliance entry for a volunteer means missing both. Departments map to
 * an empty array when every volunteer is compliant.
 */
export function buildNonCompliantByDept(args: {
  depts: { id: string; volunteerIds: string[] }[];
  complianceByPersonId: Map<string, ComplianceFlags>;
  nameById: Map<string, string>;
}): Map<string, NonCompliantVolunteer[]> {
  const out = new Map<string, NonCompliantVolunteer[]>();
  for (const dept of args.depts) {
    const list: NonCompliantVolunteer[] = [];
    for (const id of dept.volunteerIds) {
      const flags = args.complianceByPersonId.get(id) ?? {
        contract: false,
        training: false,
      };
      const missing: ("contract" | "training")[] = [];
      if (!flags.contract) missing.push("contract");
      if (!flags.training) missing.push("training");
      if (missing.length > 0) {
        list.push({ id, name: args.nameById.get(id) ?? id, missing });
      }
    }
    out.set(dept.id, list);
  }
  return out;
}

export type VolunteerComplianceResult = {
  contract: boolean;
  training: boolean;
  hipaaCompliant: boolean;
  overallCompliant: boolean;
  /** Failing items in UI order: training, contract, hipaa. */
  missing: ("contract" | "training" | "hipaa")[];
};

/**
 * Volunteer-facing compliance verdict from the three items a volunteer can act
 * on: Volunteer Training, Volunteer Contract, and the HIPAA certificate.
 * HIPAA is compliant ONLY when the status is exactly "Compliant"; any other
 * value (including blank/unset) is treated as not compliant so the upload CTA
 * shows rather than a false green.
 */
export function evaluateVolunteerCompliance(input: {
  contract: boolean;
  training: boolean;
  hipaaStatus: string;
}): VolunteerComplianceResult {
  const hipaaCompliant = input.hipaaStatus.trim() === "Compliant";
  const missing: ("contract" | "training" | "hipaa")[] = [];
  if (!input.training) missing.push("training");
  if (!input.contract) missing.push("contract");
  if (!hipaaCompliant) missing.push("hipaa");
  return {
    contract: input.contract,
    training: input.training,
    hipaaCompliant,
    overallCompliant: input.contract && input.training && hipaaCompliant,
    missing,
  };
}
