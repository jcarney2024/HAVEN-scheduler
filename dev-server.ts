import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { app } from "./server/app";

const root = new Hono();
root.route("/api", app);

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: root.fetch, port });
console.log(`[dev-server] API listening on http://localhost:${port}`);
