import { route, bad } from "../lib/http.js";
import { createInterview } from "../lib/claude.js";
import { hasStore, savePlan } from "../lib/store.js";
import { BASELINE } from "../lib/rubric.js";
import { pickInterviewer } from "../lib/interviewers.js";

export default route(async ({ company, position, posting, count, interviewer }) => {
  company = String(company || "").trim().slice(0, 80);
  position = String(position || "").trim().slice(0, 120);
  posting = String(posting || "").trim();
  if (!company) throw bad("Add the company name.");
  if (!position) throw bad("Add the position title.");
  if (posting.length < 80) throw bad("Paste the full job description (at least a few sentences).");
  if (posting.length > 20000) throw bad("That description is very long. Trim it to the main part.");
  const n = Math.min(Math.max(parseInt(count) || 5, 3), 8);
  const plan = await createInterview({ company, position, posting }, n);
  plan.interviewer = pickInterviewer(interviewer);
  const id = hasStore() ? await savePlan(plan) : null;
  return { plan, id, baseline: BASELINE };
});
