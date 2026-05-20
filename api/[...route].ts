import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import { app } from "../server/app.js";

export const config = { runtime: "nodejs" };

// Vercel hands us requests at their full URL (e.g. /api/director/abc123).
// Hono routes off the URL pathname, so we mount `app` under /api so its
// internal routes (/director/:netid, /schedule/:deptId) match the live URLs.
const root = new Hono();
root.route("/api", app);

// Manual Node <-> Web adapter. The hono/vercel and @hono/node-server/vercel
// adapters both stream the request body via Readable.toWeb(), which deadlocks
// on Vercel's nodejs runtime for POST requests. Buffering the body first
// avoids the hang.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const method = req.method ?? "GET";
    const protocol =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
    const host = req.headers.host ?? "localhost";
    const url = `${protocol}://${host}${req.url ?? "/"}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else if (typeof value === "string") {
        headers.set(key, value);
      }
    }

    let body: Buffer | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
      }
      body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    }

    const request = new Request(url, { method, headers, body });
    const response = await root.fetch(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error("API handler error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
    }
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
  }
}
