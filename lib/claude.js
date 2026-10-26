import Anthropic from "@anthropic-ai/sdk";
import { mockCreate, mockTurn, mockScore } from "./mock.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);
let client;

// One structured call: the model must return JSON matching `schema`.
async function askJson({ system, prompt, schema, effort = "low", maxTokens = 4000 }) {
  client ||= new Anthropic();
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort, format: { type: "json_schema", schema } },
    // If a safety classifier declines, retry server-side on the recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("The model ran out of room. Try a shorter posting.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// ---------- 1. Turn a job posting into an interview plan ----------

const PLAN_SCHEMA = obj({
  role: { type: "string" },
  company: { type: "string" },
  context: { type: "string" },
  questions: {
    type: "array",
    items: obj({ ask: { type: "string" }, why: { type: "string" } }),
  },
});

export async function createInterview(posting, count = 5) {
  if (!hasKey()) return mockCreate(posting, count);
  const plan = await askJson({
    effort: "medium",
    system:
      "You design realistic spoken mock interviews from job postings. Questions will be read aloud " +
      "by a text-to-speech voice to a candidate on their phone, so write them the way a friendly, " +
      "sharp hiring manager talks: one question at a time, one or two sentences, no lists, no " +
      "parentheses, no markdown.",
    prompt:
      `Here is a job posting:\n\n<posting>\n${posting}\n</posting>\n\n` +
      `Write exactly ${count} interview questions. Ground every question in something specific the ` +
      "posting actually asks for (a responsibility, skill, tool, or value) and mention it, so the " +
      "candidate can tell the question came from this posting. Start with a warm-up about why this " +
      "role, include at least one behavioral question (tell me about a time...) and at least one " +
      "practical or technical question, and end with the hardest one.\n\n" +
      "Fields: role = job title; company = company name or empty string if not stated; " +
      "context = a 2-4 sentence summary of the role and its key requirements for the interviewer " +
      "to use later; questions[].ask = the spoken question; questions[].why = the posting " +
      "requirement it tests, in a few words.",
    schema: PLAN_SCHEMA,
  });
  plan.questions = plan.questions.slice(0, count);
  return plan;
}

// ---------- 2. After each answer: probe once, or move on ----------

const TURN_SCHEMA = obj({
  action: { type: "string", enum: ["followup", "next"] },
  say: { type: "string" },
});

export async function nextTurn({ plan, index, exchanges, canFollowUp, isLast }) {
  if (!hasKey()) return mockTurn({ exchanges, canFollowUp, isLast });
  const q = plan.questions[index];
  const convo = exchanges.map((e) => `Interviewer: ${e.q}\nCandidate: ${e.a || "(no answer)"}`).join("\n\n");
  return askJson({
    effort: "low",
    maxTokens: 2000,
    system:
      "You are a friendly but probing hiring manager running a spoken mock interview. Everything " +
      "you write is read aloud, so write short natural speech: no lists, no markdown, no emojis.",
    prompt:
      `Role: ${plan.role}${plan.company ? ` at ${plan.company}` : ""}\nContext: ${plan.context}\n\n` +
      `Current question (tests: ${q.why}):\n${convo}\n\n` +
      (canFollowUp
        ? "Decide what to do next. If the answer is vague, generic, missing a concrete example, " +
          "missing the result or the candidate's own role, or skips part of the question, choose " +
          "action=followup and ask ONE pointed follow-up that digs into what they said (reference " +
          "their words). If the answer is already specific and complete, choose action=next.\n"
        : "You must choose action=next.\n") +
      (isLast
        ? "If you choose next, this was the final question: say=a one-sentence warm acknowledgment " +
          "that does not ask anything and does not evaluate the answer.\n"
        : "If you choose next, say=a brief natural acknowledgment of a few words (like 'Thanks, " +
          "that's helpful.'), with no evaluation and no new question; the next question is added " +
          "automatically.\n"),
    schema: TURN_SCHEMA,
  });
}

// ---------- 3. Scorecard ----------

const SCORE_SCHEMA = obj({
  overall: { type: "integer" },
  headline: { type: "string" },
  summary: { type: "string" },
  questions: {
    type: "array",
    items: obj({
      score: { type: "integer" },
      quote: { type: "string" },
      strength: { type: "string" },
      improve: { type: "string" },
    }),
  },
  next_steps: { type: "array", items: { type: "string" } },
});

export async function scoreInterview({ plan, transcript, name }) {
  if (!hasKey()) return mockScore({ plan, transcript });
  const body = transcript
    .map((t, i) => {
      const lines = t.exchanges.map((e) => `Interviewer: ${e.q}\n${name || "Candidate"}: ${e.a || "(no answer)"}`);
      return `### Question ${i + 1} (tests: ${plan.questions[i]?.why || "general"})\n${lines.join("\n")}`;
    })
    .join("\n\n");
  const card = await askJson({
    effort: "medium",
    maxTokens: 8000,
    system:
      "You are an experienced hiring manager writing an honest, encouraging scorecard for a mock " +
      "interview. Answers were transcribed from speech, so ignore filler words and transcription " +
      "errors, and judge substance.",
    prompt:
      `Role: ${plan.role}${plan.company ? ` at ${plan.company}` : ""}\nContext: ${plan.context}\n\n` +
      `Transcript:\n\n${body}\n\n` +
      `Score the interview. questions must have exactly ${transcript.length} entries, in order. For ` +
      "each: score 1-5 (5 = would clearly advance); quote = the single most telling sentence or " +
      "phrase the candidate said, copied word for word from the transcript (empty string if they " +
      "gave no answer); strength = one sentence on what worked; improve = one specific, actionable " +
      "sentence on what would make the answer stronger. overall = 1-10. headline = a short verdict " +
      "of a few words. summary = 2-3 sentences. next_steps = 3 concrete things to practice before " +
      "the real interview.",
    schema: SCORE_SCHEMA,
  });
  // Quotes must really be theirs: if the model paraphrased, fall back to their own words.
  card.questions = transcript.map((t, i) => {
    const q = card.questions[i] || { score: 1, quote: "", strength: "", improve: "" };
    const said = t.exchanges.map((e) => e.a || "").join(" ");
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (q.quote && !norm(said).includes(norm(q.quote))) q.quote = firstSentence(said);
    return q;
  });
  return card;
}

function firstSentence(s) {
  const m = s.trim().match(/^.{1,200}?[.!?](\s|$)/);
  return (m ? m[0] : s.trim().slice(0, 200)).trim();
}
