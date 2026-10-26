// Demo mode: used only when ANTHROPIC_API_KEY is not set, so the app can be clicked through end to end.
import { BASELINE, overallScore } from "./rubric.js";

export function mockCreate({ company, position, posting }, count) {
  const role = position || "this role";
  const qs = [
    { ask: `Thanks for joining. To start, what draws you to the ${role} role${company ? ` at ${company}` : ""}?`, why: "Motivation and fit" },
    { ask: "Tell me about a time you had to learn something new quickly to get a project done.", why: "Learning fast" },
    { ask: "Walk me through a project you're proud of and the part you personally owned.", why: "Ownership and impact" },
    { ask: "Tell me about a disagreement with a teammate and how you resolved it.", why: "Collaboration" },
    { ask: "This role moves fast. How do you decide what to work on first when everything feels urgent?", why: "Prioritization" },
    { ask: "Tell me about a mistake you made and what you changed afterward.", why: "Self-awareness" },
    { ask: "What would you want to accomplish in your first ninety days here?", why: "Motivation and fit" },
  ];
  return {
    role,
    company,
    context: posting.slice(0, 400),
    research: "",
    sources: [],
    prep: {
      about: `Demo mode: with an API key, this would summarize ${company || "the company"} and what the ${role} does there, based on a web search.`,
      looks_for: ["Clear, specific examples from your experience", "Ownership of your work and its results", "Curiosity about the company's product", "Comfort working on a team"],
      prepare: ["Pick three stories: a challenge, a team win, and a mistake you learned from", "Reread the job description and note two skills you can prove", "Have one question ready about the team"],
      tips: ["Lead with the result, then explain how you got there", "Use numbers when you can", "It's fine to pause and think before answering"],
    },
    rubric: [
      { name: "Learning fast", strong: "Shows a concrete example of picking up a new skill under time pressure.", source: "Demo" },
      { name: "Collaboration", strong: "Works through disagreement respectfully and lands on a shared outcome.", source: "Demo" },
      { name: "Prioritization", strong: "Explains a clear way of choosing what matters most.", source: "Demo" },
    ],
    questions: qs.slice(0, count),
    demo: true,
  };
}

export function mockTurn({ exchanges, canFollowUp, isLast }) {
  const last = exchanges[exchanges.length - 1]?.a || "";
  if (canFollowUp && last.split(/\s+/).length < 25)
    return { action: "followup", say: "Can you give me a specific example, and what the result was?" };
  return { action: "next", say: isLast ? "Thanks, that wraps up our questions." : "Thanks, that's helpful." };
}

export function mockScore({ plan, transcript }) {
  const said = transcript.flatMap((t) => t.exchanges.map((e) => e.a)).join(" ").slice(0, 140);
  const crit = (c, i) => ({ score: 2 + (i % 3), evidence: said, comment: "Demo comment. Add an API key for real grading." });
  const baseline = BASELINE.map(crit);
  const role = (plan.rubric || []).map(crit);
  return {
    overall: overallScore(baseline, role),
    headline: "Demo scorecard",
    summary: "This is demo mode, so scores are placeholders. Add an Anthropic API key to get real feedback.",
    baseline,
    role,
    questions: transcript.map((t) => ({
      score: 3,
      quote: (t.exchanges.map((e) => e.a).join(" ") || "").slice(0, 160),
      strength: "You answered the question.",
      improve: "Add a concrete example with a measurable result.",
    })),
    next_steps: ["Prepare three stories with a clear result", "Quantify your impact", "Practice out loud"],
    demo: true,
  };
}
