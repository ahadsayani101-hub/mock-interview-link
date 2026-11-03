import { send, limit } from "../lib/http.js";
import { hasGemini, geminiTranscribe } from "../lib/gemini.js";

// Writes down a spoken answer for phones that have no built-in speech recognition (an iPhone
// app on the home screen, Firefox). The page posts a short WAV recording and gets back
// { text }. Without GEMINI_API_KEY this returns 501 and the page asks the person to type.
const MAX_BYTES = 4_400_000; // Vercel accepts request bodies up to 4.5 MB (about 2 minutes here)

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!hasGemini()) return send(res, 501, { error: "Voice answers need a Gemini key on the server" });
  try {
    await limit(req, "listen", { perHour: 300, perDay: 3000 });
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BYTES) return send(res, 413, { error: "That answer was too long to send. Try a shorter one." });
      chunks.push(chunk);
    }
    const wav = Buffer.concat(chunks);
    if (wav.length < 1000 || wav.subarray(0, 4).toString() !== "RIFF") return send(res, 400, { error: "No recording received" });
    let text;
    try {
      text = await geminiTranscribe(wav);
    } catch (err) {
      console.error("Transcription failed:", err.message);
      // 429: out of free quota, so the page switches to typing for the rest of the call.
      return send(res, err.status === 429 ? 429 : 502, { error: "Couldn't write down that answer" });
    }
    send(res, 200, { text });
  } catch (err) {
    console.error(err);
    send(res, err.expose ? err.status : 500, { error: err.expose ? err.message : "Listening failed" });
  }
}
