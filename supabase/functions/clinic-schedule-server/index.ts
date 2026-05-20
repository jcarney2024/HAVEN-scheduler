import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.ts";

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

Deno.serve(app.fetch);
