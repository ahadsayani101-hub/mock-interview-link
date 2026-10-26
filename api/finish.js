import { route, bad } from "../lib/http.js";
import { scoreInterview } from "../lib/claude.js";
import { scorecardHtml, sendScorecard } from "../lib/email.js";

export default route(async ({ plan, transcript, name, email }) => {
  if (!plan?.questions || !Array.isArray(transcript)) throw bad("Bad request");
  name = String(name || "").slice(0, 80);
  email = String(email || "").trim();
  const card = await scoreInterview({ plan, transcript, name });
  const html = scorecardHtml({ plan, card, name, transcript });
  let mail = { sent: false, reason: "No email address given." };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    try {
      mail = await sendScorecard({ to: email, subject: `Your mock interview scorecard: ${plan.role}`, html });
    } catch (err) {
      console.error(err);
      mail = { sent: false, reason: err.message };
    }
  }
  return { card, html, mail };
});
