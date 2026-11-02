import Anthropic from "@anthropic-ai/sdk";
import { mockCreate, mockTurn, mockScore } from "./mock.js";
import { BASELINE, overallScore } from "./rubric.js";
import { hasGemini, geminiJson, geminiResearch } from "./gemini.js";
import { bad } from "./http.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
// Claude when its key is set, else Google Gemini's free tier, else demo mode.
const provider = () => (process.env.ANTHROPIC_API_KEY ? "claude" : hasGemini() ? "gemini" : null);
const hasKey = () => Boolean(provider());
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

// Free-tier failures, in words the person can act on.
function friendly(err) {
  if (provider() !== "gemini" || err.expose) return err;
  console.error("Gemini failed:", err);
  return err.status === 429
    ? bad("Google's free AI has hit its limit for now. Please try again in a few minutes.", 429)
    : bad("Google's free AI is busy right now. Please try again in a minute.", 503);
}

// One structured call: the model must return JSON matching `schema`.
async function askJson(args) {
  try {
    return await askJsonOnce(args);
  } catch (err) {
    throw friendly(err);
  }
}

async function askJsonOnce({ system, prompt, schema, effort = "low", maxTokens = 4000, ms }) {
  if (provider() === "gemini") return geminiJson({ system, prompt, schema, maxTokens, ...(ms ? { ms, liteMs: Math.round(ms / 2) } : {}) });
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
        "Search the web thoroughly and gather everything useful for preparing this candidate:\n" +
        "- Company: what it does, main products or services by name, size, leadership, business model\n" +
        "- Mission and values: the mission statement and value or principle names, word for word\n" +
        "- Interview process: the stages for this or similar roles there (screens, assessments, " +
        "panels, case or technical rounds), format and length, and what interviewers probe\n" +
        "- Reported questions: real questions candidates report being asked there for this or similar roles\n" +
        "- The role: the team, tools, technologies, metrics and skills it uses there\n" +
        "- Recent news: dated, concrete items from the last two years\n" +
        "Prefer the company's own careers pages and engineering or company blog, then reputable " +
        "sources such as Glassdoor, Levels.fyi, news coverage, or candidate write-ups. Then write " +
        "a research brief of at most 600 words, organized under those six headings as short " +
        "bullet points. Every bullet must be specific to this company; drop anything that would be " +
        "true of any company. Never invent numbers, names or quotes. Say plainly when something " +
        "could not be found. No preamble.",
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
  prep: obj({
    about: { type: "string" },
    looks_for: strings,
    process: strings,
    know: strings,
    prepare: strings,
    ask_them: strings,
    tips: strings,
  }),
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
    found = await (provider() === "claude" ? research : geminiResearch)({ company, position, posting });
  } catch (err) {
    // Research is a bonus: if search fails or is slow, build from the posting alone.
    console.error("Research failed:", err.message);
  }

  const plan = await askJson({
    effort: "medium",
    maxTokens: 8000,
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
      "job description or research (a product, team, tool, value, requirement or news item) and name it " +
      "so the candidate can tell. Start with a warm-up " +
      "about why this role and company, include at least one behavioral question (tell me about a " +
      "time...) and one practical or technical question, cover every role criterion at least once, " +
      "and end with the hardest one. Where the research lists questions candidates report being " +
      "asked there, use or adapt them. why = the name of the rubric criterion it mainly tests.\n" +
      "3. context: 2-4 sentences summarizing the role, company and what matters most, for the " +
      "interviewer to use later.\n" +
      "4. prep: the candidate's prep sheet, read right before the interview and written to them as " +
      `'you'. This matters most. It must be so specific to ${company} and this ${position} role that ` +
      "it would be useless for any other company. Rules for every bullet:\n" +
      "- Name concrete things from the research and posting: products, teams, tools, technologies, " +
      "metrics, customers, competitors, value names in quotes, interview stage names, dated news.\n" +
      "- Start with a short lead of 2-6 words, then a colon, then the detail (at most 35 words in all). " +
      "Example: 'Customer Obsession: they open most interviews by asking how you put a customer first, " +
      "so have a story where you changed a plan because of user feedback.'\n" +
      "- No generic advice (use the STAR method, research the company, be yourself, show enthusiasm, " +
      "dress well) unless it is tied to a specific detail of this company or role.\n" +
      "- Never invent facts. When the research doesn't confirm something, base it on the job " +
      "description, and say 'typically' or 'often' for anything you are inferring.\n" +
      `Fields: about = 2-3 sentences on what ${company} does (name its products and scale) and what ` +
      "this role does there and why it matters. looks_for = 5 bullets on the specific skills, values " +
      "and traits they screen for in this role, each tied to evidence (a value name, a line from the " +
      `posting, or a reported interview focus). process = 3-5 bullets, the interview stages in order for ` +
      `this role at ${company} as reported, with format and what each stage tests; if it wasn't found, ` +
      "describe the typical process for this kind of role at a company like this and start the first " +
      "bullet with 'Typically'. know = 5 facts worth mentioning in the interview: products, numbers, " +
      "dated recent news, strategy, competitors. prepare = 4 bullets on the specific stories to have " +
      "ready, each mapped to a named value or a requirement from the posting, plus any tool or concept " +
      "to brush up on, by name. ask_them = 3 sharp questions for the candidate to ask the interviewer " +
      "that show research, each referencing something specific. tips = 3 tips on how this company " +
      "interviews and how to come across well there. Don't reveal the questions.",
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
    ms: 30_000,
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

// turns: the whole conversation in order, [{ who: "interviewer" | "candidate", text, q }],
// where q is the planned question being discussed when known.
export function renderTranscript(plan, turns, name) {
  let cur = -1;
  const lines = [];
  for (const t of turns) {
    if (Number.isInteger(t.q) && t.q !== cur && plan.questions[t.q]) {
      cur = t.q;
      lines.push(`\n### Planned question ${cur + 1} (tests: ${plan.questions[cur].why})`);
    }
    lines.push(`${t.who === "candidate" ? name || "Candidate" : "Interviewer"}: ${t.text}`);
  }
  return lines.join("\n").trim();
}

export async function scoreInterview({ plan, turns, name }) {
  if (!hasKey()) return mockScore({ plan, turns });
  const rubric = plan.rubric || [];
  const n = plan.questions.length;
  const list = (cs) => cs.map((c, i) => `${i + 1}. ${c.name}: ${c.strong}`).join("\n");

  const card = await askJson({
    effort: "medium",
    maxTokens: 12000,
    ms: 70_000,
    system:
      "You are an experienced hiring manager grading a mock interview against a rubric. Be honest " +
      "and specific, and encouraging in tone. Answers were transcribed from live speech, so ignore " +
      "filler words and transcription errors, and judge substance. Grade only on what the candidate said.",
    prompt:
      `Role: ${plan.role} at ${plan.company}\nContext: ${plan.context}\n\n` +
      `Baseline rubric:\n${list(BASELINE)}\n\nRole rubric:\n${list(rubric)}\n\n` +
      `Planned questions (the interviewer may have reworded them):\n` +
      plan.questions.map((x, i) => `${i + 1}. ${x.ask}`).join("\n") +
      `\n\nTranscript of the live conversation:\n\n${renderTranscript(plan, turns, name)}\n\n` +
      "Score every criterion 1-5 (1 = no evidence, 3 = adequate, 5 = would clearly advance). " +
      `baseline must have exactly ${BASELINE.length} entries and role exactly ${rubric.length}, in ` +
      "rubric order. For each: evidence = the candidate's most relevant words copied word for word " +
      "from the transcript (empty string if none); comment = one sentence explaining the score.\n" +
      `questions must have exactly ${n} entries, one per planned question in order, covering the ` +
      "candidate's answer to it and any follow-ups: score 1-5 (1 if it was never answered); quote = " +
      "the single most telling sentence or phrase the candidate said, copied word for word (empty " +
      "string if not answered); strength = one sentence on what worked; improve = one specific, " +
      "actionable sentence on what would make the answer stronger.\n" +
      "headline = a short verdict of a few words. summary = 2-3 sentences. next_steps = 3 concrete " +
      "things to practice before the real interview, tied to the weakest criteria.",
    schema: SCORE_SCHEMA,
  });

  // Quotes must really be theirs: if the model paraphrased, fall back to their own words.
  const said = turns.filter((t) => t.who === "candidate").map((t) => t.text).join(" ");
  const fix = (quote) => (quote && !norm(said).includes(norm(quote)) ? "" : quote);
  const pad = (arr, len, blank) => Array.from({ length: len }, (_, i) => arr[i] || { ...blank });

  card.baseline = pad(card.baseline, BASELINE.length, { score: 1, evidence: "", comment: "" }).map((c) => ({ ...c, score: clamp(c.score), evidence: fix(c.evidence) }));
  card.role = pad(card.role, rubric.length, { score: 1, evidence: "", comment: "" }).map((c) => ({ ...c, score: clamp(c.score), evidence: fix(c.evidence) }));
  card.questions = pad(card.questions, n, { score: 1, quote: "", strength: "", improve: "" }).map((x) => ({ ...x, score: clamp(x.score), quote: fix(x.quote) }));
  card.overall = overallScore(card.baseline, card.role);
  return card;
}

const clamp = (n) => Math.min(5, Math.max(1, Math.round(n || 1)));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
