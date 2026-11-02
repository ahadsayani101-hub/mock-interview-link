// Small helpers shared by the API routes (Vercel Node functions and the local dev server).
import { overLimit } from "./store.js";
export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

// Throws a 429 when this visitor (or the whole site) is over the usage limit for `name`.
export async function limit(req, name, caps) {
  if (await overLimit(name, clientIp(req), caps)) throw bad("This is getting a lot of use right now. Please try again in a little while.", 429);
}

// A POST JSON route. `caps` ({ name, perHour, perDay }) adds a usage limit.
export function route(fn, caps) {
  return async (req, res) => {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    try {
      if (caps) await limit(req, caps.name, caps);
      send(res, 200, await fn(await readJson(req)));
    } catch (err) {
      console.error(err);
      send(res, err.expose ? err.status : 500, { error: err.message || "Something went wrong" });
    }
  };
}

// An error whose status and message are safe to show the browser.
export function bad(message, status = 400) {
  return Object.assign(new Error(message), { status, expose: true });
}
