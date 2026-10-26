import { route, bad } from "../lib/http.js";
import { interviewer } from "../lib/interviewers.js";

// Starts a live, hands-free voice interview. Returns a short-lived key the browser uses
// to connect straight to OpenAI's Realtime API over WebRTC. Without OPENAI_API_KEY this
// returns 501 and the page falls back to tap-to-talk.
const MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2.1";

function instructions(plan, name) {
  const who = interviewer(plan.interviewer);
  const candidate = name || "the candidate";
  const questions = plan.questions.map((q, i) => `${i}. ${q.ask} (tests: ${q.why})`).join("\n");
  return `You are ${who.name}, a hiring manager at ${plan.company}. You're running a live mock interview over a video call with ${candidate} for the ${plan.position || plan.role} role. Your manner is ${who.style}.

# How you sound
- Like a real person on a call, not an assistant. Relaxed, natural pace, contractions, the odd "so" or "okay".
- Keep your turns short: usually one to three sentences. Never monologue.
- React to what they actually said ("Oh, interesting, so you rebuilt the whole pipeline?") before moving on. Vary your reactions; don't say "great" every time.
- Ask one thing at a time. Never read out lists, numbers, or formatting.
- Never give feedback, scores, or coaching during the interview. It's an interview, not a lesson.

# Flow
1. Greet ${candidate} by name, introduce yourself in one sentence, and make one line of small talk. Wait for their reply.
2. Then go through the questions below in order. Right before asking each one, call set_question with its index. Put each question in your own natural words but keep its substance and any specifics from the job.
3. After each answer: if it's vague, generic, or missing a concrete example, their own role, or the result, ask one or two pointed follow-ups that dig into what they said. If it's solid, acknowledge it briefly and move on. Never more than two follow-ups per question.
4. If they ask you to repeat or clarify, do it. If they drift off topic, steer back kindly. If they're stuck, give them a moment, and offer to come back to it.
5. After the last question, ask if they have any questions for you. Answer briefly and honestly from the notes below, and say you're not sure if you don't know.
6. Then thank them, tell them their scorecard is on its way to their email, say a warm goodbye, and call end_interview.

# The role
${plan.context}

# Company notes (for answering their questions; don't recite them)
${(plan.research || "No extra notes.").slice(0, 2500)}

# Questions
${questions}`;
}

const TOOLS = [
  {
    type: "function",
    name: "set_question",
    description: "Call right before asking a main interview question, with that question's index.",
    parameters: {
      type: "object",
      properties: { index: { type: "integer", description: "Index of the question from the list" } },
      required: ["index"],
    },
  },
  {
    type: "function",
    name: "end_interview",
    description: "Call once, after saying goodbye, to end the call.",
    parameters: { type: "object", properties: {} },
  },
];

export default route(async ({ plan, name }) => {
  if (!process.env.OPENAI_API_KEY) throw bad("Live voice isn't set up", 501);
  if (!plan?.questions?.length) throw bad("Bad request");
  name = String(name || "").trim().slice(0, 60);

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: MODEL,
        instructions: instructions(plan, name),
        tools: TOOLS,
        tool_choice: "auto",
        audio: {
          input: {
            transcription: { model: process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe", language: "en" },
            // Low eagerness: let the candidate pause to think without being cut off.
            turn_detection: { type: "semantic_vad", eagerness: "low" },
          },
          output: { voice: interviewer(plan.interviewer).voice },
        },
      },
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.value) {
    console.error("Realtime session error", r.status, JSON.stringify(data));
    throw new Error("Couldn't start the live interview.");
  }
  return { value: data.value };
});
