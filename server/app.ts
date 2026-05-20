import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createRecord, escapeFormulaString, listAll, patchRecord } from "./airtable";
import { CANONICAL_DATES, normalizeVolunteerDate, normalizeDirectorDate, displayDate } from "./dates";
import { computeConflicts, type ScheduleEntry } from "./conflicts";
import { loadConfig, type Config } from "./config";

type AllPeopleFields = {
  NetID?: string;
  "Contact Email"?: string;
  Name?: string;
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
};

type VolunteerAppFields = {
  NetID?: string;
  "General Availability"?: unknown;
};

type ScheduleRowFields = {
  Department?: unknown;
  Date?: unknown;
  "Directors on Shift"?: unknown;
  "Volunteers on Shift"?: unknown;
};

export const app = new Hono();
app.use("*", cors());
app.use("*", logger());

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

async function findDepartmentsForDirector(config: Config, personId: string) {
  const allDepts = await listAll<Su26RosterFields>({
    baseId: config.haveNManagementBaseId,
    tableId: config.su26RosterTableId,
  });
  return allDepts.filter((d) => toIdList(d.fields.Directors).includes(personId));
}

app.post(`/director/:netid`, async (c) => {
  const config = await getConfig();
  if (!config) return c.json({ error: "Not configured" }, 400);
  const netid = c.req.param("netid");
  const { email } = (await c.req.json()) as { email?: string };
  if (!netid || !email) return c.json({ error: "Missing netid or email" }, 400);

  const person = await findPerson(config, netid, email);
  if (!person) return c.json({ error: "Not found" }, 404);

  const depts = await findDepartmentsForDirector(config, person.id);
  if (depts.length === 0) {
    return c.json({ error: "Not a SU 26 director" }, 403);
  }

  return c.json({
    person: {
      id: person.id,
      name: person.fields.Name ?? "",
      netid: person.fields.NetID ?? "",
      email: person.fields["Contact Email"] ?? "",
    },
    departments: depts.map((d) => ({
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

  const [allRoster, allSchedule, allDirectorApps, allVolunteerApps] = await Promise.all([
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
      fields: ["Yale NetID", "What is your spring availability?"],
    }),
    listAll<VolunteerAppFields>({
      baseId: config.volunteerAppsBaseId,
      tableId: config.volunteerAppsTableId,
      fields: ["NetID", "General Availability"],
    }),
  ]);

  const dept = allRoster.find((r) => r.id === deptId);
  if (!dept) return c.json({ error: "Department not found" }, 404);
  const callerIsDeptDirector = toIdList(dept.fields.Directors).includes(caller.id);

  // dept name lookup for ScheduleEntry construction
  const deptNameById = new Map<string, string>(
    allRoster.map((d) => [d.id, d.fields["Department Name"] ?? ""])
  );

  // build NetID → ISO[] availability lookups
  const directorAvail = new Map<string, string[]>();
  for (const r of allDirectorApps) {
    const nid = (r.fields["Yale NetID"] ?? "").toLowerCase();
    if (!nid) continue;
    const names = toNameList(r.fields["What is your spring availability?"]);
    directorAvail.set(
      nid,
      names.map((n) => normalizeDirectorDate(n)).filter((x): x is string => !!x),
    );
  }
  const volAvail = new Map<string, string[]>();
  for (const r of allVolunteerApps) {
    const nid = (r.fields.NetID ?? "").toLowerCase();
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
    const available =
      kind === "director" ? directorAvail.get(netid) ?? [] : volAvail.get(netid) ?? [];
    const conflicts = computeConflicts({
      personId: id,
      thisDepartmentId: deptId,
      allSchedule: scheduleEntries,
    });
    return { id, netid, name: person?.fields.Name ?? "", available, conflicts };
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

  if (!toIdList(dept.fields.Directors).includes(caller.id)) {
    return c.json({ error: "Caller not a director on this department" }, 403);
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
  if (!toIdList(dept.fields.Directors).includes(caller.id)) {
    return c.json({ error: "Not a director on this department" }, 403);
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
