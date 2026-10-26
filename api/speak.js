import { readJson, send } from "../lib/http.js";
import { interviewer } from "../lib/interviewers.js";

// Natural interviewer voice. Uses OpenAI if OPENAI_API_KEY is set, else ElevenLabs if
// ELEVENLABS_API_KEY is set. With neither, returns 501 and the page falls back to the
// browser's built-in voice.
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

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const provider = process.env.OPENAI_API_KEY ? openai : process.env.ELEVENLABS_API_KEY ? elevenlabs : null;
  if (!provider) return send(res, 501, { error: "No voice provider configured" });
  try {
    const { text, voice } = await readJson(req);
    const input = String(text || "").trim().slice(0, 600);
    if (!input) return send(res, 400, { error: "No text" });
    const r = await provider(input, interviewer(voice));
    if (!r.ok) {
      console.error("TTS error", r.status, await r.text());
      return send(res, 502, { error: "Voice service error" });
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    console.error(err);
    send(res, 500, { error: "Voice failed" });
  }
}
