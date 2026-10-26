import { decodePlan, post } from "/share.js";

const $ = (id) => document.getElementById(id);
const show = (id) => ["welcome", "interview", "done"].forEach((s) => $(s).classList.toggle("hidden", s !== id));

let plan;
const transcript = []; // [{ exchanges: [{ q, a }] }] per question

// ---------- Speech output ----------
let voice;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith("en"));
  const pref = ["Samantha", "Google US English", "Microsoft Aria", "Karen", "Daniel", "Alex"];
  voice = pref.map((n) => vs.find((v) => v.name.includes(n))).find(Boolean) || vs.find((v) => v.default) || vs[0];
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.02;
    // Some browsers never fire onend; don't hang the interview on it.
    const timer = setTimeout(resolve, 2000 + text.length * 90);
    u.onend = u.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

// ---------- Speech input ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let typing = !Recognition;
let rec, recording = false, committed = "", live = "";

function render() {
  $("answer").textContent = (committed + " " + live).trim();
  $("answer").scrollTop = 1e6;
}

function startRecording() {
  committed = "";
  live = "";
  render();
  recording = true;
  $("mic").classList.add("recording");
  $("mic").textContent = "■";
  $("status").textContent = "Listening. Tap when you're done.";
  listen();
}

function listen() {
  rec = new Recognition();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    live = Array.from(e.results, (r) => r[0].transcript).join(" ");
    render();
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      recording = false;
      setTyping(true);
      $("status").textContent = "Microphone access was blocked, so type your answer instead.";
    }
  };
  // Mobile browsers stop listening after a pause; keep going until the user taps done.
  rec.onend = () => {
    committed = (committed + " " + live).trim();
    live = "";
    if (recording) {
      try { listen(); } catch { /* ignore */ }
    }
  };
  rec.start();
}

function stopRecording() {
  return new Promise((resolve) => {
    recording = false;
    $("mic").classList.remove("recording");
    $("mic").textContent = "🎤";
    if (!rec) return resolve((committed + " " + live).trim());
    const r = rec;
    const finish = () => resolve((committed + " " + live).trim());
    r.onend = () => {
      committed = (committed + " " + live).trim();
      live = "";
      finish();
    };
    setTimeout(finish, 1500);
    r.stop();
  });
}

function setTyping(on) {
  typing = on;
  $("typed").classList.toggle("hidden", !on);
  $("submit-typed").classList.toggle("hidden", !on);
  $("mic").classList.toggle("hidden", on);
  $("answer").classList.toggle("hidden", on);
  $("toggle-type").textContent = on ? "Answer by voice" : "Type instead";
  $("toggle-type").classList.toggle("hidden", !Recognition);
}

// ---------- Interview flow ----------
let qIndex = 0;
let current; // { q } waiting for an answer
let answerResolve;

function waitForAnswer() {
  return new Promise((resolve) => (answerResolve = resolve));
}

function setBusy(msg) {
  $("status").innerHTML = msg ? `${msg}<span class="dots"></span>` : "";
  $("mic").disabled = Boolean(msg);
  $("submit-typed").disabled = Boolean(msg);
}

async function ask(text, label) {
  current = text;
  $("q-text").textContent = text;
  $("q-label").textContent = label;
  $("answer").textContent = "";
  $("typed").value = "";
  setBusy("Interviewer speaking");
  await speak(text);
  setBusy("");
  $("status").textContent = typing ? "Type your answer, then submit." : "Tap the mic to answer.";
  return waitForAnswer();
}

function renderProgress() {
  $("progress").innerHTML = plan.questions.map((_, i) => `<span class="${i < qIndex ? "done" : ""}"></span>`).join("");
}

async function run() {
  show("interview");
  setTyping(typing);
  const name = $("name").value.trim();
  await speak(`Hi${name ? " " + name : ""}, thanks for coming in. Let's get started.`);
  for (qIndex = 0; qIndex < plan.questions.length; qIndex++) {
    renderProgress();
    const label = `Question ${qIndex + 1} of ${plan.questions.length}`;
    const entry = { exchanges: [] };
    transcript.push(entry);
    let q = plan.questions[qIndex].ask;
    let isFollowUp = false;
    while (true) {
      const a = await ask(q, isFollowUp ? `${label} · follow-up` : label);
      entry.exchanges.push({ q, a });
      setBusy("Thinking");
      let t;
      try {
        t = await post("/api/turn", { plan, index: qIndex, exchanges: entry.exchanges });
      } catch {
        t = { action: "next", say: "Thanks." };
      }
      setBusy("");
      if (t.action === "followup" && t.say) {
        q = t.say;
        isFollowUp = true;
        continue;
      }
      if (t.say) {
        $("q-text").textContent = t.say;
        setBusy("Interviewer speaking");
        await speak(t.say);
      }
      break;
    }
  }
  qIndex = plan.questions.length;
  renderProgress();
  speak("That's the end of the interview. I'm putting together your scorecard now.");
  finish();
}

async function finish() {
  show("done");
  $("retry").classList.add("hidden");
  $("d-err").textContent = "";
  $("d-title").innerHTML = 'Scoring your answers<span class="dots"></span>';
  try {
    const r = await post("/api/finish", { plan, transcript, name: $("name").value.trim(), email: $("email").value.trim() });
    $("d-title").textContent = `You scored ${r.card.overall}/10`;
    $("d-mail").textContent = r.mail.sent
      ? `We emailed this scorecard to ${$("email").value.trim()}.`
      : `We couldn't email it (${r.mail.reason}). Screenshot it below to keep it.`;
    const f = $("scorecard");
    f.srcdoc = r.html;
    f.classList.remove("hidden");
    f.onload = () => (f.style.height = f.contentDocument.body.scrollHeight + 40 + "px");
  } catch (e) {
    $("d-title").textContent = "Scoring hit a snag";
    $("d-err").textContent = e.message;
    $("retry").classList.remove("hidden");
  }
}

// ---------- Wire up ----------
$("mic").onclick = async () => {
  if (!recording) {
    speechSynthesis?.cancel();
    try {
      startRecording();
    } catch {
      setTyping(true);
    }
    return;
  }
  setBusy("Wrapping up your answer");
  const a = await stopRecording();
  answerResolve?.(a);
};
$("submit-typed").onclick = () => {
  const a = $("typed").value.trim();
  if (!a) return;
  answerResolve?.(a);
};
$("toggle-type").onclick = async () => {
  if (recording) {
    const partial = await stopRecording();
    $("typed").value = partial;
  }
  setTyping(!typing);
  $("status").textContent = typing ? "Type your answer, then submit." : "Tap the mic to answer.";
};
$("repeat").onclick = () => {
  if (!recording && current) speak(current);
};
$("retry").onclick = finish;

$("start").onclick = () => {
  const email = $("email").value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $("w-err").textContent = "That email doesn't look right.";
    return;
  }
  $("w-err").textContent = "";
  // Unlock speech on iOS: it must start inside a tap.
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  run();
};

async function load() {
  try {
    const id = new URLSearchParams(location.search).get("id");
    if (id) {
      const r = await fetch(`/api/plan?id=${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      plan = data;
    } else {
      plan = decodePlan(location.hash.slice(1));
    }
    if (!plan?.questions?.length) throw new Error("This link is missing its interview.");
  } catch (e) {
    $("w-title").textContent = "This link doesn't work";
    $("w-sub").textContent = e.message || "Ask whoever sent it for a fresh link.";
    return;
  }
  document.title = `Mock interview: ${plan.role}`;
  $("w-title").textContent = plan.role + (plan.company ? ` at ${plan.company}` : "");
  $("w-sub").textContent = `${plan.questions.length} questions, about ${plan.questions.length * 2} minutes.`;
  $("start").disabled = false;
  if (!Recognition)
    $("w-note").textContent = "This browser can't transcribe speech, so you'll type your answers. For voice, use Safari on iPhone or Chrome on Android.";
}
load();
