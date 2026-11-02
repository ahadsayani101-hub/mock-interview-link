// Google Gemini on the free tier: the no-cost alternative to Claude for writing the interview,
// follow-ups and grading, plus a natural text-to-speech voice. Get a key (no card needed) at
// https://aistudio.google.com/apikey and set GEMINI_API_KEY.
import { webResearch } from "./web.js";

const BASE = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";
const TTS_MODEL = () => process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
export const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

const headers = () => ({ "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class GeminiError extends Error {
  constructor(status, body) {
    super(`Gemini ${status}: ${String(body).slice(0, 300)}`);
    this.status = status;
    this.body = String(body);
  }
}

async function call(path, body, ms) {
  const r = await fetch(`${BASE()}/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  const text = await r.text();
  if (!r.ok) throw new GeminiError(r.status, text);
  return JSON.parse(text);
}

// Free-tier keys allow only a few requests a minute; wait and retry when Google says slow down.
// An overloaded model (503) gets one quick retry, then the caller moves to the lighter model.
async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const again = err.status === 429 ? i < 2 : err.status === 503 ? i < 1 : false;
      if (!again) throw err;
      await wait(err.status === 429 ? 4000 * (i + 1) : 2000);
    }
  }
}

const answerText = (res) => {
  const parts = res.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
};

const unfence = (s) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

const LITE = () => process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
const slow = (err) => err?.name === "TimeoutError" || err?.name === "AbortError" || err?.status >= 500;
const withSchemaText = (prompt, schema) =>
  `${prompt}\n\nReply with only a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`;

// One generateContent call with fallbacks, so a slow or busy free tier still gives an answer:
// 1. the main model, thinking briefly (fast), with the JSON schema enforced;
// 2. if Google rejects those settings (400), the same model without them;
// 3. if it's too slow or overloaded, the lighter, much faster model.
async function generate({ system, prompt, schema, maxTokens, ms, liteMs }) {
  const req = (model, config, text, timeout) =>
    withRetry(() =>
      call(`models/${model}:generateContent`, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: { maxOutputTokens: maxTokens, ...(schema ? { responseMimeType: "application/json" } : {}), ...config },
      }, timeout)
    );
  const strict = schema ? { responseJsonSchema: schema } : {};
  const started = Date.now();
  let err, schemaOk = true;
  try {
    return await req(MODEL(), { ...strict, thinkingConfig: { thinkingLevel: "low" } }, prompt, ms);
  } catch (e) {
    err = e;
  }
  if (err.status === 400) {
    console.error("Retrying Gemini without schema settings:", err.message);
    schemaOk = false;
    try {
      return await req(MODEL(), {}, schema ? withSchemaText(prompt, schema) : prompt, ms);
    } catch (e) {
      err = e;
    }
  }
  if (!slow(err)) throw err;
  console.error(`Gemini ${MODEL()} failed after ${Math.round((Date.now() - started) / 1000)}s (${err.message}); trying ${LITE()}`);
  return req(LITE(), schemaOk ? strict : {}, schema && !schemaOk ? withSchemaText(prompt, schema) : prompt, liteMs);
}

// Plain text answer.
export async function geminiText({ system, prompt, maxTokens = 8000, ms = 50_000, liteMs = 30_000 }) {
  const res = await generate({ system, prompt, maxTokens, ms, liteMs });
  const text = answerText(res).trim();
  if (!text) throw new Error(`Gemini returned no text (${res.candidates?.[0]?.finishReason || res.promptFeedback?.blockReason || "unknown"})`);
  return text;
}

// One structured call: the answer must be JSON matching `schema`.
export async function geminiJson({ system, prompt, schema, maxTokens = 4000, ms = 100_000, liteMs = 55_000 }) {
  const res = await generate({ system, prompt, schema, maxTokens: Math.max(maxTokens * 3, 16000), ms, liteMs });
  const text = unfence(answerText(res));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned unreadable JSON (${res.candidates?.[0]?.finishReason || "unknown"})`);
  }
}

// ---------- Research: our own web search + reading, then Gemini writes the brief ----------

const host = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

export async function geminiResearch({ company, position, posting }) {
  let web = { results: [], pages: [] };
  try {
    web = await webResearch({ company, position });
  } catch (err) {
    console.error("Web research failed:", err.message);
  }
  let budget = 48_000; // characters of web text to hand the model
  const pages = [];
  for (const p of web.pages) {
    if (budget <= 0) break;
    const text = p.text.slice(0, Math.min(6000, budget));
    budget -= text.length;
    pages.push(`<source url="${p.url}" title="${p.title.replace(/"/g, "'")}">\n${text}\n</source>`);
  }
  const snippets = web.results.filter((r) => r.snippet).map((r) => `- ${r.title} (${host(r.url)}): ${r.snippet}`).join("\n");

  const brief = await geminiText({
    maxTokens: 8000,
    system:
      "You are a meticulous interview-prep researcher. You turn raw web pages into a dense, factual " +
      "brief that helps one candidate prepare for one specific interview. You never pad with generic advice.",
    prompt:
      `Candidate is interviewing for: ${position} at ${company}.\n\n` +
      `<job_description>\n${posting.slice(0, 6000)}\n</job_description>\n\n` +
      (snippets ? `<search_results>\n${snippets}\n</search_results>\n\n` : "") +
      (pages.length ? `<pages>\n${pages.join("\n\n")}\n</pages>\n\n` : "") +
      "Write a research brief of at most 600 words under exactly these headings, as short bullets:\n" +
      "Company: what it does, main products or services by name, size, founding, leadership, business model.\n" +
      "Mission and values: copy their mission statement and value or principle names word for word when available.\n" +
      `Interview process: the stages for a ${position} or similar role at ${company} (screen, assessments, panels, ` +
      "case or technical rounds, final round), format and length, and what interviewers are reported to probe.\n" +
      "Reported questions: real questions candidates report being asked there for this or similar roles.\n" +
      "The role: the team, tools, technologies, metrics and skills this role uses there.\n" +
      "Recent news: dated, concrete items from the last two years (launches, earnings, acquisitions, strategy).\n\n" +
      "Use the sources above first. You may add well-established facts you are confident about from your own " +
      "knowledge; mark those with (general knowledge). Never invent numbers, names, dates or quotes. If " +
      "something can't be found, write 'Not found' under that heading. Every bullet must be specific to " +
      `${company}; drop anything that would be true of any company. No preamble.`,
  });

  const seen = new Set();
  const sources = [...web.pages, ...web.results]
    .filter((s) => s.url && !seen.has(s.url) && seen.add(s.url))
    .slice(0, 8)
    .map((s) => ({ url: s.url, title: s.title || host(s.url) }));
  return { brief, sources };
}

// ---------- Voice: Gemini text-to-speech, returned as a WAV file ----------

const VOICES = { maya: "Aoede", daniel: "Charon" };
const STYLE = "warmly and naturally, like a friendly hiring manager on a relaxed video call, at an easy conversational pace";

function wav(pcm, rate = 24000) {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + pcm.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

// Finds the first base64 audio payload anywhere in a response, with its mime type if given.
function findAudio(node) {
  if (!node || typeof node !== "object") return null;
  const data = node.inlineData?.data || node.inline_data?.data || (typeof node.data === "string" && node.data.length > 200 ? node.data : null);
  if (data) return { data, mime: node.inlineData?.mimeType || node.inline_data?.mime_type || node.mime_type || node.mimeType || "" };
  for (const v of Object.values(node)) {
    const hit = findAudio(v);
    if (hit) return hit;
  }
  return null;
}

function toWav({ data, mime }) {
  const buf = Buffer.from(data, "base64");
  if (buf.subarray(0, 4).toString() === "RIFF") return buf; // already a WAV file
  const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
  return wav(buf, rate);
}

export async function geminiSpeech(text, voiceId) {
  const voice = process.env.GEMINI_TTS_VOICE || VOICES[voiceId] || "Aoede";
  // The documented request for current TTS models, then the older generateContent form.
  const attempts = [
    () =>
      call("interactions", {
        model: TTS_MODEL(),
        input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: STYLE }] }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
      }, 12_000),
    () =>
      call(`models/${TTS_MODEL()}:generateContent`, {
        contents: [{ parts: [{ text: `Say ${STYLE}: ${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }, 12_000),
  ];
  let last;
  for (let i = 0, waited = false; i < attempts.length; i++) {
    try {
      const audio = findAudio(await attempts[i]());
      if (audio) return toWav(audio);
      last = new Error("Gemini returned no audio");
    } catch (err) {
      last = err;
      if (err.status !== 429) continue;
      // Over the free per-minute limit: wait once if Google says it's brief, else give up
      // and let the page use the phone's voice.
      const delay = Number(String(err.body).match(/"retryDelay":\s*"(\d+)/)?.[1] ?? 5);
      if (waited || delay > 8) break;
      waited = true;
      await wait(delay * 1000);
      i--;
    }
  }
  throw last;
}
