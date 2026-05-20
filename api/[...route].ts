import { Hono } from "hono";
import { handle } from "hono/vercel";
import { app } from "../server/app.js";

export const config = { runtime: "nodejs" };

// Vercel hands us requests at their full URL (e.g. /api/director/abc123).
// Hono routes off the URL pathname, so we mount `app` under /api so its
// internal routes (/director/:netid, /schedule/:deptId) match the live URLs.
const root = new Hono();
root.route("/api", app);

export default handle(root);
