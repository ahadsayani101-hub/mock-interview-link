// Small helpers shared by the API routes (Vercel Node functions and the local dev server).
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

export function route(fn) {
  return async (req, res) => {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    try {
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
