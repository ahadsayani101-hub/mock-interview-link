import { route, bad } from "../lib/http.js";
import { nextTurn } from "../lib/claude.js";

const MAX_FOLLOWUPS = 1;

export default route(async ({ plan, index, exchanges }) => {
  if (!plan?.questions?.[index] || !Array.isArray(exchanges) || !exchanges.length) throw bad("Bad request");
  const canFollowUp = exchanges.length <= MAX_FOLLOWUPS;
  const isLast = index === plan.questions.length - 1;
  const t = await nextTurn({ plan, index, exchanges: exchanges.slice(-4), canFollowUp, isLast });
  if (!canFollowUp) t.action = "next";
  return t;
});
