import { route, bad } from "../lib/http.js";
import { createInterview } from "../lib/claude.js";
import { hasStore, savePlan } from "../lib/store.js";

export default route(async ({ posting, count }) => {
  posting = String(posting || "").trim();
  if (posting.length < 80) throw bad("Paste the full job posting (at least a few sentences).");
  if (posting.length > 20000) throw bad("That posting is very long. Trim it to the main description.");
  const n = Math.min(Math.max(parseInt(count) || 5, 3), 8);
  const plan = await createInterview(posting, n);
  const id = hasStore() ? await savePlan(plan) : null;
  return { plan, id };
});
