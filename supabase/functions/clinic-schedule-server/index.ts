import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.ts";
import { escapeFormulaString, listAll } from "./airtable.ts";

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

Deno.serve(app.fetch);
