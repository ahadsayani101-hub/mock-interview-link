import { readJson, send, limit } from "../lib/http.js";
import { interviewer } from "../lib/interviewers.js";
import { geminiSpeech } from "../lib/gemini.js";

// Natural interviewer voice. Uses OpenAI if OPENAI_API_KEY is set, else ElevenLabs if
// ELEVENLABS_API_KEY is set, else Google Gemini (free tier) if GEMINI_API_KEY is set. With none,
// returns 501 and the page falls back to the browser's built-in voice.
const STYLE =
  "You are a warm, upbeat hiring manager talking with a candidate in a real conversation. " +
  "Relaxed, natural pace with small pauses, friendly and genuinely curious. Not an announcer.";

async function openai(text, who) {
  return fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.TTS_VOICE || who.voice,
      input: text,
      instructions: STYLE,
      response_format: "mp3",
    }),
  });
}

async function elevenlabs(text) {
  const voice = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5" }),
  });
}

// Returns { type, body } or throws; a thrown error with status 429 means out of quota.
async function mp3(r) {
  if (r.ok) return { type: "audio/mpeg", body: Buffer.from(await r.arrayBuffer()) };
  console.error("TTS error", r.status, await r.text());
  throw Object.assign(new Error("Voice service error"), { status: r.status });
}

async function gemini(text, who, voiceId) {
  return { type: "audio/wav", body: await geminiSpeech(text, voiceId) };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const provider = process.env.OPENAI_API_KEY
    ? async (t, who) => mp3(await openai(t, who))
    : process.env.ELEVENLABS_API_KEY
      ? async (t) => mp3(await elevenlabs(t))
      : process.env.GEMINI_API_KEY
        ? gemini
        : null;
  if (!provider) return send(res, 501, { error: "No voice provider configured" });
  try {
    await limit(req, "speak", { perHour: 600, perDay: 6000 });
    const { text, voice } = await readJson(req);
    const input = String(text || "").trim().slice(0, 600);
    if (!input) return send(res, 400, { error: "No text" });
    let audio;
    try {
      audio = await provider(input, interviewer(voice), voice);
    } catch (err) {
      console.error("TTS failed:", err.message);
      // 429 tells the page to stop asking and use the phone's voice for the rest of the call.
      return send(res, err.status === 429 ? 429 : 502, { error: "Voice service unavailable" });
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", audio.type);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(audio.body);
  } catch (err) {
    console.error(err);
    send(res, err.expose ? err.status : 500, { error: err.expose ? err.message : "Voice failed" });
  }
}
