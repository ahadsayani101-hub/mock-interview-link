// Demo mode: used only when ANTHROPIC_API_KEY is not set, so the app can be clicked through end to end.

export function mockCreate(posting, count) {
  const firstLine = posting.split("\n").map((l) => l.trim()).find(Boolean) || "this role";
  const role = firstLine.slice(0, 80);
  const qs = [
    { ask: `Thanks for joining. To start, what draws you to the ${role} role?`, why: "motivation" },
    { ask: "Tell me about a time you had to learn something new quickly to get a project done.", why: "learning fast" },
    { ask: "Walk me through a project you're proud of and the part you personally owned.", why: "ownership" },
    { ask: "Tell me about a disagreement with a teammate and how you resolved it.", why: "collaboration" },
    { ask: "This role moves fast. How do you decide what to work on first when everything feels urgent?", why: "prioritization" },
  ];
  return { role, company: "", context: posting.slice(0, 400), questions: qs.slice(0, count), demo: true };
}

export function mockTurn({ exchanges, canFollowUp, isLast }) {
  const last = exchanges[exchanges.length - 1]?.a || "";
  if (canFollowUp && last.split(/\s+/).length < 25)
    return { action: "followup", say: "Can you give me a specific example, and what the result was?" };
  return { action: "next", say: isLast ? "Thanks, that wraps up our questions." : "Thanks, that's helpful." };
}

export function mockScore({ transcript }) {
  return {
    overall: 6,
    headline: "Demo scorecard",
    summary: "This is demo mode, so scores are placeholders. Add an Anthropic API key to get real feedback.",
    questions: transcript.map((t) => ({
      score: 3,
      quote: (t.exchanges.map((e) => e.a).join(" ") || "").slice(0, 160),
      strength: "You answered the question.",
      improve: "Add a concrete example with a measurable result.",
    })),
    next_steps: ["Prepare three STAR stories", "Quantify your results", "Practice out loud"],
    demo: true,
  };
}
