// Google Gemini on the free tier: the no-cost alternative to Claude for writing the interview,
// follow-ups and grading, plus a natural text-to-speech voice. Get a key (no card needed) at
// https://aistudio.google.com/apikey and set GEMINI_API_KEY.
import { webResearch } from "./web.js";

const BASE = () => process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const TTS_MODEL = () => process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts";
export const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

const headers = () => ({ "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" });

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

const answerText = (res) => {
  const parts = res.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
};

// ---------- Free quota: spread work across every free model ----------
// Each free model has its own daily and per-minute quota. When one is used up (429), is missing
// for this key (403/404), or is slow or overloaded, the next one in the list takes over. "smart"
// is for writing the interview and grading; "fast" is for the quick follow-up decision during a
// call, so it starts with the lighter models and saves the stronger ones' quota.
const CHAINS = {
  smart: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview", "gemma-4-31b-it", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemma-4-26b-a4b-it"],
  fast: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemma-4-26b-a4b-it", "gemini-3.8-flash", "gemini-3.6-flash", "gemma-4-31b-it"],
  // Writing down a spoken answer: only Gemini models take audio.
  listen: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3-flash-preview"],
};
const chain = (tier) => {
  const list = CHAINS[tier] || CHAINS.smart;
  const pick = process.env.GEMINI_MODEL; // optional override goes first
  return pick ? [pick, ...list.filter((m) => m !== pick)] : list;
};

// Models this server instance has seen run out, and when to try them again.
const resting = new Map();
function rest(model, err) {
  const daily = /PerDay|per day|daily/i.test(err.body || "") || err.status === 403 || err.status === 404;
  resting.set(model, Date.now() + (daily ? 3 * 3600e3 : 60e3));
}
const awake = (models) => {
  const now = Date.now();
  const ok = models.filter((m) => !(resting.get(m) > now));
  return ok.length ? ok : models; // if everything is resting, try them all anyway
};

const slow = (err) => err?.name === "TimeoutError" || err?.name === "AbortError" || err?.status >= 500;
const withSchemaText = (prompt, schema) =>
  `${prompt}\n\nReply with only a JSON object (no other text) that matches this JSON Schema:\n${JSON.stringify(schema)}`;

// One answer from the first free model that can give it. For each model: first with the JSON
// schema enforced and brief thinking (fast); if Google rejects those settings (400), once more
// with plain settings and the schema written into the prompt.
async function generate({ system, prompt, parts = [], schema, maxTokens, ms, firstMs, laterMs, tier }) {
  const deadline = Date.now() + ms;
  const models = awake(chain(tier));
  let last;
  for (const [i, model] of models.entries()) {
    const left = deadline - Date.now();
    if (left < 4000) break;
    const timeout = Math.min(left, i === 0 ? firstMs : laterMs);
    const gemma = model.startsWith("gemma");
    const strict = {
      ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}),
      thinkingConfig: { thinkingLevel: gemma ? "minimal" : "low" },
    };
    for (const [config, text] of [[strict, prompt], [{}, schema ? withSchemaText(prompt, schema) : prompt]]) {
      try {
        const res = await call(`models/${model}:generateContent`, {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [...parts, { text }] }],
          generationConfig: { maxOutputTokens: maxTokens, ...config },
        }, timeout);
        if (i > 0) console.log(`Answered by ${model}`);
        return res;
      } catch (err) {
        last = err;
        if (/API_KEY_INVALID|API key not valid/i.test(err.body || "")) throw err; // no model will work
        if (err.status === 400 && config === strict) continue; // try plain settings on this model
        break;
      }
    }
    console.error(`Gemini ${model} unavailable: ${last.message}`);
    if ([403, 404, 429].includes(last.status)) rest(model, last);
    else if (!slow(last) && last.status !== 400) throw last; // something else is wrong (bad key etc.)
  }
  throw last;
}

// The JSON object in a reply, even if a model wrapped it in a code fence or a sentence.
function parseJson(text) {
  const t = text.trim();
  try {
    return JSON.parse(t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("no JSON object");
  }
}

// One structured call: the answer must be JSON matching `schema`. `ms` is the whole time budget;
// tier "fast" is for quick calls during an interview.
export async function geminiJson({ system, prompt, schema, maxTokens = 4000, ms = 100_000, tier = "smart" }) {
  const res = await generate({
    system, prompt, schema, tier, ms,
    maxTokens: Math.max(maxTokens * 3, 16000),
    firstMs: Math.round(ms * 0.55),
    laterMs: Math.round(ms * 0.3),
  });
  try {
    return parseJson(answerText(res));
  } catch {
    throw new Error(`Gemini returned unreadable JSON (${res.candidates?.[0]?.finishReason || "unknown"})`);
  }
}

// ---------- Listening: write down a spoken answer ----------
// For phones without built-in speech recognition (an iPhone app on the home screen, Firefox):
// the page records the answer as a WAV file and this writes down what was said.
const NOTHING = "[no speech]";
export async function geminiTranscribe(wavBytes) {
  const res = await generate({
    tier: "listen",
    system: "You write down exactly what a job candidate says in a recorded interview answer.",
    parts: [{ inlineData: { mimeType: "audio/wav", data: Buffer.from(wavBytes).toString("base64") } }],
    prompt:
      "Transcribe this answer word for word in English, with normal punctuation. Leave out filler sounds like um and uh. " +
      `Reply with only the words spoken. If nobody speaks, reply with exactly ${NOTHING}`,
    maxTokens: 2000,
    ms: 40_000,
    firstMs: 20_000,
    laterMs: 12_000,
  });
  const text = answerText(res).trim();
  return text.includes(NOTHING) ? "" : text;
}

// ---------- Research: our own web search and reading, no AI call ----------
// The pages and snippets go straight into the call that writes the interview, which also writes
// the research brief, so building an interview costs one AI request instead of two.

const host = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

export async function gatherWeb({ company, position }) {
  let web = { results: [], pages: [] };
  try {
    web = await webResearch({ company, position });
  } catch (err) {
    console.error("Web research failed:", err.message);
  }
  let budget = 30_000; // characters of page text, so it fits every free model's limits
  const pages = [];
  for (const p of web.pages) {
    if (budget <= 0) break;
    const text = p.text.slice(0, Math.min(5000, budget));
    budget -= text.length;
    pages.push(`<source url="${p.url}" title="${p.title.replace(/"/g, "'")}">\n${text}\n</source>`);
  }
  const snippets = web.results.filter((r) => r.snippet).map((r) => `- ${r.title} (${host(r.url)}): ${r.snippet}`).join("\n");
  const material =
    (snippets ? `<search_results>\n${snippets}\n</search_results>\n\n` : "") +
    (pages.length ? `<pages>\n${pages.join("\n\n")}\n</pages>` : "");

  const seen = new Set();
  const sources = [...web.pages, ...web.results]
    .filter((s) => s.url && !seen.has(s.url) && seen.add(s.url))
    .slice(0, 8)
    .map((s) => ({ url: s.url, title: s.title || host(s.url) }));
  return { material: material.trim(), sources };
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
  const models = awake([TTS_MODEL(), "gemini-3.8-flash-lite-tts"].filter((m, i, a) => a.indexOf(m) === i));
  let last;
  for (const model of models) {
    // The documented request for current voice models, then the older generateContent form.
    const attempts = [
      () =>
        call("interactions", {
          model,
          input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: STYLE }] }] }],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice }] },
        }, 12_000),
      () =>
        call(`models/${model}:generateContent`, {
          contents: [{ parts: [{ text: `Say ${STYLE}: ${text}` }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
        }, 12_000),
    ];
    for (const attempt of attempts) {
      try {
        const audio = findAudio(await attempt());
        if (audio) return toWav(audio);
        last = new Error("Gemini returned no audio");
      } catch (err) {
        last = err;
        if (err.status === 429) break; // this voice model is out of free quota: try the next one
      }
    }
    if (last?.status === 429) rest(model, last);
  }
  throw last; // a 429 here tells the page to use the phone's voice
}
