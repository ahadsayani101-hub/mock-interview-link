import { route, bad } from "../lib/http.js";
import { scoreInterview } from "../lib/claude.js";
import { scorecardHtml, sendScorecard } from "../lib/email.js";
import { BASELINE } from "../lib/rubric.js";

export default route(async ({ plan, turns, name, email }) => {
  if (!plan?.questions || !Array.isArray(turns)) throw bad("Bad request");
  turns = turns
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .slice(0, 400)
    .map((t) => ({ who: t.who === "candidate" ? "candidate" : "interviewer", text: t.text.trim().slice(0, 4000), q: Number.isInteger(t.q) ? t.q : undefined }));
  if (!turns.some((t) => t.who === "candidate")) throw bad("We didn't catch any answers, so there's nothing to grade yet.");
  name = String(name || "").slice(0, 80);
  email = String(email || "").trim();
  const card = await scoreInterview({ plan, turns, name });
  const html = scorecardHtml({ plan, card, name });
  let mail = { sent: false, reason: "No email address given." };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    try {
      mail = await sendScorecard({ to: email, subject: `Your mock interview scorecard: ${plan.role} at ${plan.company}`, html });
    } catch (err) {
      console.error(err);
      mail = { sent: false, reason: err.message };
    }
  }
  return { card, html, mail, baseline: BASELINE };
});
