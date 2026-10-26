import Anthropic from "@anthropic-ai/sdk";
import { mockCreate, mockTurn, mockScore } from "./mock.js";
import { BASELINE, overallScore } from "./rubric.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);
let client;
const api = () => (client ||= new Anthropic());

// If a safety classifier declines, retry server-side on the recommended model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

// Sends a request with the refusal fallback; if this account or model rejects that beta
// (400), sends it once more without it.
async function create(params, opts) {
  try {
    return await api().beta.messages.create({ ...params, ...FALLBACK }, opts);
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    console.error("Retrying without fallback:", err.message);
    return api().beta.messages.create(params, opts);
  }
}

function check(res) {
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("The model ran out of room. Try a shorter posting.");
}

const textOf = (res) => res.content.filter((b) => b.type === "text").map((b) => b.text).join("");

// One structured call: the model must return JSON matching `schema`.
async function askJson({ system, prompt, schema, effort = "low", maxTokens = 4000 }) {
  const res = await create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort, format: { type: "json_schema", schema } },
  });
  check(res);
  return JSON.parse(textOf(res));
}

const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// ---------- 1a. Research the company and role on the web ----------

async function research({ company, position, posting }) {
  const messages = [
    {
      role: "user",
      content:
        `We're preparing a realistic mock interview for the ${position} position at ${company}. ` +
        `Here is the job description:\n<job_description>\n${posting.slice(0, 6000)}\n</job_description>\n\n` +
        "Search the web thoroughly and gather everything useful for preparing a candidate:\n" +
        "- what the company does, its products, size and any notable recent news\n" +
        "- its mission, values, culture, or leadership principles, in the company's own words\n" +
        "- how it interviews for this kind of role: stages, format, and what interviewers look for\n" +
        "- interview questions candidates report being asked for this or similar roles there\n" +
        "- the skills, tools and experience that matter most for this role at this company\n" +
        "Prefer the company's own careers pages and engineering or company blog, then reputable " +
        "sources such as Glassdoor, Levels.fyi, news coverage, or candidate write-ups. Then write " +
        "a research brief of at most 400 words, organized under those five headings as short " +
        "bullet points. Say plainly when something could not be found. No preamble.",
    },
  ];
  const sources = new Map();
  const started = Date.now();
  const left = () => 200_000 - (Date.now() - started); // stay well inside Vercel's 300s limit
  let res;
  // Server-side search can pause a long turn; resume it while there's time left.
  for (let i = 0; i < 4 && left() > 30_000; i++) {
    res = await create(
      {
        model: MODEL,
        max_tokens: 16000,
        messages,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 8 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, max_content_tokens: 20000 },
        ],
        output_config: { effort: "medium" },
      },
      { timeout: left(), maxRetries: 0 },
    );
    for (const b of res.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content))
        for (const r of b.content) if (r.url && !sources.has(r.url)) sources.set(r.url, r.title || r.url);
      if (b.type === "web_fetch_tool_result" && b.content?.url && !sources.has(b.content.url))
        sources.set(b.content.url, b.content.content?.title || b.content.url);
    }
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  check(res);
  return {
    brief: textOf(res).trim(),
    sources: [...sources].slice(0, 6).map(([url, title]) => ({ url, title })),
  };
}

// ---------- 1b. Turn the posting + research into questions and a rubric ----------

const strings = { type: "array", items: { type: "string" } };
const PLAN_SCHEMA = obj({
  context: { type: "string" },
  prep: obj({ about: { type: "string" }, looks_for: strings, prepare: strings, tips: strings }),
  rubric: {
    type: "array",
    items: obj({ name: { type: "string" }, strong: { type: "string" }, source: { type: "string" } }),
  },
  questions: {
    type: "array",
    items: obj({ ask: { type: "string" }, why: { type: "string" } }),
  },
});

export async function createInterview({ company, position, posting }, count = 5) {
  if (!hasKey()) return mockCreate({ company, position, posting }, count);

  let found = { brief: "", sources: [] };
  try {
    found = await research({ company, position, posting });
  } catch (err) {
    // Research is a bonus: if search fails or is slow, build from the posting alone.
    console.error("Research failed:", err.message);
  }

  const plan = await askJson({
    effort: "medium",
    maxTokens: 6000,
    system:
      "You design realistic spoken mock interviews and the rubric used to grade them. Questions are " +
      "read aloud by a voice to a candidate on their phone, so write them the way a friendly, sharp " +
      "hiring manager talks: one question at a time, one or two sentences, no lists, no parentheses, " +
      "no markdown.",
    prompt:
      `Company: ${company}\nPosition: ${position}\n\n<job_description>\n${posting}\n</job_description>\n\n` +
      (found.brief ? `<company_research>\n${found.brief}\n</company_research>\n\n` : "") +
      "Every candidate is already graded on this baseline rubric:\n" +
      BASELINE.map((c) => `- ${c.name}: ${c.strong}`).join("\n") +
      "\n\nTasks:\n" +
      "1. rubric: write 4 role-specific criteria for THIS company and position that the baseline does " +
      "not already cover, such as key skills, domain knowledge, or company values. name = 2-4 words; " +
      "strong = one sentence on what a strong answer shows; source = where it comes from, in a few " +
      "words (for example 'Job description' or 'Company value: Customer Obsession').\n" +
      `2. questions: exactly ${count} interview questions. Ground each in something specific from the ` +
      "job description or research and mention it so the candidate can tell. Start with a warm-up " +
      "about why this role and company, include at least one behavioral question (tell me about a " +
      "time...) and one practical or technical question, cover every role criterion at least once, " +
      "and end with the hardest one. why = the name of the rubric criterion it mainly tests.\n" +
      "3. context: 2-4 sentences summarizing the role, company and what matters most, for the " +
      "interviewer to use later.\n" +
      "4. prep: a short prep sheet the candidate reads right before starting, written to them as " +
      "'you'. about = 2 sentences on the company and what this role does there. looks_for = 4 short " +
      "bullets on what this position and company look for. prepare = 3-4 concrete things to get " +
      "ready before this mock interview, like specific stories to have in mind. tips = 3 tips on " +
      "how this company interviews and how to come across well. Base it on the job description and " +
      "research, be specific to this company, and keep every bullet under 25 words. Don't reveal " +
      "the questions.",
    schema: PLAN_SCHEMA,
  });

  return {
    role: position,
    company,
    context: plan.context,
    prep: plan.prep,
    research: found.brief,
    sources: found.sources,
    rubric: plan.rubric.slice(0, 5),
    questions: plan.questions.slice(0, count),
  };
}

// ---------- 2. After each answer: probe once, or move on ----------

const TURN_SCHEMA = obj({
  action: { type: "string", enum: ["followup", "next"] },
  say: { type: "string" },
});

export async function nextTurn({ plan, index, exchanges, canFollowUp, isLast }) {
  if (!hasKey()) return mockTurn({ exchanges, canFollowUp, isLast });
  const q = plan.questions[index];
  const crit = [...(plan.rubric || []), ...BASELINE].find((c) => c.name === q.why);
  const convo = exchanges.map((e) => `Interviewer: ${e.q}\nCandidate: ${e.a || "(no answer)"}`).join("\n\n");
  return askJson({
    effort: "low",
    maxTokens: 2000,
    system:
      "You are a friendly but probing hiring manager running a spoken mock interview. Everything " +
      "you write is read aloud, so write short natural speech: no lists, no markdown, no emojis.",
    prompt:
      `Role: ${plan.role}${plan.company ? ` at ${plan.company}` : ""}\nContext: ${plan.context}\n` +
      `This question tests: ${q.why}${crit ? ` (strong answers: ${crit.strong})` : ""}\n\n${convo}\n\n` +
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

// ---------- 3. Scorecard, graded against baseline + role rubric ----------

const CRITERION = obj({ score: { type: "integer" }, evidence: { type: "string" }, comment: { type: "string" } });
const SCORE_SCHEMA = obj({
  headline: { type: "string" },
  summary: { type: "string" },
  baseline: { type: "array", items: CRITERION },
  role: { type: "array", items: CRITERION },
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
  const rubric = plan.rubric || [];
  const body = transcript
    .map((t, i) => {
      const lines = t.exchanges.map((e) => `Interviewer: ${e.q}\n${name || "Candidate"}: ${e.a || "(no answer)"}`);
      return `### Question ${i + 1} (tests: ${plan.questions[i]?.why || "general"})\n${lines.join("\n")}`;
    })
    .join("\n\n");
  const list = (cs) => cs.map((c, i) => `${i + 1}. ${c.name}: ${c.strong}`).join("\n");

  const card = await askJson({
    effort: "medium",
    maxTokens: 10000,
    system:
      "You are an experienced hiring manager grading a mock interview against a rubric. Be honest " +
      "and specific, and encouraging in tone. Answers were transcribed from speech, so ignore filler " +
      "words and transcription errors, and judge substance. Grade only on what the candidate said.",
    prompt:
      `Role: ${plan.role}${plan.company ? ` at ${plan.company}` : ""}\nContext: ${plan.context}\n\n` +
      `Baseline rubric:\n${list(BASELINE)}\n\nRole rubric:\n${list(rubric)}\n\n` +
      `Transcript:\n\n${body}\n\n` +
      "Score every criterion 1-5 (1 = no evidence, 3 = adequate, 5 = would clearly advance). " +
      `baseline must have exactly ${BASELINE.length} entries and role exactly ${rubric.length}, in ` +
      "rubric order. For each: evidence = the candidate's most relevant words copied word for word " +
      "from the transcript (empty string if none); comment = one sentence explaining the score.\n" +
      `questions must have exactly ${transcript.length} entries, in order: score 1-5; quote = the ` +
      "single most telling sentence or phrase the candidate said, copied word for word (empty string " +
      "if no answer); strength = one sentence on what worked; improve = one specific, actionable " +
      "sentence on what would make the answer stronger.\n" +
      "headline = a short verdict of a few words. summary = 2-3 sentences. next_steps = 3 concrete " +
      "things to practice before the real interview, tied to the weakest criteria.",
    schema: SCORE_SCHEMA,
  });

  // Quotes must really be theirs: if the model paraphrased, fall back to their own words.
  const said = transcript.flatMap((t) => t.exchanges.map((e) => e.a || "")).join(" ");
  const fix = (quote, source) => (quote && !norm(source).includes(norm(quote)) ? firstSentence(source) : quote);
  const pad = (arr, n) => Array.from({ length: n }, (_, i) => arr[i] || { score: 1, evidence: "", comment: "" });

  card.baseline = pad(card.baseline, BASELINE.length).map((c) => ({ ...c, score: clamp(c.score), evidence: fix(c.evidence, said) }));
  card.role = pad(card.role, rubric.length).map((c) => ({ ...c, score: clamp(c.score), evidence: fix(c.evidence, said) }));
  card.questions = transcript.map((t, i) => {
    const q = card.questions[i] || { score: 1, quote: "", strength: "", improve: "" };
    return { ...q, score: clamp(q.score), quote: fix(q.quote, t.exchanges.map((e) => e.a || "").join(" ")) };
  });
  card.overall = overallScore(card.baseline, card.role);
  return card;
}

const clamp = (n) => Math.min(5, Math.max(1, Math.round(n || 1)));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function firstSentence(s) {
  const m = s.trim().match(/^.{1,200}?[.!?](\s|$)/);
  return (m ? m[0] : s.trim().slice(0, 200)).trim();
}
