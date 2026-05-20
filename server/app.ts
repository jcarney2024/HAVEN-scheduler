import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createRecord, escapeFormulaString, listAll, patchRecord, type AirtableRecord } from "./airtable.js";
import { CANONICAL_DATES, normalizeVolunteerDate, normalizeDirectorDate, displayDate } from "./dates.js";
import { computeConflicts, type ScheduleEntry } from "./conflicts.js";
import { loadConfig, type Config } from "./config.js";
import { shapePublicSchedule } from "./public.js";

type AllPeopleFields = {
  NetID?: string;
  "Contact Email"?: string;
  Name?: string;
  // Director-controlled overrides; comma-separated display dates ("May 30th, June 6th, ...").
  // If non-empty, these REPLACE the applicant-base availability for this person+kind.
  "SU 26 — Available as Director"?: string;
  "SU 26 — Available as Volunteer"?: string;
};

type Su26RosterFields = {
  "Department Name"?: string;
  Directors?: unknown;
  Volunteers?: unknown;
  "Schedule Status"?: unknown;
  "Submitted At"?: string;
  "Submitted By"?: unknown;
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
};

type StaffMirrorFields = {
  NetID?: string;
  Name?: string;
};

type ScheduleRowFields = {
  Department?: unknown;
  Date?: unknown;
  "Directors on Shift"?: unknown;
  "Volunteers on Shift"?: unknown;
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
  const submitted = rows
    .filter((r) => selectName(r.fields["Schedule Status"]) === "Submitted")
    .map((r) => ({ id: r.id, name: r.fields["Department Name"] ?? "" }))
    .filter((d) => !!d.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return c.json(submitted);
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

  const status = selectName(dept.fields["Schedule Status"]);
  if (status !== "Submitted") return c.json({ error: "Schedule not published" }, 403);

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
      };
    })
    .filter((r): r is { date: string; directorIds: string[]; volunteerIds: string[] } => r !== null);

  const shaped = shapePublicSchedule({
    dept: {
      id: dept.id,
      name: dept.fields["Department Name"] ?? "",
      scheduleStatus: "Submitted",
      submittedAt: dept.fields["Submitted At"] ?? null,
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

  // Sort: home departments (where they're listed as a director) first, then
  // delegated/admin depts, then alphabetical within each group.
  const sorted = [...visibleDepts].sort((a, b) => {
    const aHome = toIdList(a.fields.Directors).includes(person.id) ? 0 : 1;
    const bHome = toIdList(b.fields.Directors).includes(person.id) ? 0 : 1;
    if (aHome !== bHome) return aHome - bHome;
    return (a.fields["Department Name"] ?? "").localeCompare(b.fields["Department Name"] ?? "");
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
      scheduleStatus: selectName(d.fields["Schedule Status"]) || "Draft",
      submittedAt: d.fields["Submitted At"] ?? null,
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
      fields: ["NetID", "General Availability", "Link your record"],
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
  ]);

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
    const baseDates =
      kind === "director" ? directorAvail.get(netid) ?? [] : volAvail.get(netid) ?? [];
    const available = overrideDates ?? baseDates;
    const conflicts = computeConflicts({
      personId: id,
      thisDepartmentId: deptId,
      allSchedule: scheduleEntries,
    });
    return {
      id,
      netid,
      name: person?.fields.Name ?? "",
      available,
      availabilityOverridden: overrideDates !== null,
      conflicts,
    };
  }

  const scheduleStatus = selectName(dept.fields["Schedule Status"]) || "Draft";

  const assignmentsByDate = new Map<string, { directorIds: string[]; volunteerIds: string[] }>();
  for (const row of allSchedule) {
    if (!toIdList(row.fields.Department).includes(deptId)) continue;
    const dateName = selectName(row.fields.Date);
    const iso = normalizeVolunteerDate(dateName);
    if (!iso) continue;
    assignmentsByDate.set(iso, {
      directorIds: toIdList(row.fields["Directors on Shift"]),
      volunteerIds: toIdList(row.fields["Volunteers on Shift"]),
    });
  }

  return c.json({
    callerIsDeptDirector,
    department: {
      id: dept.id,
      name: dept.fields["Department Name"] ?? "",
      scheduleStatus,
      submittedAt: dept.fields["Submitted At"] ?? null,
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
    })),
  });
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

  const statusName = selectName(dept.fields["Schedule Status"]) || "Draft";
  if (statusName === "Submitted") {
    return c.json({ error: "Schedule already submitted" }, 409);
  }

  // find existing row for (dept, date)
  const all = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
  });
  const existing = all.find((row) => {
    if (!toIdList(row.fields.Department).includes(departmentId)) return false;
    return normalizeVolunteerDate(selectName(row.fields.Date)) === date;
  });

  const dateName = displayDate(date);
  const deptName = dept.fields["Department Name"] ?? "";

  const fields = {
    Name: `${deptName} — ${dateName}`,
    Department: [departmentId],
    Date: dateName,
    "Directors on Shift": body.directorIds ?? [],
    "Volunteers on Shift": body.volunteerIds ?? [],
  };

  if (existing) {
    await patchRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      recordId: existing.id,
      fields,
    });
  } else {
    await createRecord({
      baseId: config.haveNManagementBaseId,
      tableId: config.su26ScheduleTableId,
      fields,
    });
  }

  return c.json({ success: true });
});

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

  const statusName = selectName(dept.fields["Schedule Status"]) || "Draft";
  if (statusName === "Submitted") return c.json({ error: "Already submitted" }, 409);

  await patchRecord({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
    recordId: dept.id,
    fields: {
      "Schedule Status": "Submitted",
      "Submitted At": new Date().toISOString(),
      "Submitted By": [caller.id],
    },
  });

  return c.json({ success: true });
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

  const statusName = selectName(dept.fields["Schedule Status"]) || "Draft";
  if (statusName === "Submitted") {
    return c.json({ error: "Schedule already submitted — unlock first" }, 409);
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
  // listed as a Volunteer on Shift.
  const schedule = await listAll<ScheduleRowFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26ScheduleTableId,
  });
  const affected = schedule.filter((row) => {
    if (!toIdList(row.fields.Department).includes(departmentId)) return false;
    return toIdList(row.fields["Volunteers on Shift"]).includes(personId);
  });
  await Promise.all(
    affected.map((row) =>
      patchRecord({
        baseId: config.haveNManagementBaseId,
        tableId: config.su26ScheduleTableId,
        recordId: row.id,
        fields: {
          "Volunteers on Shift": toIdList(row.fields["Volunteers on Shift"]).filter(
            (id) => id !== personId,
          ),
        },
      }),
    ),
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

  const { callerNetid, callerEmail } = (await c.req.json()) as {
    callerNetid?: string;
    callerEmail?: string;
  };
  if (!callerNetid || !callerEmail) {
    return c.json({ error: "Missing callerNetid / callerEmail" }, 400);
  }

  const person = await findPerson(config, callerNetid, callerEmail);
  if (!person) return c.json({ error: "Unauthorized" }, 401);

  const [allDepts, allScheduleRows, pendingRequests] = await Promise.all([
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
      filterByFormula: `AND({Status} = 'Pending', FIND('${escapeFormulaString(person.id)}', ARRAYJOIN({Requester})) > 0)`,
    }),
  ]);

  const deptIdByName = new Map<string, { id: string; name: string }>();
  for (const d of allDepts) {
    const name = d.fields["Department Name"] ?? "";
    if (name) deptIdByName.set(name, { id: d.id, name });
  }

  const pendingByKey = new Map<string, string>();
  for (const r of pendingRequests) {
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
    pendingRequestId: string | null;
  }> = [];

  for (const row of allScheduleRows) {
    const deptName = selectName(row.fields.Department);
    const dept = deptIdByName.get(deptName);
    if (!dept) continue;
    const iso = normalizeVolunteerDate(selectName(row.fields.Date));
    if (!iso) continue;
    const directorIds = toIdList(row.fields["Directors on Shift"]);
    const volunteerIds = toIdList(row.fields["Volunteers on Shift"]);
    const role: "director" | "volunteer" | null =
      directorIds.includes(person.id) ? "director" :
      volunteerIds.includes(person.id) ? "volunteer" : null;
    if (!role) continue;
    assignments.push({
      deptId: dept.id,
      deptName: dept.name,
      date: iso,
      role,
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
  });
});
