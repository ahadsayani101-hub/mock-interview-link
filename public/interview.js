import { decodePlan, post } from "/share.js";

const $ = (id) => document.getElementById(id);
const show = (id) => ["welcome", "interview", "done"].forEach((s) => ($(s).hidden = s !== id));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLOSING = "That's the end of the interview. Thanks so much. I'm putting together your scorecard now.";

const ICON = {
  mic: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>',
  stop: '<svg class="i" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
  mail: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
};

let plan;
const transcript = []; // [{ exchanges: [{ q, a }] }] per question

// ---------- Speech output ----------
let voice;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith("en"));
  // Prefer the higher-quality voices some devices ship with.
  const pref = ["(Natural)", "(Premium)", "(Enhanced)", "Samantha", "Google US English", "Microsoft Aria", "Karen", "Daniel"];
  voice =
    pref.map((n) => vs.find((v) => v.name.includes(n) && v.lang === "en-US") || vs.find((v) => v.name.includes(n))).find(Boolean) ||
    vs.find((v) => v.default) ||
    vs[0];
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

// Natural voice from the server (/api/speak). If the server has no voice key, fall back to the
// browser's built-in voice for the rest of the session.
let cloudVoice = true;
const player = new Audio();
const audioCache = new Map();

function fetchAudio(text) {
  if (!cloudVoice || !text) return Promise.resolve(null);
  if (!audioCache.has(text)) {
    const p = fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then(async (r) => {
        if (r.status === 501) cloudVoice = false;
        return r.ok ? URL.createObjectURL(await r.blob()) : null;
      })
      .catch(() => null);
    audioCache.set(text, p);
  }
  return audioCache.get(text);
}

// iOS only lets a page play audio after a tap; play a blank clip inside the Start tap.
function unlockAudio() {
  const rate = 8000, n = 800;
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true);
  buf.setUint16(34, 16, true); str(36, "data"); buf.setUint32(40, n * 2, true);
  player.src = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  player.play().catch(() => {});
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}

function playUrl(url) {
  return new Promise((resolve) => {
    let timer;
    const done = (ok) => {
      clearTimeout(timer);
      player.onended = player.onerror = null;
      resolve(ok);
    };
    player.onended = () => done(true);
    player.onerror = () => done(false);
    player.onloadedmetadata = () => {
      if (isFinite(player.duration)) timer = setTimeout(() => done(true), (player.duration + 2) * 1000);
    };
    player.src = url;
    player.play().catch(() => done(false));
  });
}

async function speak(text) {
  const url = await fetchAudio(text);
  if (url && (await playUrl(url))) return;
  return browserSpeak(text);
}

function browserSpeak(text) {
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
  setState("listening");
  $("mic").classList.add("rec");
  $("mic").innerHTML = ICON.stop;
  $("mic-label").textContent = "Done";
  $("status").textContent = "Listening";
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
    // Small pulse on the orb so the speaker can see they're being heard.
    $("orb").classList.add("blip");
    setTimeout(() => $("orb").classList.remove("blip"), 120);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      recording = false;
      resetMic();
      setTyping(true);
      setState("idle");
      $("status").textContent = "Microphone is blocked, so type your answer instead.";
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

function resetMic() {
  $("mic").classList.remove("rec");
  $("mic").innerHTML = ICON.mic;
  $("mic-label").textContent = "Answer";
}

function stopRecording() {
  return new Promise((resolve) => {
    recording = false;
    resetMic();
    if (!rec) return resolve((committed + " " + live).trim());
    const finish = () => resolve((committed + " " + live).trim());
    rec.onend = () => {
      committed = (committed + " " + live).trim();
      live = "";
      finish();
    };
    setTimeout(finish, 1500);
    rec.stop();
  });
}

function setTyping(on) {
  typing = on;
  $("typed").hidden = !on;
  $("submit-typed").hidden = !on;
  $("mic-ctl").style.visibility = on ? "hidden" : "visible";
  $("answer").hidden = on;
  $("toggle-label").textContent = on ? "Voice" : "Type";
  $("toggle-type").parentElement.style.visibility = Recognition ? "visible" : "hidden";
  if (on) setTimeout(() => $("typed").focus(), 50);
}

// ---------- Interview flow ----------
let qIndex = 0;
let current;
let answerResolve;

const setState = (s) => ($("interview").dataset.state = s);

function waitForAnswer() {
  return new Promise((resolve) => (answerResolve = resolve));
}

function lock(locked, status) {
  $("mic").disabled = locked;
  $("submit-typed").disabled = locked;
  $("repeat").disabled = locked;
  $("status").textContent = status || "";
}

async function ask(text, label) {
  current = text;
  $("q-label").textContent = label;
  $("q-text").textContent = text;
  $("answer").textContent = "";
  $("typed").value = "";
  setState("speaking");
  lock(true, "");
  await speak(text);
  setState("idle");
  lock(false, typing ? "Type your answer, then submit" : "Tap the mic when you're ready");
  return waitForAnswer();
}

function renderProgress() {
  const n = plan.questions.length;
  $("progress").innerHTML = plan.questions
    .map((_, i) => `<span class="${i < qIndex ? "done" : i === qIndex ? "now" : ""}"></span>`)
    .join("");
  $("counter").textContent = `${Math.min(qIndex + 1, n)}/${n}`;
}

async function run() {
  show("interview");
  $("mic").innerHTML = ICON.mic;
  setTyping(typing);
  const name = $("name").value.trim();
  qIndex = 0;
  renderProgress();
  $("q-label").textContent = "";
  $("q-text").textContent = `Hi${name ? " " + name : ""}, let's get started.`;
  setState("speaking");
  lock(true);
  const greeting = `Hi${name ? " " + name : ""}, thanks for coming in. Let's get started.`;
  fetchAudio(greeting);
  // Fetch every main question's audio now so there's no pause before each one.
  plan.questions.forEach((q) => fetchAudio(q.ask));
  fetchAudio(CLOSING);
  await speak(greeting);

  for (qIndex = 0; qIndex < plan.questions.length; qIndex++) {
    renderProgress();
    const entry = { exchanges: [] };
    transcript.push(entry);
    let q = plan.questions[qIndex].ask;
    let followUp = false;
    while (true) {
      const a = await ask(q, followUp ? "Follow-up" : plan.questions[qIndex].why);
      entry.exchanges.push({ q, a });
      setState("thinking");
      lock(true, "");
      let t;
      try {
        t = await post("/api/turn", { plan, index: qIndex, exchanges: entry.exchanges });
      } catch {
        t = { action: "next", say: "Thanks." };
      }
      if (t.action === "followup" && t.say) {
        q = t.say;
        followUp = true;
        continue;
      }
      if (t.say) {
        $("q-label").textContent = "";
        $("q-text").textContent = t.say;
        $("answer").textContent = "";
        setState("speaking");
        await speak(t.say);
      }
      break;
    }
  }
  speak(CLOSING);
  finish();
}

// ---------- Results ----------
async function finish() {
  show("done");
  window.scrollTo(0, 0);
  $("d-loading").hidden = false;
  $("d-error").hidden = true;
  $("d-result").hidden = true;
  try {
    const email = $("email").value.trim();
    const r = await post("/api/finish", { plan, transcript, name: $("name").value.trim(), email });
    renderResults(r.card, r.mail, email, r.baseline || []);
  } catch (e) {
    $("d-loading").hidden = true;
    $("d-error").hidden = false;
    $("d-err").textContent = e.message;
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function criteria(list, scores) {
  return list.map((c, i) => {
    const s = scores[i] || {};
    const box = el("div", "crit");
    const head = el("div", "head");
    head.append(el("b", null, c.name), scoreDots(s.score));
    box.append(head);
    if (s.comment) box.append(el("p", "comment", s.comment));
    if (s.evidence) box.append(el("p", "evidence", `“${s.evidence}”`));
    return box;
  });
}

function scoreDots(score = 0) {
  const dots = el("span", "dots");
  dots.setAttribute("aria-label", `${score} out of 5`);
  for (let k = 1; k <= 5; k++) dots.append(el("i", k <= score ? "on" : ""));
  return dots;
}

function renderResults(card, mail, email, baseline) {
  $("d-loading").hidden = true;
  $("d-result").hidden = false;
  $("d-role").textContent = plan.role + (plan.company ? ` · ${plan.company}` : "");
  $("d-headline").textContent = card.headline;
  $("d-summary").textContent = card.summary;

  const arc = $("d-arc");
  const c = 2 * Math.PI * 44;
  arc.style.strokeDasharray = c;
  arc.style.strokeDashoffset = c;
  requestAnimationFrame(() => requestAnimationFrame(() => (arc.style.strokeDashoffset = c * (1 - card.overall / 10))));
  // Count up to the score, ending on the exact value (it can have one decimal).
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 1100);
    const v = card.overall * (1 - Math.pow(1 - t, 3));
    $("d-score").textContent = t < 1 ? Math.round(v) : String(card.overall);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  $("d-role-rubric").replaceChildren(...criteria(plan.rubric || [], card.role || []));
  $("d-baseline").replaceChildren(...criteria(baseline, card.baseline || []));

  $("d-mail").innerHTML = ICON.mail;
  $("d-mail").append(
    el("span", null, mail.sent ? `A copy is on its way to ${email}.` : `Not emailed: ${mail.reason} Screenshot this page to keep it.`)
  );

  const list = $("d-qs");
  list.innerHTML = "";
  plan.questions.forEach((q, i) => {
    const s = card.questions[i] || {};
    const box = el("div", "qcard");
    const head = el("div", "head");
    head.append(el("span", "tag", `Q${i + 1} · ${q.why}`));
    head.append(scoreDots(s.score));
    box.append(head, el("p", "q", q.ask));
    box.append(s.quote ? el("blockquote", "quote", `“${s.quote}”`) : el("p", "muted", "No answer recorded."));
    for (const [k, v] of [["Worked", s.strength], ["Improve", s.improve]]) {
      if (!v) continue;
      const row = el("p", "note");
      row.append(el("b", null, k), el("span", null, v));
      box.append(row);
    }
    list.append(box);
  });

  $("d-next").innerHTML = "";
  (card.next_steps || []).forEach((s) => $("d-next").append(el("li", null, s)));
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
  setState("thinking");
  lock(true, "");
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
    $("typed").value = await stopRecording();
    setState("idle");
  }
  setTyping(!typing);
  if (!$("mic").disabled) $("status").textContent = typing ? "Type your answer, then submit" : "Tap the mic when you're ready";
};
$("repeat").onclick = async () => {
  if (recording || !current) return;
  setState("speaking");
  lock(true, "");
  await speak(current);
  setState("idle");
  lock(false, typing ? "Type your answer, then submit" : "Tap the mic when you're ready");
};
$("retry").onclick = finish;

$("start").onclick = () => {
  const email = $("email").value.trim();
  if (email && !EMAIL_RE.test(email)) {
    $("w-err").textContent = "That email doesn't look right.";
    return;
  }
  $("w-err").textContent = "";
  unlockAudio();
  run();
};

function renderPrep() {
  const p = plan.prep;
  if (!p) return;
  $("prep").hidden = false;
  $("p-about").textContent = p.about;
  $("p-looks").replaceChildren(...(p.looks_for || []).map((t) => el("li", null, t)));
  $("p-prepare").replaceChildren(...(p.prepare || []).map((t) => el("li", null, t)));
  $("p-tips").replaceChildren(...(p.tips || []).map((t) => el("li", null, t)));
  $("p-rubric").replaceChildren(...(plan.rubric || []).map((c) => el("span", "chip", c.name)));
}

async function load() {
  try {
    const id = location.pathname.match(/^\/i\/([a-z0-9-]+)/)?.[1] || new URLSearchParams(location.search).get("id");
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
    $("w-meta").replaceChildren(el("span", "muted", e.message || "Ask whoever sent it for a fresh link."));
    return;
  }
  document.title = `Mock interview: ${plan.role}${plan.company ? ` at ${plan.company}` : ""}`;
  $("w-title").textContent = plan.role;
  const chips = [plan.company, `${plan.questions.length} questions`, `About ${plan.questions.length * 2} min`, "Voice"].filter(Boolean);
  $("w-meta").replaceChildren(...chips.map((c) => el("span", "chip", c)));
  renderPrep();
  $("start").disabled = false;
  if (!Recognition)
    $("w-note").textContent = "This browser can't transcribe speech, so you'll type your answers. For voice, use Safari on iPhone or Chrome on Android.";
}
load();
