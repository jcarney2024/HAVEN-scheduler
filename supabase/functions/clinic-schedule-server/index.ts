import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.ts";
import { escapeFormulaString, listAll } from "./airtable.ts";
import { CANONICAL_DATES, normalizeVolunteerDate, normalizeDirectorDate, displayDate } from "./dates.ts";
import { computeConflicts, type ScheduleEntry } from "./conflicts.ts";

type Config = {
  haveNManagementBaseId: string;
  allPeopleTableId: string;
  su26RosterTableId: string;
  su26ScheduleTableId: string;
  directorAppsBaseId: string;
  directorAppsTableId: string;
  volunteerAppsBaseId: string;
  volunteerAppsTableId: string;
};

type AllPeopleFields = {
  NetID?: string;
  "Contact Email"?: string;
  Name?: string;
};

type Su26RosterFields = {
  "Department Name"?: string;
  Directors?: { id: string; name: string }[] | string[];
  "Schedule Status"?: { id: string; name: string } | string;
  "Submitted At"?: string;
  "Submitted By"?: { id: string; name: string }[] | string[];
};

type DirectorAppFields = {
  "Yale NetID"?: string;
  "What is your spring availability?"?: { id: string; name: string }[] | string[];
};

type VolunteerAppFields = {
  NetID?: string;
  "General Availability"?: { id: string; name: string }[] | string[];
};

type ScheduleRowFields = {
  Department?: { id: string; name: string }[] | string[];
  Date?: { id: string; name: string } | string;
  "Directors on Shift"?: { id: string; name: string }[] | string[];
  "Volunteers on Shift"?: { id: string; name: string }[] | string[];
};

const KV_KEY = "clinic_schedule_config_v1";
const ROUTE_PREFIX = "/make-server-clinic-schedule";

const AIRTABLE_PAT = Deno.env.get("AIRTABLE_PAT") ?? "";

const app = new Hono();
app.use("*", cors());
app.use("*", logger());

async function getConfig(): Promise<Config | null> {
  const data = await kv.get(KV_KEY);
  return data ? (data as Config) : null;
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
  return allDepts.filter((d) => {
    const dirs = d.fields.Directors as { id: string }[] | undefined;
    return Array.isArray(dirs) && dirs.some((ref) => ref.id === personId);
  });
}

function nameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : (v as { name?: string }).name ?? ""));
}

function selectName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name ?? "");
  }
  return "";
}

app.get(`${ROUTE_PREFIX}/config`, async (c) => {
  const config = await getConfig();
  return c.json({ configured: !!config, config });
});

app.post(`${ROUTE_PREFIX}/config`, async (c) => {
  const body = (await c.req.json()) as Partial<Config>;
  const required: (keyof Config)[] = [
    "haveNManagementBaseId",
    "allPeopleTableId",
    "su26RosterTableId",
    "su26ScheduleTableId",
    "directorAppsBaseId",
    "directorAppsTableId",
    "volunteerAppsBaseId",
    "volunteerAppsTableId",
  ];
  for (const key of required) {
    if (!body[key]) return c.json({ error: `Missing ${key}` }, 400);
  }
  await kv.set(KV_KEY, body);
  return c.json({ success: true });
});

app.get(`${ROUTE_PREFIX}/bases`, async (c) => {
  const res = await fetch("https://api.airtable.com/v0/meta/bases", {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });
  return c.json(await res.json(), res.status as 200 | 400 | 401);
});

app.post(`${ROUTE_PREFIX}/tables`, async (c) => {
  const { baseId } = (await c.req.json()) as { baseId?: string };
  if (!baseId) return c.json({ error: "Missing baseId" }, 400);
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } },
  );
  return c.json(await res.json(), res.status as 200 | 400 | 401);
});

app.post(`${ROUTE_PREFIX}/director/:netid`, async (c) => {
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
    departments: depts.map((d) => {
      const status = d.fields["Schedule Status"];
      const statusName =
        typeof status === "string" ? status : status?.name ?? "Draft";
      return {
        id: d.id,
        name: d.fields["Department Name"] ?? "",
        scheduleStatus: statusName,
        submittedAt: d.fields["Submitted At"] ?? null,
      };
    }),
  });
});

app.post(`${ROUTE_PREFIX}/schedule/:deptId`, async (c) => {
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
  const deptDirectors = dept.fields.Directors as { id: string; name: string }[] | undefined;
  const callerIsDeptDirector = (deptDirectors ?? []).some((d) => d.id === caller.id);

  // build a NetID → ISO[] availability lookup, for both kinds
  const directorAvail = new Map<string, string[]>();
  for (const r of allDirectorApps) {
    const nid = (r.fields["Yale NetID"] ?? "").toLowerCase();
    if (!nid) continue;
    const dates = (r.fields["What is your spring availability?"] ?? []) as { name?: string }[];
    directorAvail.set(
      nid,
      dates.map((d) => normalizeDirectorDate(d.name ?? "")).filter((x): x is string => !!x),
    );
  }
  const volAvail = new Map<string, string[]>();
  for (const r of allVolunteerApps) {
    const nid = (r.fields.NetID ?? "").toLowerCase();
    if (!nid) continue;
    const dates = (r.fields["General Availability"] ?? []) as { name?: string }[];
    volAvail.set(
      nid,
      dates.map((d) => normalizeVolunteerDate(d.name ?? "")).filter((x): x is string => !!x),
    );
  }

  // fetch All People records for everyone on this dept's roster (one batch)
  const dirRefs = (dept.fields.Directors as { id: string }[] | undefined) ?? [];
  const volRefs = ((dept.fields as Record<string, unknown>)["Volunteers"] as { id: string }[] | undefined) ?? [];
  const allIds = [...dirRefs.map((r) => r.id), ...volRefs.map((r) => r.id)];
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
      const deptRef = (row.fields.Department as { id: string; name?: string }[] | undefined)?.[0];
      const dateName = selectName(row.fields.Date);
      const iso = normalizeVolunteerDate(dateName);
      if (!deptRef || !iso) return null;
      const dirs = (row.fields["Directors on Shift"] as { id: string }[] | undefined) ?? [];
      const vols = (row.fields["Volunteers on Shift"] as { id: string }[] | undefined) ?? [];
      return {
        date: iso,
        departmentId: deptRef.id,
        departmentName: deptRef.name ?? "",
        directorIds: dirs.map((r) => r.id),
        volunteerIds: vols.map((r) => r.id),
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

  const deptSchedule = allSchedule.filter((row) => {
    const refs = row.fields.Department as { id: string }[] | undefined;
    return Array.isArray(refs) && refs.some((r) => r.id === deptId);
  });

  const assignmentsByDate = new Map<string, { directorIds: string[]; volunteerIds: string[] }>();
  for (const row of deptSchedule) {
    const dateName = selectName(row.fields.Date);
    const iso = normalizeVolunteerDate(dateName);
    if (!iso) continue;
    const dirs = (row.fields["Directors on Shift"] as { id: string }[] | undefined) ?? [];
    const vols = (row.fields["Volunteers on Shift"] as { id: string }[] | undefined) ?? [];
    assignmentsByDate.set(iso, {
      directorIds: dirs.map((r) => r.id),
      volunteerIds: vols.map((r) => r.id),
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
      directors: dirRefs.map((r) => buildPerson(r.id, "director")),
      volunteers: volRefs.map((r) => buildPerson(r.id, "volunteer")),
    },
    assignments: CANONICAL_DATES.map((iso) => ({
      date: iso,
      directorIds: assignmentsByDate.get(iso)?.directorIds ?? [],
      volunteerIds: assignmentsByDate.get(iso)?.volunteerIds ?? [],
    })),
  });
});

Deno.serve(app.fetch);
