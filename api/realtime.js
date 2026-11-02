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
  return `# Role and objective
You are ${who.name}, a hiring manager at ${plan.company}, running a live mock interview over a video call with ${candidate} for the ${plan.position || plan.role} role. Your goal is an interview that feels exactly like the real thing, so they get honest practice. It should take about ${plan.questions.length * 2} minutes.

# Personality and tone
## Personality
You're ${who.style}. You genuinely like meeting people and you're curious about their stories.
## Tone
Warm, relaxed and conversational, like a real person on a call, never like an assistant or a narrator. Use contractions. Now and then use a small natural word like "so", "okay", "right" or "mm, got it", but not in every turn.
## Length
Usually one or two sentences per turn, never more than three. Ask one thing at a time.
## Pacing
Speak at a natural, easy pace with small pauses, like you're thinking as you talk. Don't sound rushed and don't sound scripted.
## Language
English only. Do not include sound effects, laughter written out, or any formatting.
## Variety
Do not repeat the same sentence or reaction twice. Vary how you acknowledge answers, how you transition, and how you start questions. The sample phrases below are inspiration only; DO NOT ALWAYS USE THEM.

# How to react
- Show you listened: pick up a specific detail from what they just said before moving on. For example: "Oh nice, so you basically owned the whole backend?" or "Huh, that's a tight deadline. How did the team take it?"
- Short acknowledgements between questions sound natural: "Okay, that makes sense." "Got it." "Mm, interesting." Vary them.
- Never give feedback, scores, praise like "great answer", or coaching during the interview. It's an interview, not a lesson.

# Unclear audio
Only respond to clear speech. If the audio is unclear, cut off, or just noise, say something short like "Sorry, you cut out for a second there. Could you say that again?"

# Conversation flow
1. Greeting: greet ${candidate} by name, say who you are in one sentence, and make one light line of small talk. Then wait for their reply.
2. Questions: go through the questions below in order. Right before asking each one, call set_question with its index. Say each question in your own natural words, but keep its substance and any specifics from the job.
3. After each answer: if it's vague, generic, or missing a concrete example, their own part in it, or the result, ask one or two pointed follow-ups about what they said. If it's solid, acknowledge it briefly and move on. Never more than two follow-ups per question.
4. If they ask you to repeat or clarify, do it. If they drift, steer back kindly. If they're stuck, give them a moment, then offer to come back to it.
5. Their questions: after the last question, ask if they have any questions for you. Answer briefly and honestly from the notes below, and say you're not sure if you don't know.
6. Wrap up: thank them, tell them their scorecard is on its way to their email, say a warm goodbye, then call end_interview.

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

  const session = {
    type: "realtime",
    model: MODEL,
    instructions: instructions(plan, name),
    tools: TOOLS,
    tool_choice: "auto",
    // Light reasoning keeps replies quick, so turn-taking feels like a real call.
    reasoning: { effort: process.env.REALTIME_EFFORT || "low" },
    audio: {
      input: {
        noise_reduction: { type: "near_field" }, // a phone held close to the face
        transcription: { model: process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe", language: "en" },
        // Low eagerness: let the candidate pause to think without being cut off.
        turn_detection: { type: "semantic_vad", eagerness: "low" },
      },
      output: { voice: interviewer(plan.interviewer).voice },
    },
  };
  const mint = (body) =>
    fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session: body }),
    });
  let r = await mint(session);
  if (r.status === 400) {
    // If a newer setting is rejected, fall back to the plain session rather than failing.
    console.error("Realtime session rejected, retrying with basic settings:", await r.text());
    const { reasoning, ...rest } = session;
    const { noise_reduction, ...input } = session.audio.input;
    r = await mint({ ...rest, audio: { ...session.audio, input } });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.value) {
    console.error("Realtime session error", r.status, JSON.stringify(data));
    throw new Error("Couldn't start the live interview.");
  }
  return { value: data.value };
}, { name: "realtime", perHour: 30, perDay: 300 });
