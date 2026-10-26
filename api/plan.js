import { send } from "../lib/http.js";
import { hasStore, loadPlan } from "../lib/store.js";
import { BASELINE } from "../lib/rubric.js";

export default async function handler(req, res) {
  const id = new URL(req.url, "http://x").searchParams.get("id") || "";
  try {
    const plan = hasStore() ? await loadPlan(id) : null;
    if (!plan) return send(res, 404, { error: "This interview link has expired or doesn't exist." });
    send(res, 200, { plan, baseline: BASELINE });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: "Couldn't load this interview." });
  }
}
