// Every interview is graded on this baseline, plus a role rubric built for the specific
// company and position (see createInterview in claude.js).
export const BASELINE = [
  { name: "Clear communication", strong: "Answers are organized, direct and easy to follow, without rambling." },
  { name: "Specific examples", strong: "Backs up claims with real situations: what happened, what they did, how it ended." },
  { name: "Ownership and impact", strong: "Makes clear what they personally did and the result, with numbers when possible." },
  { name: "Motivation and fit", strong: "Knows what the company and role are about and can say why they want this one." },
  { name: "Self-awareness", strong: "Reflects honestly on mistakes and tradeoffs and what they learned." },
];

// Overall score out of 10: the role rubric counts for 60%, the baseline for 40%.
export function overallScore(baseline, role) {
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + (x.score || 0), 0) / xs.length : 0);
  const b = avg(baseline);
  const r = role.length ? avg(role) : b;
  return Math.round((b * 0.4 + r * 0.6) * 20) / 10;
}
