import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createRecord, deleteRecord, escapeFormulaString, listAll, patchRecord, type AirtableRecord } from "./airtable.js";
import { CANONICAL_DATES, normalizeVolunteerDate, normalizeDirectorDate, displayDate } from "./dates.js";
import { computeConflicts, type ScheduleEntry } from "./conflicts.js";
import { validateRequest, planApply, executeApply } from "./requests.js";
import { loadConfig, type Config } from "./config.js";
import { shapePublicSchedule } from "./public.js";
import { withRoleMembersOnShift } from "./medteam.js";
import {
  computeClinicReadiness,
  type Attending,
  type ProcedureStatus,
  type PersonLite,
} from "./rhd.js";
import {
  buildComplianceByPersonId,
  buildNonCompliantByDept,
  type ComplianceRow,
} from "./compliance.js";

type AllPeopleFields = {
  NetID?: string;
  "Contact Email"?: string;
  Name?: string;
  // Director-controlled overrides; comma-separated display dates ("May 30th, June 6th, ...").
  // If non-empty, these REPLACE the applicant-base availability for this person+kind.
  "SU 26 — Available as Director"?: string;
  "SU 26 — Available as Volunteer"?: string;
  // Volunteer self-update of availability via the public portal. Same comma-separated
  // format as the override fields. Resolution order in buildPerson (volunteer kind):
  // director override → volunteer self-update → applicant baseline.
  "SU 26 — Volunteer-Updated Availability"?: string;
  "SU 26 — Volunteer Updated At"?: string;
  // When a director acked the most recent volunteer self-update. If null OR
  // older than "SU 26 — Volunteer Updated At", the builder shows an updated badge.
  "SU 26 — Volunteer Update Acknowledged At"?: string;
  "Spanish Speaking"?: boolean;
  "Returning Volunteer"?: boolean;
  "Licensed RN"?: boolean;
};

type Su26RosterFields = {
  "Department Name"?: string;
  Directors?: unknown;
  Volunteers?: unknown;
  "Submitted At"?: string;
  "Submitted By"?: unknown;
  "Ideal Headcount"?: number;
  "Patient Capacity Per Provider"?: number;
};

type DirectorAppFields = {
  "Yale NetID"?: string;
  "What is your spring availability?"?: unknown;
  "Link your Staff Record"?: unknown;
};

type VolunteerAppFields = {
  NetID?: string;
  "General Availability"?: unknown;
  "Link your record"?: unknown;
  "Spanish Proficiency Level"?: unknown;
};

type StaffMirrorFields = {
  NetID?: string;
  Name?: string;
};

type VolunteerTrainingAttendanceFields = {
  "Applicant Record"?: unknown;
  "Minimum Shifts Wanted"?: unknown;
};

// Compliance table (HAVEN Management). One or more rows per person via Names,
// which is a multipleRecordLinks into All People. We OR the two
// volunteer-relevant checkboxes across all rows for a person — having a contract
// on file once is enough, regardless of which row carries it.
type ComplianceFields = {
  Names?: unknown;
  "Volunteer Contract"?: boolean;
  "Volunteer Training"?: boolean;
};

type ScheduleRowFields = {
  Department?: unknown;
  Date?: unknown;
  "Directors on Shift"?: unknown;
  "Volunteers on Shift"?: unknown;
  // Optional. Volunteers attending in a shadowing/observation role. Tracked
  // separately from "Volunteers on Shift" so departments that don't use it
  // can ignore it. Counts toward each volunteer's "X / N" shift-target pill.
  "Shadow Volunteers on Shift"?: unknown;
  // Optional. Subset of the people in any of the on-shift fields above who
  // are attending remotely. Membership here is just a flag — the role still
  // comes from the regular/shadow assignment lists. Empty for departments
  // that don't use the feature.
  "Remote on Shift"?: unknown;
  "Triage on Shift"?: unknown;
  "Walk-in on Shift"?: unknown;
  "CC on Shift"?: unknown;
  "Patients Booked"?: number;
};

type RhdAttendingFields = {
  "Schedule Name"?: string;
  "Full Name"?: string;
  "IUD In"?: unknown; "IUD Out"?: unknown; "Nexplanon"?: unknown;
  "GAC"?: unknown; "EMB"?: unknown; "Sees Male"?: unknown;
  "Notes"?: string;
};

type RhdClinicFields = {
  Date?: unknown;
  Attending?: unknown;
  "Director on point"?: string;
  "Procedures Booked"?: number;
};

type ShiftRequestFields = {
  Department?: unknown;
  Requester?: unknown;
  "Requester Email"?: string;
  "Requester Date"?: unknown;
  Target?: unknown;
  "Target Date"?: unknown;
  Type?: string;
  Note?: string;
  Status?: unknown;
  Resolver?: unknown;
  "Resolution Note"?: string;
  "Submitted At"?: string;
  "Resolved At"?: string;
};

// Departments whose directors get master access — they can view + edit
// every department's schedule, not just their own.
const ADMIN_DEPT_NAMES = ["ITCM", "EXEC"];

// Cross-department delegation: directors of the key dept can manage the
// listed depts on top of their own. Add entries as the org structure grows.
const MANAGES_OTHER_DEPTS: Record<string, string[]> = {
  VADC: ["VADM"],
  SRHD: ["SCTS", "JCTS", "CCRH"],
  PCAR: ["SCTP", "JCTP"],
};

const RHD_DEPTS = ["SCTS", "JCTS", "CCRH"] as const;
const DEFAULT_MAX_PROCEDURES_PER_CLINIC = 3;

export const app = new Hono();
app.use("*", cors());
app.use("*", logger());

// ---------- Public endpoints (no auth) -----------------------------------

app.get("/view", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const rows = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  // Only surface depts whose director has clicked Submit at least once.
  // Submit is just an informational timestamp now (no lock), but it's still
  // the signal of "this schedule is ready for volunteers to see."
  const depts = rows
    .filter((r) => !!r.fields["Submitted At"])
    .map((r) => ({ id: r.id, name: r.fields["Department Name"] ?? "" }))
    .filter((d) => !!d.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return c.json(depts);
});

app.get("/view/:deptId", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const deptId = c.req.param("deptId");
  const allDepts = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = allDepts.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Not found" }, 404);

  const scheduleRows = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
    filterByFormula: `{Department} = '${escapeFormulaString(dept.fields["Department Name"] ?? "")}'`,
  });

  const allPeople = await listAll<AllPeopleFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
  });
  const peopleById = new Map(
    allPeople.map((p) => [p.id, { id: p.id, name: p.fields.Name ?? "" }] as const),
  );

  const normalizedRows = scheduleRows
    .map((row) => {
      const iso = normalizeVolunteerDate(selectName(row.fields.Date));
      if (!iso) return null;
      return {
        date: iso,
        directorIds: toIdList(row.fields["Directors on Shift"]),
        volunteerIds: toIdList(row.fields["Volunteers on Shift"]),
        shadowIds: toIdList(row.fields["Shadow Volunteers on Shift"]),
        remoteIds: toIdList(row.fields["Remote on Shift"]),
      };
    })
    .filter(
      (r): r is {
        date: string;
        directorIds: string[];
        volunteerIds: string[];
        shadowIds: string[];
        remoteIds: string[];
      } => r !== null,
    );

  const shaped = shapePublicSchedule({
    dept: {
      id: dept.id,
      name: dept.fields["Department Name"] ?? "",
    },
    peopleById,
    scheduleRows: normalizedRows,
  });

  c.header("Cache-Control", "public, max-age=60, must-revalidate");
  return c.json(shaped);
});

async function getConfig(): Promise<Config | null> {
  return loadConfig();
}

// Airtable's REST API returns linked record fields as bare string[] (record IDs).
// Some other tooling returns [{id, name}, ...]. Accept both shapes.
function toIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : (v as { id?: string }).id ?? ""))
    .filter((s): s is string => !!s);
}

// multipleSelects in the REST API return string[] (option names). MCP returns
// [{id, name, color}, ...]. Accept both.
function toNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v : (v as { name?: string }).name ?? ""))
    .filter((s): s is string => !!s);
}

/**
 * Parse the "SU 26 — Available as Director/Volunteer" text field.
 * - Empty/whitespace → null (caller should fall back to base availability)
 * - Non-empty → array of ISO date strings (possibly empty if no valid dates parsed)
 */
function parseAvailabilityOverride(value: string | undefined): string[] | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed
    .split(/[,;\n]/)
    .map((s) => normalizeVolunteerDate(s.trim()))
    .filter((x): x is string => !!x);
}

// singleSelect in REST returns a string; MCP returns {id, name, color}.
function selectName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name ?? "");
  }
  return "";
}

/**
 * Append a row to the SU 26 Login Log. Fire-and-forget — never block or fail
 * the sign-in if Airtable is slow/down. Errors are logged server-side so we
 * notice without breaking auth for users.
 */
function logSignIn(
  config: Config,
  person: AirtableRecord<AllPeopleFields>,
  surface: "Director" | "Public viewer",
  userAgent: string,
): void {
  const at = new Date();
  const stamp = at.toISOString().replace("T", " ").slice(0, 16);
  const name = person.fields.Name ?? person.fields.NetID ?? "Unknown";
  const summary = `${name} signed in (${surface}) — ${stamp}`;
  createRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26LoginLogTableId,
    fields: {
      Summary: summary,
      Person: [person.id],
      NetID: (person.fields.NetID ?? "").toLowerCase(),
      Email: (person.fields["Contact Email"] ?? "").toLowerCase(),
      Surface: surface,
      "Signed In At": at.toISOString(),
      "User Agent": userAgent.slice(0, 500),
    },
  }).catch((err) => {
    console.error("[login-log] failed to write:", err);
  });
}

async function findPerson(config: Config, netid: string, email: string) {
  const safeNetid = escapeFormulaString(netid.toLowerCase());
  const safeEmail = escapeFormulaString(email.toLowerCase());
  const formula = `AND(LOWER({NetID}) = '${safeNetid}', LOWER({Contact Email}) = '${safeEmail}')`;
  const records = await listAll<AllPeopleFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
    filterByFormula: formula,
    pageSize: 1,
  });
  return records[0] ?? null;
}

// A caller has master admin access if they're a director on ITCM or EXEC.
function isAdminPerson(
  allRoster: AirtableRecord<Su26RosterFields>[],
  personId: string,
): boolean {
  return allRoster.some((d) => {
    const name = d.fields["Department Name"] ?? "";
    if (!ADMIN_DEPT_NAMES.includes(name)) return false;
    return toIdList(d.fields.Directors).includes(personId);
  });
}

/**
 * Set of department record IDs this person is allowed to manage.
 * - Admins (ITCM/EXEC directors) manage every department.
 * - Otherwise: depts where they're a director + any cross-managed depts via
 *   MANAGES_OTHER_DEPTS (e.g., SRHD director also manages SCTS/JCTS/CCRH).
 */
function manageableDeptIdsFor(
  allRoster: AirtableRecord<Su26RosterFields>[],
  personId: string,
): Set<string> {
  if (isAdminPerson(allRoster, personId)) {
    return new Set(allRoster.map((d) => d.id));
  }

  const idByName = new Map<string, string>();
  for (const d of allRoster) {
    const name = d.fields["Department Name"];
    if (name) idByName.set(name, d.id);
  }

  const out = new Set<string>();
  for (const d of allRoster) {
    if (!toIdList(d.fields.Directors).includes(personId)) continue;
    out.add(d.id);
    const name = d.fields["Department Name"] ?? "";
    for (const targetName of MANAGES_OTHER_DEPTS[name] ?? []) {
      const tid = idByName.get(targetName);
      if (tid) out.add(tid);
    }
  }
  return out;
}

function resolveAppNetidStandalone(
  direct: string | undefined,
  linkFieldValue: unknown,
  staffNetidById: Map<string, string>,
): string {
  if (direct && direct.trim()) return direct.trim().toLowerCase();
  const linkedIds = toIdList(linkFieldValue);
  for (const id of linkedIds) {
    const nid = staffNetidById.get(id);
    if (nid) return nid;
  }
  return "";
}

function procStatus(v: unknown): ProcedureStatus {
  const s = selectName(v).trim().toLowerCase();
  return s === "yes" ? "yes" : s === "no" ? "no" : "unknown";
}

function toAttending(row: AirtableRecord<RhdAttendingFields>): Attending {
  const f = row.fields;
  return {
    id: row.id,
    scheduleName: f["Schedule Name"] ?? "",
    fullName: f["Full Name"] ?? "",
    procedures: {
      iudIn: procStatus(f["IUD In"]), iudOut: procStatus(f["IUD Out"]),
      nexplanon: procStatus(f["Nexplanon"]), gac: procStatus(f["GAC"]),
      emb: procStatus(f["EMB"]), seesMale: procStatus(f["Sees Male"]),
    },
    notes: f["Notes"] || undefined,
  };
}

app.post(`/director/:netid`, async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const netid = c.req.param("netid");
  const { email } = (await c.req.json()) as { email?: string };
  if (!netid || !email) return c.json({ error: "Missing netid or email" }, 400);

  const person = await findPerson(config, netid, email);
  if (!person) return c.json({ error: "Not found" }, 404);

  const allRoster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const isAdmin = isAdminPerson(allRoster, person.id);
  const manageable = manageableDeptIdsFor(allRoster, person.id);
  const visibleDepts = allRoster.filter((d) => manageable.has(d.id));

  if (visibleDepts.length === 0) {
    return c.json({ error: "Not a SU 26 director" }, 403);
  }

  logSignIn(config, person, "Director", c.req.header("user-agent") ?? "");

  // Sort: home departments (where they're listed as a director) first, then
  // delegated/admin depts, then alphabetical within each group.
  const sorted = [...visibleDepts].sort((a, b) => {
    const aHome = toIdList(a.fields.Directors).includes(person.id) ? 0 : 1;
    const bHome = toIdList(b.fields.Directors).includes(person.id) ? 0 : 1;
    if (aHome !== bHome) return aHome - bHome;
    return (a.fields["Department Name"] ?? "").localeCompare(b.fields["Department Name"] ?? "");
  });

  // Load pending requests and count by department
  const pendingForCounts = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `{Status} = 'Pending'`,
  });
  const pendingCountByDept = new Map<string, number>();
  for (const r of pendingForCounts) {
    const d = toIdList(r.fields.Department)[0];
    if (d) pendingCountByDept.set(d, (pendingCountByDept.get(d) ?? 0) + 1);
  }

  // Compliance summary per department for the sign-in banner.
  const allCompliance = await listAll<ComplianceFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.complianceTableId,
    fields: ["Names", "Volunteer Contract", "Volunteer Training"],
  });
  const complianceByPersonId = buildComplianceByPersonId(
    allCompliance.map(
      (row): ComplianceRow => ({
        personIds: toIdList(row.fields.Names),
        contract: row.fields["Volunteer Contract"] === true,
        training: row.fields["Volunteer Training"] === true,
      }),
    ),
  );

  const deptVolunteerIds = sorted.map((d) => ({
    id: d.id,
    volunteerIds: toIdList(d.fields.Volunteers),
  }));
  const allVolunteerIds = [
    ...new Set(deptVolunteerIds.flatMap((d) => d.volunteerIds)),
  ];
  const volunteerPeople = allVolunteerIds.length
    ? await listAll<AllPeopleFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.allPeopleTableId,
        filterByFormula: `OR(${allVolunteerIds
          .map((id) => `RECORD_ID() = '${id}'`)
          .join(",")})`,
        fields: ["Name"],
      })
    : [];
  const nameById = new Map(
    volunteerPeople.map((p) => [p.id, p.fields.Name ?? ""]),
  );
  const nonCompliantByDept = buildNonCompliantByDept({
    depts: deptVolunteerIds,
    complianceByPersonId,
    nameById,
  });

  return c.json({
    person: {
      id: person.id,
      name: person.fields.Name ?? "",
      netid: person.fields.NetID ?? "",
      email: person.fields["Contact Email"] ?? "",
    },
    isAdmin,
    departments: sorted.map((d) => ({
      id: d.id,
      name: d.fields["Department Name"] ?? "",
      pendingRequestCount: pendingCountByDept.get(d.id) ?? 0,
      nonCompliantVolunteers: nonCompliantByDept.get(d.id) ?? [],
    })),
  });
});

app.post(`/schedule/:deptId`, async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const deptId = c.req.param("deptId");
  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
  };
  if (!deptId || !callerNetid || !callerEmail) {
    return c.json({ error: "Missing deptId / callerNetid / callerEmail" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const [
    allRoster,
    allSchedule,
    allDirectorApps,
    allVolunteerApps,
    directorStaff,
    volunteerStaff,
    volunteerTraining,
    allCompliance,
  ] = await Promise.all([
    listAll<Su26RosterFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26RosterTableId,
    }),
    listAll<ScheduleRowFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
    }),
    listAll<DirectorAppFields>({
      baseId: config.directorAppsBaseId,
      tableId: config.directorAppsTableId,
      fields: ["Yale NetID", "What is your spring availability?", "Link your Staff Record"],
    }),
    listAll<VolunteerAppFields>({
      baseId: config.volunteerAppsBaseId,
      tableId: config.volunteerAppsTableId,
      fields: ["NetID", "General Availability", "Link your record", "Spanish Proficiency Level"],
    }),
    listAll<StaffMirrorFields>({
      baseId: config.directorAppsBaseId,
      tableId: config.directorAppsStaffTableId,
      fields: ["NetID"],
    }),
    listAll<StaffMirrorFields>({
      baseId: config.volunteerAppsBaseId,
      tableId: config.volunteerAppsStaffTableId,
      fields: ["NetID"],
    }),
    listAll<VolunteerTrainingAttendanceFields>({
      baseId: config.volunteerAppsBaseId,
      tableId: config.volunteerTrainingAttendanceTableId,
      fields: ["Applicant Record", "Minimum Shifts Wanted"],
    }),
    listAll<ComplianceFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.complianceTableId,
      fields: ["Names", "Volunteer Contract", "Volunteer Training"],
    }),
  ]);

  // All People recordId → aggregated volunteer compliance.
  const complianceByPersonId = buildComplianceByPersonId(
    allCompliance.map(
      (row): ComplianceRow => ({
        personIds: toIdList(row.fields.Names),
        contract: row.fields["Volunteer Contract"] === true,
        training: row.fields["Volunteer Training"] === true,
      }),
    ),
  );

  // Recruitment-base "Everyone by name" tables hold the NetID; Applications
  // records link to them via "Link your Staff Record" / "Link your record".
  const directorStaffNetidById = new Map<string, string>(
    directorStaff
      .filter((s) => s.fields.NetID)
      .map((s) => [s.id, (s.fields.NetID ?? "").toLowerCase()]),
  );
  const volunteerStaffNetidById = new Map<string, string>(
    volunteerStaff
      .filter((s) => s.fields.NetID)
      .map((s) => [s.id, (s.fields.NetID ?? "").toLowerCase()]),
  );

  const dept = allRoster.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);
  const callerIsDeptDirector = manageableDeptIdsFor(allRoster, caller.id).has(deptId);

  // dept name lookup for ScheduleEntry construction
  const deptNameById = new Map<string, string>(
    allRoster.map((d) => [d.id, d.fields["Department Name"] ?? ""])
  );

  // Resolve an application's NetID: prefer the direct field, fall back to the
  // linked staff record's NetID. Most applicants only have the link.
  function resolveAppNetid(
    direct: string | undefined,
    linkFieldValue: unknown,
    staffNetidById: Map<string, string>,
  ): string {
    if (direct && direct.trim()) return direct.trim().toLowerCase();
    const linkedIds = toIdList(linkFieldValue);
    for (const id of linkedIds) {
      const nid = staffNetidById.get(id);
      if (nid) return nid;
    }
    return "";
  }

  // build NetID → ISO[] availability lookups
  const directorAvail = new Map<string, string[]>();
  for (const r of allDirectorApps) {
    const nid = resolveAppNetid(
      r.fields["Yale NetID"],
      r.fields["Link your Staff Record"],
      directorStaffNetidById,
    );
    if (!nid) continue;
    const names = toNameList(r.fields["What is your spring availability?"]);
    directorAvail.set(
      nid,
      names.map((n) => normalizeDirectorDate(n)).filter((x): x is string => !!x),
    );
  }
  const volAvail = new Map<string, string[]>();
  for (const r of allVolunteerApps) {
    const nid = resolveAppNetid(
      r.fields.NetID,
      r.fields["Link your record"],
      volunteerStaffNetidById,
    );
    if (!nid) continue;
    const names = toNameList(r.fields["General Availability"]);
    volAvail.set(
      nid,
      names.map((n) => normalizeVolunteerDate(n)).filter((x): x is string => !!x),
    );
  }

  // applicantRecordId → "Minimum Shifts Wanted" raw value ("4"…"9+").
  // Training records without a min-shifts value are skipped — those volunteers
  // get no badge.
  const minShiftsByAppId = new Map<string, string>();
  for (const r of volunteerTraining) {
    const min = selectName(r.fields["Minimum Shifts Wanted"]);
    if (!min) continue;
    const appId = toIdList(r.fields["Applicant Record"])[0];
    if (!appId) continue;
    // First record wins — the Applicant Record link is configured as
    // prefersSingleRecordLink so duplicates aren't expected.
    if (!minShiftsByAppId.has(appId)) minShiftsByAppId.set(appId, min);
  }
  const volMinShifts = new Map<string, string>();
  for (const r of allVolunteerApps) {
    const nid = resolveAppNetid(
      r.fields.NetID,
      r.fields["Link your record"],
      volunteerStaffNetidById,
    );
    if (!nid) continue;
    const min = minShiftsByAppId.get(r.id);
    if (min) volMinShifts.set(nid, min);
  }

  // NetID → true when the volunteer reported Spanish proficiency at
  // "Conversational" or above on their application. This drives spanishSpeaking
  // live (auto-syncs as applications change); the manual "Spanish Speaking"
  // checkbox on All People is OR'd in as an override for people the app doesn't
  // cover (e.g. directors).
  const SPANISH_CONVERSATIONAL_PLUS = new Set([
    "Conversational",
    "Fluent (native)",
    "Fluent (non-native)",
  ]);
  const volSpanish = new Map<string, boolean>();
  for (const r of allVolunteerApps) {
    const nid = resolveAppNetid(
      r.fields.NetID,
      r.fields["Link your record"],
      volunteerStaffNetidById,
    );
    if (!nid) continue;
    if (SPANISH_CONVERSATIONAL_PLUS.has(selectName(r.fields["Spanish Proficiency Level"]))) {
      volSpanish.set(nid, true);
    }
  }

  // fetch All People for everyone on this dept's roster (one batch)
  const dirIds = toIdList(dept.fields.Directors);
  const volIds = toIdList(dept.fields.Volunteers);
  const allIds = [...dirIds, ...volIds];
  const people = allIds.length
    ? await listAll<AllPeopleFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.allPeopleTableId,
        filterByFormula: `OR(${allIds.map((id) => `RECORD_ID() = '${id}'`).join(",")})`,
      })
    : [];
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const scheduleEntries: ScheduleEntry[] = allSchedule
    .map((row): ScheduleEntry | null => {
      const deptRefIds = toIdList(row.fields.Department);
      const deptRefId = deptRefIds[0];
      const dateName = selectName(row.fields.Date);
      const iso = normalizeVolunteerDate(dateName);
      if (!deptRefId || !iso) return null;
      return {
        date: iso,
        departmentId: deptRefId,
        departmentName: deptNameById.get(deptRefId) ?? "",
        directorIds: toIdList(row.fields["Directors on Shift"]),
        volunteerIds: toIdList(row.fields["Volunteers on Shift"]),
        shadowIds: toIdList(row.fields["Shadow Volunteers on Shift"]),
      };
    })
    .filter((x): x is ScheduleEntry => !!x);

  function buildPerson(id: string, kind: "director" | "volunteer") {
    const person = peopleById.get(id);
    const netid = (person?.fields.NetID ?? "").toLowerCase();
    const overrideField =
      kind === "director"
        ? person?.fields["SU 26 — Available as Director"]
        : person?.fields["SU 26 — Available as Volunteer"];
    const overrideDates = parseAvailabilityOverride(overrideField);
    const volunteerSelfDates =
      kind === "volunteer"
        ? parseAvailabilityOverride(person?.fields["SU 26 — Volunteer-Updated Availability"])
        : null;
    const baseDates =
      kind === "director" ? directorAvail.get(netid) ?? [] : volAvail.get(netid) ?? [];
    // Director override wins; otherwise volunteer self-update; otherwise app baseline.
    const available = overrideDates ?? volunteerSelfDates ?? baseDates;
    const conflicts = computeConflicts({
      personId: id,
      thisDepartmentId: deptId,
      allSchedule: scheduleEntries,
    });
    const volunteerUpdatedAt =
      kind === "volunteer" ? person?.fields["SU 26 — Volunteer Updated At"] ?? null : null;
    const volunteerUpdateAcknowledgedAt =
      kind === "volunteer"
        ? person?.fields["SU 26 — Volunteer Update Acknowledged At"] ?? null
        : null;
    const minShiftsWanted =
      kind === "volunteer" ? volMinShifts.get(netid) ?? null : null;
    // Volunteers only. Default to { contract:false, training:false } if no
    // Compliance row exists yet — the UI surfaces that as "missing both",
    // which is what we want for not-yet-onboarded volunteers.
    const compliance =
      kind === "volunteer"
        ? complianceByPersonId.get(id) ?? { contract: false, training: false }
        : null;
    return {
      id,
      netid,
      name: person?.fields.Name ?? "",
      available,
      availabilityOverridden: overrideDates !== null,
      volunteerUpdatedAt,
      volunteerUpdateAcknowledgedAt,
      minShiftsWanted,
      compliance,
      spanishSpeaking:
        (kind === "volunteer" && volSpanish.get(netid) === true) ||
        person?.fields["Spanish Speaking"] === true,
      returning: person?.fields["Returning Volunteer"] === true,
      licensedRN: person?.fields["Licensed RN"] === true,
      conflicts,
    };
  }

  const assignmentsByDate = new Map<
    string,
    {
      directorIds: string[];
      volunteerIds: string[];
      shadowIds: string[];
      remoteIds: string[];
      triageIds: string[];
      walkinIds: string[];
      ccIds: string[];
      patientsBooked: number | null;
    }
  >();
  for (const row of allSchedule) {
    if (!toIdList(row.fields.Department).includes(deptId)) continue;
    const dateName = selectName(row.fields.Date);
    const iso = normalizeVolunteerDate(dateName);
    if (!iso) continue;
    assignmentsByDate.set(iso, {
      directorIds: toIdList(row.fields["Directors on Shift"]),
      volunteerIds: toIdList(row.fields["Volunteers on Shift"]),
      shadowIds: toIdList(row.fields["Shadow Volunteers on Shift"]),
      remoteIds: toIdList(row.fields["Remote on Shift"]),
      triageIds: toIdList(row.fields["Triage on Shift"]),
      walkinIds: toIdList(row.fields["Walk-in on Shift"]),
      ccIds: toIdList(row.fields["CC on Shift"]),
      patientsBooked: typeof row.fields["Patients Booked"] === "number" ? row.fields["Patients Booked"] : null,
    });
  }

  // Resolve the most recent submitter's display name so the UI can show
  // "Last submitted by X". The link is in the roster row; the name lives
  // back on All People. We already have peopleById from the dirs+vols query
  // but the submitter may be neither — fetch on demand if needed.
  let submittedByName: string | null = null;
  const submittedByIds = toIdList(dept.fields["Submitted By"]);
  if (submittedByIds[0]) {
    const submitterId = submittedByIds[0];
    const cached = peopleById.get(submitterId);
    if (cached?.fields.Name) {
      submittedByName = cached.fields.Name;
    } else {
      const fetched = await listAll<AllPeopleFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.allPeopleTableId,
        filterByFormula: `RECORD_ID() = '${escapeFormulaString(submitterId)}'`,
        fields: ["Name"],
        pageSize: 1,
      });
      submittedByName = fetched[0]?.fields.Name ?? null;
    }
  }

  return c.json({
    callerIsDeptDirector,
    department: {
      id: dept.id,
      name: dept.fields["Department Name"] ?? "",
      submittedAt: dept.fields["Submitted At"] ?? null,
      submittedByName,
      idealHeadcount: typeof dept.fields["Ideal Headcount"] === "number" ? dept.fields["Ideal Headcount"] : null,
      patientCapacityPerProvider:
        typeof dept.fields["Patient Capacity Per Provider"] === "number" ? dept.fields["Patient Capacity Per Provider"] : null,
    },
    dates: CANONICAL_DATES.map((iso) => ({ iso, display: displayDate(iso) })),
    roster: {
      directors: dirIds.map((id) => buildPerson(id, "director")),
      volunteers: volIds.map((id) => buildPerson(id, "volunteer")),
    },
    assignments: CANONICAL_DATES.map((iso) => ({
      date: iso,
      directorIds: assignmentsByDate.get(iso)?.directorIds ?? [],
      volunteerIds: assignmentsByDate.get(iso)?.volunteerIds ?? [],
      shadowIds: assignmentsByDate.get(iso)?.shadowIds ?? [],
      remoteIds: assignmentsByDate.get(iso)?.remoteIds ?? [],
      triageIds: assignmentsByDate.get(iso)?.triageIds ?? [],
      walkinIds: assignmentsByDate.get(iso)?.walkinIds ?? [],
      ccIds: assignmentsByDate.get(iso)?.ccIds ?? [],
      patientsBooked: assignmentsByDate.get(iso)?.patientsBooked ?? null,
    })),
  });
});

app.post("/rhd/readiness", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  if (!config.rhdAttendingsTableId || !config.rhdClinicsTableId) {
    return c.json({ error: "RHD tables not configured" }, 400);
  }
  const { callerNetid, callerEmail } = (await c.req.json()) as { callerNetid?: string; callerEmail?: string };
  if (!callerNetid || !callerEmail) return c.json({ error: "Missing caller" }, 400);
  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  // Authorize before the heavy fan-out (matches /assignment, /submit, etc.):
  // fetch only the roster, check access, then load the rest.
  const allRoster = await listAll<Su26RosterFields>({ baseId: config.haveNManagementBaseId, tableId: config.su26RosterTableId });
  const manageable = manageableDeptIdsFor(allRoster, caller.id);
  const deptIdByName = new Map(allRoster.map((d) => [d.fields["Department Name"] ?? "", d.id]));
  const rhdDeptIds = RHD_DEPTS.map((n) => deptIdByName.get(n)).filter((x): x is string => !!x);
  if (!rhdDeptIds.some((id) => manageable.has(id))) {
    return c.json({ error: "Caller not authorized for RHD" }, 403);
  }

  const [allSchedule, attendingRows, clinicRows, allVolunteerApps, volunteerStaff] = await Promise.all([
    listAll<ScheduleRowFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      fields: ["Department", "Date", "Volunteers on Shift"],
    }),
    listAll<RhdAttendingFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.rhdAttendingsTableId,
      fields: [
        "Schedule Name",
        "Full Name",
        "IUD In",
        "IUD Out",
        "Nexplanon",
        "GAC",
        "EMB",
        "Sees Male",
        "Notes",
      ],
    }),
    listAll<RhdClinicFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.rhdClinicsTableId,
      fields: ["Date", "Attending", "Director on point", "Procedures Booked"],
    }),
    listAll<VolunteerAppFields>({ baseId: config.volunteerAppsBaseId, tableId: config.volunteerAppsTableId, fields: ["NetID", "Link your record", "Spanish Proficiency Level"] }),
    listAll<StaffMirrorFields>({ baseId: config.volunteerAppsBaseId, tableId: config.volunteerAppsStaffTableId, fields: ["NetID"] }),
  ]);

  const volunteerStaffNetidById = new Map<string, string>(
    volunteerStaff.filter((s) => s.fields.NetID).map((s) => [s.id, (s.fields.NetID ?? "").toLowerCase()]),
  );
  const SPANISH_CONVERSATIONAL_PLUS = new Set(["Conversational", "Fluent (native)", "Fluent (non-native)"]);
  const volSpanishByNetid = new Map<string, boolean>();
  for (const r of allVolunteerApps) {
    const nid = resolveAppNetidStandalone(r.fields.NetID, r.fields["Link your record"], volunteerStaffNetidById);
    if (nid && SPANISH_CONVERSATIONAL_PLUS.has(selectName(r.fields["Spanish Proficiency Level"]))) volSpanishByNetid.set(nid, true);
  }

  const onShiftIdsByDeptDate = new Map<string, string[]>();
  const everyId = new Set<string>();
  for (const row of allSchedule) {
    const depId = toIdList(row.fields.Department)[0];
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    const deptName = RHD_DEPTS.find((n) => deptIdByName.get(n) === depId);
    if (!deptName || !iso) continue;
    const ids = toIdList(row.fields["Volunteers on Shift"]);
    onShiftIdsByDeptDate.set(`${deptName}|${iso}`, ids);
    ids.forEach((id) => everyId.add(id));
  }
  const peopleRows = everyId.size
    ? await listAll<AllPeopleFields>({
        baseId: config.haveNManagementBaseId, tableId: config.allPeopleTableId,
        filterByFormula: `OR(${[...everyId].map((id) => `RECORD_ID() = '${id}'`).join(",")})`,
        fields: ["NetID", "Contact Email", "Licensed RN", "Spanish Speaking"],
      })
    : [];
  const liteById = new Map<string, PersonLite>(
    peopleRows.map((p) => {
      const netid = (p.fields.NetID ?? "").toLowerCase();
      return [p.id, {
        id: p.id,
        email: (p.fields["Contact Email"] ?? "").toLowerCase(),
        licensedRN: p.fields["Licensed RN"] === true,
        spanishSpeaking: volSpanishByNetid.get(netid) === true || p.fields["Spanish Speaking"] === true,
      }];
    }),
  );
  const liteFor = (deptName: string, iso: string): PersonLite[] =>
    (onShiftIdsByDeptDate.get(`${deptName}|${iso}`) ?? []).map((id) => liteById.get(id)).filter((x): x is PersonLite => !!x);

  const attendings = attendingRows.map(toAttending);
  const attendingById = new Map(attendings.map((a) => [a.id, a]));
  const clinicByIso = new Map<string, AirtableRecord<RhdClinicFields>>();
  for (const row of clinicRows) {
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    if (iso) clinicByIso.set(iso, row);
  }

  const clinics = CANONICAL_DATES.map((iso) => {
    const clinic = clinicByIso.get(iso);
    const attId = clinic ? toIdList(clinic.fields.Attending)[0] : undefined;
    return computeClinicReadiness({
      date: iso,
      attending: attId ? attendingById.get(attId) ?? null : null,
      director: clinic?.fields["Director on point"] ?? null,
      sctsOnShift: liteFor("SCTS", iso),
      jctsOnShift: liteFor("JCTS", iso),
      ccrhOnShift: liteFor("CCRH", iso),
      proceduresBooked: typeof clinic?.fields["Procedures Booked"] === "number" ? clinic.fields["Procedures Booked"] : null,
      maxProceduresPerClinic: DEFAULT_MAX_PROCEDURES_PER_CLINIC,
    });
  });

  return c.json({ maxProceduresPerClinic: DEFAULT_MAX_PROCEDURES_PER_CLINIC, attendings, clinics });
});

app.post("/rhd/clinic", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  if (!config.rhdClinicsTableId) return c.json({ error: "RHD tables not configured" }, 400);
  const body = (await c.req.json()) as {
    callerNetid?: string; callerEmail?: string; date?: string;
    attendingId?: string | null; director?: string | null; proceduresBooked?: number | null;
  };
  const { callerNetid, callerEmail, date } = body;
  if (!callerNetid || !callerEmail || !date) return c.json({ error: "Missing required field" }, 400);
  if (!(CANONICAL_DATES as readonly string[]).includes(date)) return c.json({ error: "Invalid date" }, 400);
  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const allRoster = await listAll<Su26RosterFields>({ baseId: config.haveNManagementBaseId, tableId: config.su26RosterTableId });
  const manageable = manageableDeptIdsFor(allRoster, caller.id);
  const deptIdByName = new Map(allRoster.map((d) => [d.fields["Department Name"] ?? "", d.id]));
  const rhdDeptIds = RHD_DEPTS.map((n) => deptIdByName.get(n)).filter((x): x is string => !!x);
  if (!rhdDeptIds.some((id) => manageable.has(id))) return c.json({ error: "Caller not authorized for RHD" }, 403);

  if (body.proceduresBooked != null) {
    const n = body.proceduresBooked;
    if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n < 0) return c.json({ error: "Invalid Procedures Booked" }, 400);
  }

  if (body.attendingId !== undefined && body.attendingId) {
    if (!config.rhdAttendingsTableId) return c.json({ error: "RHD tables not configured" }, 400);
    const match = await listAll<RhdAttendingFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.rhdAttendingsTableId,
      filterByFormula: `RECORD_ID() = '${escapeFormulaString(body.attendingId)}'`,
      pageSize: 1,
    });
    if (!match[0]) return c.json({ error: "Invalid Attending" }, 400);
  }

  const clinics = await listAll<RhdClinicFields>({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId });
  const existing = clinics.find((row) => normalizeVolunteerDate(selectName(row.fields.Date)) === date);
  const fields: Record<string, unknown> = { Date: date };
  if (body.attendingId !== undefined) fields["Attending"] = body.attendingId ? [body.attendingId] : [];
  if (body.director !== undefined) fields["Director on point"] = body.director ?? "";
  if (body.proceduresBooked !== undefined) fields["Procedures Booked"] = body.proceduresBooked;

  if (existing) {
    await patchRecord({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId, recordId: existing.id, fields, typecast: true });
  } else {
    await createRecord({ baseId: config.haveNManagementBaseId, tableId: config.rhdClinicsTableId, fields, typecast: true });
  }
  return c.json({ success: true });
});

app.post("/assignment", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    departmentId?: string;
    date?: string; // ISO
    directorIds?: string[];
    volunteerIds?: string[];
    shadowIds?: string[];
    remoteIds?: string[];
    triageIds?: string[];
    walkinIds?: string[];
    ccIds?: string[];
    patientsBooked?: number | null;
  };
  const { callerNetid, callerEmail, departmentId, date } = body;
  if (!callerNetid || !callerEmail || !departmentId || !date) {
    return c.json({ error: "Missing required field" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const roster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = roster.find((r) => r.id === departmentId);
  if (!dept) return c.json({ error: "Department not found" }, 404);

  if (!manageableDeptIdsFor(roster, caller.id).has(departmentId)) {
    return c.json({ error: "Caller not authorized for this department" }, 403);
  }

  // find existing row(s) for (dept, date). Self-healing: if a previous bug
  // (e.g. the August date-parsing regression) ever spawned duplicates, we
  // collapse them here — write to the most-recently-touched row and delete
  // the rest. Single-match and zero-match paths behave as before.
  const all = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
  });
  const matches = all
    .filter((row) => {
      if (!toIdList(row.fields.Department).includes(departmentId)) return false;
      return normalizeVolunteerDate(selectName(row.fields.Date)) === date;
    })
    .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  const existing = matches[0];
  const duplicates = matches.slice(1);

  const dateName = displayDate(date);
  const deptName = dept.fields["Department Name"] ?? "";

  // Only include the shadow field on writes when the client passes it. Lets
  // older clients (and unrelated callers) leave shadow assignments alone.
  const roleLists = [body.triageIds, body.walkinIds, body.ccIds].filter(Array.isArray) as string[][];
  const volunteerIds =
    roleLists.length > 0
      ? withRoleMembersOnShift(body.volunteerIds ?? [], roleLists)
      : body.volunteerIds ?? [];

  const fields: Record<string, unknown> = {
    Name: `${deptName} — ${dateName}`,
    Department: [departmentId],
    Date: date,
    "Directors on Shift": body.directorIds ?? [],
    "Volunteers on Shift": volunteerIds,
  };
  if (Array.isArray(body.shadowIds)) fields["Shadow Volunteers on Shift"] = body.shadowIds;
  if (Array.isArray(body.remoteIds)) fields["Remote on Shift"] = body.remoteIds;
  if (Array.isArray(body.triageIds)) fields["Triage on Shift"] = body.triageIds;
  if (Array.isArray(body.walkinIds)) fields["Walk-in on Shift"] = body.walkinIds;
  if (Array.isArray(body.ccIds)) fields["CC on Shift"] = body.ccIds;
  if (body.patientsBooked !== undefined) {
    const n = body.patientsBooked;
    if (n !== null && (typeof n !== "number" || !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) {
      return c.json({ error: "Invalid Patients Booked" }, 400);
    }
    fields["Patients Booked"] = n;
  }

  if (existing) {
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      recordId: existing.id,
      fields,
      typecast: true,
    });
  } else {
    await createRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      fields,
      typecast: true,
    });
  }

  // Best-effort dedupe — errors here don't fail the user write, but log so
  // we notice if something's stuck.
  for (const dup of duplicates) {
    try {
      await deleteRecord({
        baseId: config.haveNManagementBaseId,
        tableId: config.su26ScheduleTableId,
        recordId: dup.id,
      });
    } catch (err) {
      console.error("[assignment] dedupe delete failed for", dup.id, err);
    }
  }

  return c.json({ success: true });
});

/**
 * Marks a department's schedule as "submitted" by writing Submitted At +
 * Submitted By to the roster row. No lock — edits keep working, the public
 * viewer keeps showing the schedule, and a director can re-submit any number
 * of times to update the timestamp. This is purely a tracking signal.
 */
app.post("/submit/:deptId", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const deptId = c.req.param("deptId");
  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
  };
  if (!deptId || !callerNetid || !callerEmail) {
    return c.json({ error: "Missing field" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const roster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = roster.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);
  if (!manageableDeptIdsFor(roster, caller.id).has(deptId)) {
    return c.json({ error: "Not authorized for this department" }, 403);
  }

  const submittedAt = new Date().toISOString();
  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
    recordId: dept.id,
    fields: {
      "Schedule Status": "Submitted",
      "Submitted At": submittedAt,
      "Submitted By": [caller.id],
    },
  });

  return c.json({
    success: true,
    submittedAt,
    submittedByName: caller.fields.Name ?? "",
  });
});

app.post("/availability", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    personId?: string;
    kind?: "director" | "volunteer";
    availableDates?: string[]; // ISO dates
  };
  const { callerNetid, callerEmail, personId, kind, availableDates } = body;
  if (!callerNetid || !callerEmail || !personId || !kind || !Array.isArray(availableDates)) {
    return c.json({ error: "Missing required field" }, 400);
  }
  if (kind !== "director" && kind !== "volunteer") {
    return c.json({ error: "kind must be 'director' or 'volunteer'" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const roster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });

  // Authorization: caller can manage a dept that the target person is on
  // (admins manage every dept; SRHD director manages SCTS/JCTS/CCRH; etc.).
  const manageable = manageableDeptIdsFor(roster, caller.id);
  const authorized = roster.some((d) => {
    if (!manageable.has(d.id)) return false;
    const dirs = toIdList(d.fields.Directors);
    const vols = toIdList(d.fields.Volunteers);
    return dirs.includes(personId) || vols.includes(personId);
  });
  if (!authorized) {
    return c.json({ error: "Not authorized to edit this person's availability" }, 403);
  }

  // Serialize as comma-separated display dates. Empty input becomes empty
  // string, which means "fall back to applicant-base availability". Clearing
  // an override is therefore a side-effect of submitting an empty list.
  const display = availableDates
    .map((iso) => normalizeVolunteerDate(iso) ?? iso) // tolerate display-formatted input too
    .map((iso) => displayDate(iso))
    .join(", ");

  const fieldName =
    kind === "director" ? "SU 26 — Available as Director" : "SU 26 — Available as Volunteer";

  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
    recordId: personId,
    fields: { [fieldName]: display },
  });

  return c.json({ success: true });
});

/**
 * Volunteer self-update of their SU 26 availability. The caller proves identity
 * with their own NetID + email — no director auth needed. Writes
 * "SU 26 — Volunteer-Updated Availability" + "SU 26 — Volunteer Updated At"
 * on their All People row and clears any prior "Acknowledged At" so the
 * schedule builder shows the updated badge again.
 *
 * Resolution order in the builder is director override → this field → app baseline,
 * so a director who has already pinned availability via the override field won't
 * have it changed by a volunteer self-update.
 */
app.post("/me/availability", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    availableDates?: string[]; // ISO dates
  };
  const { callerNetid, callerEmail, availableDates } = body;
  if (!callerNetid || !callerEmail || !Array.isArray(availableDates)) {
    return c.json({ error: "Missing required field" }, 400);
  }

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  const display = availableDates
    .map((iso) => normalizeVolunteerDate(iso) ?? iso)
    .map((iso) => displayDate(iso))
    .join(", ");

  const now = new Date().toISOString();
  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
    recordId: person.id,
    fields: {
      "SU 26 — Volunteer-Updated Availability": display,
      "SU 26 — Volunteer Updated At": now,
      // New submission ⇒ needs to be re-acknowledged by a director.
      "SU 26 — Volunteer Update Acknowledged At": null,
    },
  });

  return c.json({ success: true, updatedAt: now });
});

/**
 * Director acknowledges a volunteer's most recent self-update. Sets
 * "SU 26 — Volunteer Update Acknowledged At" on the volunteer's All People row.
 * Same authorization rules as POST /availability — the caller must be a director
 * for a department this person is on, transitively via MANAGES_OTHER_DEPTS.
 */
app.post("/availability/acknowledge", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    personId?: string;
  };
  const { callerNetid, callerEmail, personId } = body;
  if (!callerNetid || !callerEmail || !personId) {
    return c.json({ error: "Missing required field" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const roster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });

  const manageable = manageableDeptIdsFor(roster, caller.id);
  const authorized = roster.some((d) => {
    if (!manageable.has(d.id)) return false;
    const dirs = toIdList(d.fields.Directors);
    const vols = toIdList(d.fields.Volunteers);
    return dirs.includes(personId) || vols.includes(personId);
  });
  if (!authorized) {
    return c.json({ error: "Not authorized to acknowledge this person's update" }, 403);
  }

  const now = new Date().toISOString();
  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
    recordId: personId,
    fields: { "SU 26 — Volunteer Update Acknowledged At": now },
  });

  return c.json({ success: true, acknowledgedAt: now });
});

app.post("/remove-volunteer", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    departmentId?: string;
    personId?: string;
    reason?: string;
  };
  const { callerNetid, callerEmail, departmentId, personId } = body;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!callerNetid || !callerEmail || !departmentId || !personId) {
    return c.json({ error: "Missing required field" }, 400);
  }

  const caller = await findPerson(config, callerNetid, callerEmail);
  if (!caller) return c.json({ error: "Caller not verified" }, 403);

  const roster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = roster.find((r) => r.id === departmentId);
  if (!dept) return c.json({ error: "Department not found" }, 404);

  if (!manageableDeptIdsFor(roster, caller.id).has(departmentId)) {
    return c.json({ error: "Not authorized for this department" }, 403);
  }

  // 1. Strip the person from the dept's Volunteers list.
  const newVols = toIdList(dept.fields.Volunteers).filter((id) => id !== personId);
  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
    recordId: dept.id,
    fields: { Volunteers: newVols },
  });

  // 2. Strip them from every SU 26 Schedule row for this dept where they're
  // listed as a Volunteer on Shift or a Shadow Volunteer on Shift.
  const schedule = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
  });
  const affected = schedule.filter((row) => {
    if (!toIdList(row.fields.Department).includes(departmentId)) return false;
    const vols = toIdList(row.fields["Volunteers on Shift"]);
    const shadows = toIdList(row.fields["Shadow Volunteers on Shift"]);
    const remotes = toIdList(row.fields["Remote on Shift"]);
    const triage = toIdList(row.fields["Triage on Shift"]);
    const walkin = toIdList(row.fields["Walk-in on Shift"]);
    const cc = toIdList(row.fields["CC on Shift"]);
    return (
      vols.includes(personId) ||
      shadows.includes(personId) ||
      remotes.includes(personId) ||
      triage.includes(personId) ||
      walkin.includes(personId) ||
      cc.includes(personId)
    );
  });
  await Promise.all(
    affected.map((row) => {
      const vols = toIdList(row.fields["Volunteers on Shift"]);
      const shadows = toIdList(row.fields["Shadow Volunteers on Shift"]);
      const remotes = toIdList(row.fields["Remote on Shift"]);
      const triage = toIdList(row.fields["Triage on Shift"]);
      const walkin = toIdList(row.fields["Walk-in on Shift"]);
      const cc = toIdList(row.fields["CC on Shift"]);
      const patch: Record<string, unknown> = {};
      if (vols.includes(personId)) patch["Volunteers on Shift"] = vols.filter((id) => id !== personId);
      if (shadows.includes(personId)) patch["Shadow Volunteers on Shift"] = shadows.filter((id) => id !== personId);
      if (remotes.includes(personId)) patch["Remote on Shift"] = remotes.filter((id) => id !== personId);
      if (triage.includes(personId)) patch["Triage on Shift"] = triage.filter((id) => id !== personId);
      if (walkin.includes(personId)) patch["Walk-in on Shift"] = walkin.filter((id) => id !== personId);
      if (cc.includes(personId)) patch["CC on Shift"] = cc.filter((id) => id !== personId);
      return patchRecord({
        baseId: config.haveNManagementBaseId,
        tableId: config.su26ScheduleTableId,
        recordId: row.id,
        fields: patch,
      });
    }),
  );

  // 3. Audit log — don't fail the user request if this errors, but make it
  // loud server-side so we notice. The destructive change already happened.
  try {
    const volunteerLookup = await listAll<AllPeopleFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.allPeopleTableId,
      filterByFormula: `RECORD_ID() = '${escapeFormulaString(personId)}'`,
      fields: ["Name"],
      pageSize: 1,
    });
    const volunteerName = volunteerLookup[0]?.fields.Name ?? "Unknown volunteer";
    const deptName = dept.fields["Department Name"] ?? "Unknown department";
    const callerName = caller.fields.Name ?? callerNetid;
    await createRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26RemovalLogTableId,
      fields: {
        Summary: `${volunteerName} removed from ${deptName} by ${callerName}`,
        "Removed By": [caller.id],
        "Volunteer Removed": [personId],
        Department: [departmentId],
        "Removed At": new Date().toISOString(),
        "Unscheduled Count": affected.length,
        ...(reason ? { Reason: reason } : {}),
      },
    });
  } catch (err) {
    console.error("[remove-volunteer] failed to write audit log:", err);
  }

  return c.json({ success: true, unscheduledCount: affected.length });
});

app.post("/me/assignments", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const { callerNetid, callerEmail, signIn } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    signIn?: boolean;
  };
  if (!callerNetid || !callerEmail) {
    return c.json({ error: "Missing callerNetid / callerEmail" }, 400);
  }

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  if (signIn === true) {
    logSignIn(config, person, "Public viewer", c.req.header("user-agent") ?? "");
  }

  const [allDepts, allScheduleRows, pendingRequests, volunteerApps, volunteerStaff] =
    await Promise.all([
      listAll<Su26RosterFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.su26RosterTableId,
      }),
      listAll<ScheduleRowFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.su26ScheduleTableId,
      }),
      listAll<ShiftRequestFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.su26ShiftRequestsTableId,
        // Linked-record fields stringify to their primary-field (name) in
        // Airtable formulas, not to record IDs, so FIND(personId, …) never
        // matches. Pull all Pending rows and filter by Requester ID in JS.
        filterByFormula: `{Status} = 'Pending'`,
      }),
      listAll<VolunteerAppFields>({
        baseId: config.volunteerAppsBaseId,
        tableId: config.volunteerAppsTableId,
        fields: ["NetID", "General Availability", "Link your record"],
      }),
      listAll<StaffMirrorFields>({
        baseId: config.volunteerAppsBaseId,
        tableId: config.volunteerAppsStaffTableId,
        fields: ["NetID"],
      }),
    ]);

  // Resolve this person's current effective volunteer availability. Same priority
  // as the schedule builder: director override → volunteer self-update → app baseline.
  const personNetid = (person.fields.NetID ?? "").toLowerCase();
  const directorOverride = parseAvailabilityOverride(
    person.fields["SU 26 — Available as Volunteer"],
  );
  const volunteerSelfDates = parseAvailabilityOverride(
    person.fields["SU 26 — Volunteer-Updated Availability"],
  );
  let appBaselineDates: string[] = [];
  if (personNetid) {
    const volunteerStaffNetidById = new Map<string, string>(
      volunteerStaff
        .filter((s) => s.fields.NetID)
        .map((s) => [s.id, (s.fields.NetID ?? "").toLowerCase()]),
    );
    const myApp = volunteerApps.find((r) => {
      const direct = (r.fields.NetID ?? "").trim().toLowerCase();
      if (direct && direct === personNetid) return true;
      const linkedIds = toIdList(r.fields["Link your record"]);
      return linkedIds.some((id) => volunteerStaffNetidById.get(id) === personNetid);
    });
    if (myApp) {
      const names = toNameList(myApp.fields["General Availability"]);
      appBaselineDates = names
        .map((n) => normalizeVolunteerDate(n))
        .filter((x): x is string => !!x);
    }
  }
  // What to pre-fill the volunteer's editor with: their own most-recent choices.
  // The director-override is the director's decision and should NOT seed the editor.
  const myDates = volunteerSelfDates ?? appBaselineDates;
  const mySource: "volunteer-updated" | "application" | "none" =
    volunteerSelfDates !== null
      ? "volunteer-updated"
      : appBaselineDates.length > 0
      ? "application"
      : "none";

  const deptById = new Map<string, { id: string; name: string }>();
  for (const d of allDepts) {
    const name = d.fields["Department Name"] ?? "";
    if (name) deptById.set(d.id, { id: d.id, name });
  }

  const pendingByKey = new Map<string, string>();
  for (const r of pendingRequests) {
    if (!toIdList(r.fields.Requester).includes(person.id)) continue;
    const deptLink = toIdList(r.fields.Department)[0];
    const dateDisplay = selectName(r.fields["Requester Date"]);
    const iso = normalizeVolunteerDate(dateDisplay);
    if (deptLink && iso) pendingByKey.set(`${deptLink}|${iso}`, r.id);
  }

  const assignments: Array<{
    deptId: string;
    deptName: string;
    date: string;
    role: "director" | "volunteer";
    shadow: boolean;
    remote: boolean;
    pendingRequestId: string | null;
  }> = [];

  for (const row of allScheduleRows) {
    // Department is a multipleRecordLinks field; Airtable's REST API returns it
    // as a bare record-id array, so resolve the dept by ID, not by name.
    const deptId = toIdList(row.fields.Department)[0];
    const dept = deptId ? deptById.get(deptId) : undefined;
    if (!dept) continue;
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    if (!iso) continue;
    const directorIds = toIdList(row.fields["Directors on Shift"]);
    const volunteerIds = toIdList(row.fields["Volunteers on Shift"]);
    const shadowIds = toIdList(row.fields["Shadow Volunteers on Shift"]);
    const remoteIds = toIdList(row.fields["Remote on Shift"]);
    let role: "director" | "volunteer" | null = null;
    let shadow = false;
    if (directorIds.includes(person.id)) role = "director";
    else if (volunteerIds.includes(person.id)) role = "volunteer";
    else if (shadowIds.includes(person.id)) {
      role = "volunteer";
      shadow = true;
    }
    if (!role) continue;
    assignments.push({
      deptId: dept.id,
      deptName: dept.name,
      date: iso,
      role,
      shadow,
      remote: remoteIds.includes(person.id),
      pendingRequestId: pendingByKey.get(`${dept.id}|${iso}`) ?? null,
    });
  }

  assignments.sort((a, b) =>
    a.date === b.date ? a.deptName.localeCompare(b.deptName) : a.date.localeCompare(b.date),
  );

  return c.json({
    person: {
      id: person.id,
      name: person.fields.Name ?? "",
      netid: person.fields.NetID ?? "",
      email: person.fields["Contact Email"] ?? "",
    },
    assignments,
    dates: CANONICAL_DATES.map((iso) => ({ iso, display: displayDate(iso) })),
    volunteerAvailability: {
      myDates,
      source: mySource,
      directorOverrideActive: directorOverride !== null,
      volunteerUpdatedAt: person.fields["SU 26 — Volunteer Updated At"] ?? null,
    },
  });
});

app.post("/requests", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const body = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    deptId?: string;
    requesterDate?: string;  // ISO Saturday key
    targetNetid?: string;
    targetDate?: string;     // ISO
    note?: string;
  };
  const { callerNetid, callerEmail, deptId, requesterDate, targetNetid, targetDate, note } = body;
  if (!callerNetid || !callerEmail || !deptId || !requesterDate) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  const allDepts = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const dept = allDepts.find((d) => d.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);

  const scheduleRows = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
    filterByFormula: `{Department} = '${escapeFormulaString(dept.fields["Department Name"] ?? "")}'`,
  });

  const rowsForValidate = scheduleRows
    .map((r) => {
      const iso = normalizeVolunteerDate(selectName(r.fields.Date));
      if (!iso) return null;
      return {
        date: iso,
        directorIds: toIdList(r.fields["Directors on Shift"]),
        volunteerIds: toIdList(r.fields["Volunteers on Shift"]),
        shadowIds: toIdList(r.fields["Shadow Volunteers on Shift"]),
      };
    })
    .filter((r): r is { date: string; directorIds: string[]; volunteerIds: string[]; shadowIds: string[] } => r !== null);

  // Resolve targetNetid (if provided) to a person id. The frontend modal in the next task
  // may send a name in this field instead of a NetID (because the public viewer redacts
  // NetIDs), so do BOTH lookups — NetID first, name fallback.
  let targetPersonId: string | undefined;
  if (targetNetid) {
    const byNetid = await listAll<AllPeopleFields>({
      baseId: config.haveNManagementBaseId,
      tableId: config.allPeopleTableId,
      filterByFormula: `{NetID} = '${escapeFormulaString(targetNetid)}'`,
    });
    if (byNetid[0]) {
      targetPersonId = byNetid[0].id;
    } else {
      const byName = await listAll<AllPeopleFields>({
        baseId: config.haveNManagementBaseId,
        tableId: config.allPeopleTableId,
        filterByFormula: `{Name} = '${escapeFormulaString(targetNetid)}'`,
      });
      targetPersonId = byName[0]?.id;
    }
    if (!targetPersonId) return c.json({ error: "Partner is not eligible" }, 409);
  }

  const v = validateRequest({
    scheduleRows: rowsForValidate,
    requesterId: person.id,
    requesterDate,
    targetId: targetPersonId,
    targetDate,
  });
  if (!v.ok) return c.json({ error: v.error }, 409);

  // Check for a duplicate pending request on (person, requesterDate). We pull
  // all pending rows and match BOTH the linked Requester id and the date in JS:
  // linked fields stringify to names in formulas (so FIND can't match), and
  // Requester Date is a real Date field, so a string-equality formula won't
  // match either. The pending set for one season is tiny.
  const sameDateRequests = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `{Status} = 'Pending'`,
  });
  const duplicates = sameDateRequests.filter(
    (r) =>
      toIdList(r.fields.Requester).includes(person.id) &&
      normalizeVolunteerDate(selectName(r.fields["Requester Date"])) === requesterDate,
  );
  if (duplicates.length > 0) return c.json({ error: "Pending request already exists" }, 409);

  const fields: Record<string, unknown> = {
    Department: [dept.id],
    Requester: [person.id],
    "Requester Email": callerEmail,
    "Requester Date": requesterDate,
    Status: "Pending",
  };
  if (targetPersonId && targetDate) {
    fields.Target = [targetPersonId];
    fields["Target Date"] = targetDate;
  }
  if (note) fields.Note = note;

  const created = await createRecord<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    fields,
    typecast: true,
  });

  // Post-create race check: two concurrent submissions can both pass the
  // pre-check above. Re-query and, if a competing pending row exists,
  // withdraw the newer one (older createdTime wins, with record-id as the
  // deterministic tiebreaker for same-timestamp creates).
  const afterCreate = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `{Status} = 'Pending'`,
  });
  const competing = afterCreate.filter(
    (r) =>
      r.id !== created.id &&
      toIdList(r.fields.Requester).includes(person.id) &&
      normalizeVolunteerDate(selectName(r.fields["Requester Date"])) === requesterDate,
  );
  const lostRace = competing.some((r) => {
    if (r.createdTime < created.createdTime) return true;
    if (r.createdTime === created.createdTime && r.id < created.id) return true;
    return false;
  });
  if (lostRace) {
    try {
      await patchRecord({
        baseId: config.haveNManagementBaseId,
        tableId: config.su26ShiftRequestsTableId,
        recordId: created.id,
        fields: { Status: "Withdrawn", "Resolved At": new Date().toISOString() },
      });
    } catch (err) {
      console.error("[requests] failed to withdraw losing race entry:", err);
    }
    return c.json({ error: "Pending request already exists" }, 409);
  }

  return c.json({ id: created.id, status: "Pending" }, 201);
});

app.post("/requests/:id/withdraw", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const id = c.req.param("id");
  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string; callerEmail?: string;
  };
  if (!callerNetid || !callerEmail) return c.json({ error: "Missing callerNetid / callerEmail" }, 400);

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  const matches = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `RECORD_ID() = '${escapeFormulaString(id)}'`,
  });
  const req = matches[0];
  if (!req) return c.json({ error: "Not found" }, 404);

  if (toIdList(req.fields.Requester)[0] !== person.id)
    return c.json({ error: "Not your request" }, 403);

  if (selectName(req.fields.Status) !== "Pending")
    return c.json({ error: "Already resolved" }, 409);

  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    recordId: id,
    fields: { Status: "Withdrawn", "Resolved At": new Date().toISOString() },
  });

  return c.json({ id, status: "Withdrawn" });
});

app.post("/requests/for-dept/:deptId", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const deptId = c.req.param("deptId");
  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string; callerEmail?: string;
  };
  if (!callerNetid || !callerEmail) return c.json({ error: "Missing callerNetid / callerEmail" }, 400);

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  const allRoster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const manageable = manageableDeptIdsFor(allRoster, person.id);
  if (!manageable.has(deptId)) return c.json({ error: "Not authorized" }, 403);

  // Linked-record fields stringify to their primary-field value (name) in
  // Airtable formulas, so FIND(deptId, …) never matches. Pull the full
  // table and filter by Department record ID in JS.
  const allRequests = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
  });
  const requests = allRequests.filter((r) =>
    toIdList(r.fields.Department).includes(deptId),
  );

  const referencedIds = new Set<string>();
  for (const r of requests) {
    toIdList(r.fields.Requester).forEach((x) => referencedIds.add(x));
    toIdList(r.fields.Target).forEach((x) => referencedIds.add(x));
    toIdList(r.fields.Resolver).forEach((x) => referencedIds.add(x));
  }
  const allPeople = await listAll<AllPeopleFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.allPeopleTableId,
  });
  const peopleById = new Map<string, AllPeopleFields & { id: string }>();
  for (const p of allPeople) {
    if (referencedIds.has(p.id)) peopleById.set(p.id, { ...p.fields, id: p.id });
  }

  const dept = allRoster.find((r) => r.id === deptId);
  const scheduleRows = dept ? await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
    filterByFormula: `{Department} = '${escapeFormulaString(dept.fields["Department Name"] ?? "")}'`,
  }) : [];
  const scheduleByDate = new Map<string, { directors: string[]; volunteers: string[]; shadows: string[] }>();
  for (const row of scheduleRows) {
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    if (!iso) continue;
    scheduleByDate.set(iso, {
      directors: toIdList(row.fields["Directors on Shift"]),
      volunteers: toIdList(row.fields["Volunteers on Shift"]),
      shadows: toIdList(row.fields["Shadow Volunteers on Shift"]),
    });
  }

  function shape(r: AirtableRecord<ShiftRequestFields>) {
    const requesterId = toIdList(r.fields.Requester)[0] ?? "";
    const targetId = toIdList(r.fields.Target)[0] ?? null;
    const resolverId = toIdList(r.fields.Resolver)[0] ?? null;
    const requesterIso = normalizeVolunteerDate(selectName(r.fields["Requester Date"]));
    const targetIso = r.fields["Target Date"]
      ? normalizeVolunteerDate(selectName(r.fields["Target Date"]))
      : null;

    let role: "director" | "volunteer" = "volunteer";
    if (requesterIso) {
      const row = scheduleByDate.get(requesterIso);
      if (row?.directors.includes(requesterId)) role = "director";
    }

    const requesterPerson = peopleById.get(requesterId);
    const targetPerson = targetId ? peopleById.get(targetId) : null;
    const resolverPerson = resolverId ? peopleById.get(resolverId) : null;

    return {
      id: r.id,
      type: targetId ? ("Named swap" as const) : ("Drop" as const),
      requester: {
        id: requesterId,
        name: requesterPerson?.Name ?? "",
        netid: requesterPerson?.NetID ?? "",
        role,
      },
      requesterDate: requesterIso ?? "",
      target: targetPerson ? {
        id: targetId as string,
        name: targetPerson.Name ?? "",
        netid: targetPerson.NetID ?? "",
      } : null,
      targetDate: targetIso,
      note: r.fields.Note ?? "",
      status: selectName(r.fields.Status) as "Pending" | "Approved" | "Rejected" | "Withdrawn",
      submittedAt: r.fields["Submitted At"] ?? "",
      resolvedAt: r.fields["Resolved At"] ?? null,
      resolver: resolverPerson ? { id: resolverId as string, name: resolverPerson.Name ?? "" } : null,
    };
  }

  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const pending = requests.filter((r) => selectName(r.fields.Status) === "Pending").map(shape);
  const recent = requests
    .filter((r) => {
      const s = selectName(r.fields.Status);
      if (s === "Pending") return false;
      const t = r.fields["Resolved At"];
      return t ? new Date(t).getTime() >= fourteenDaysAgo : false;
    })
    .map(shape)
    .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));

  return c.json({ pending, recent });
});

app.post("/requests/:id/resolve", async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);

  const id = c.req.param("id");
  const { callerNetid, callerEmail, action, note } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
    action?: "approve" | "reject";
    note?: string;
  };
  if (!callerNetid || !callerEmail || (action !== "approve" && action !== "reject")) {
    return c.json({ error: "Missing or invalid fields" }, 400);
  }

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  const reqMatches = await listAll<ShiftRequestFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    filterByFormula: `RECORD_ID() = '${escapeFormulaString(id)}'`,
  });
  const req = reqMatches[0];
  if (!req) return c.json({ error: "Not found" }, 404);
  if (selectName(req.fields.Status) !== "Pending")
    return c.json({ error: "Already resolved" }, 409);

  const deptId = toIdList(req.fields.Department)[0];
  if (!deptId) return c.json({ error: "Invalid request: no department" }, 409);

  const allRoster = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  const manageable = manageableDeptIdsFor(allRoster, person.id);
  if (!manageable.has(deptId)) return c.json({ error: "Not authorized" }, 403);

  const requesterId = toIdList(req.fields.Requester)[0] ?? "";
  const targetId = toIdList(req.fields.Target)[0] ?? undefined;
  const requesterIso = normalizeVolunteerDate(selectName(req.fields["Requester Date"]));
  const targetIso = req.fields["Target Date"]
    ? normalizeVolunteerDate(selectName(req.fields["Target Date"])) ?? undefined
    : undefined;
  if (!requesterIso) return c.json({ error: "Invalid request: bad date" }, 409);

  // Reject path — short-circuit.
  if (action === "reject") {
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ShiftRequestsTableId,
      recordId: id,
      fields: {
        Status: "Rejected",
        Resolver: [person.id],
        "Resolved At": new Date().toISOString(),
        ...(note ? { "Resolution Note": note } : {}),
      },
    });
    return c.json({ id, status: "Rejected" });
  }

  // Approve path — re-validate against current schedule.
  const dept = allRoster.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);

  const scheduleRows = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
    filterByFormula: `{Department} = '${escapeFormulaString(dept.fields["Department Name"] ?? "")}'`,
  });

  const rowsForApply = scheduleRows
    .map((r) => {
      const iso = normalizeVolunteerDate(selectName(r.fields.Date));
      if (!iso) return null;
      return {
        id: r.id,
        date: iso,
        directorIds: toIdList(r.fields["Directors on Shift"]),
        volunteerIds: toIdList(r.fields["Volunteers on Shift"]),
        shadowIds: toIdList(r.fields["Shadow Volunteers on Shift"]),
      };
    })
    .filter((r): r is { id: string; date: string; directorIds: string[]; volunteerIds: string[]; shadowIds: string[] } => r !== null);

  const v = validateRequest({
    scheduleRows: rowsForApply,
    requesterId,
    requesterDate: requesterIso,
    targetId,
    targetDate: targetIso,
  });
  if (!v.ok) return c.json({ error: "Schedule has changed since request was submitted" }, 409);

  let ops;
  try {
    ops = planApply({
      scheduleRows: rowsForApply,
      requesterId,
      requesterDate: requesterIso,
      targetId,
      targetDate: targetIso,
    });
  } catch {
    return c.json({ error: "Schedule has changed since request was submitted" }, 409);
  }

  const originalRows = new Map(rowsForApply.map((r) => [r.id, r] as const));

  try {
    await executeApply({
      baseId: config.haveNManagementBaseId,
      scheduleTableId: config.su26ScheduleTableId,
      ops,
      originalRows,
      patchRecord: (opts) => patchRecord(opts),
    });
  } catch (err) {
    console.error("Apply failed", err);
    return c.json({ error: "Apply failed", partial: { ops } }, 500);
  }

  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ShiftRequestsTableId,
    recordId: id,
    fields: {
      Status: "Approved",
      Resolver: [person.id],
      "Resolved At": new Date().toISOString(),
      ...(note ? { "Resolution Note": note } : {}),
    },
  });

  return c.json({ id, status: "Approved" });
});
