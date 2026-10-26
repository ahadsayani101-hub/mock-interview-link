// The lobby, the call and the scorecard. app.js opens the lobby after building, or from a shared link.
import { interviewerFor, face, decodePlan, post, el, show } from "/ui.js";

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.7-1.3M5 10a7 7 0 0 0 11.5 5.4M19 10a7 7 0 0 1-.6 2.8M12 17v4"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
};

let plan, person;
const turns = []; // the whole conversation: { who: "interviewer" | "candidate", text, q }
let q = -1; // index of the main question being discussed
let ended = false;

// ---------- Call screen ----------
let clock;
function startClock() {
  const t0 = Date.now();
  clock = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $("timer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
}

function setQuestion(i) {
  q = Math.max(0, Math.min(plan.questions.length - 1, Number(i) || 0));
  $("q-progress").textContent = `Question ${q + 1} of ${plan.questions.length}`;
  $("progress").replaceChildren(...plan.questions.map((_, k) => el("i", k <= q ? "on" : "")));
}

const status = (t) => ($("status").textContent = t);
const captionThem = (t) => ($("cap-them").textContent = t);
const captionYou = (t) => ($("cap-you").textContent = t);
function speaking(on) {
  $("tile").toggleAttribute("data-speaking", on);
  if (on) status(`${person.name} is speaking`);
}

// Gently zoom the interviewer's photo with the loudness of their voice.
let audioCtx;
function meter(stream) {
  try {
    const an = audioCtx.createAnalyser();
    an.fftSize = 256;
    audioCtx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) ** 2;
      const lvl = Math.min(1, (Math.sqrt(sum / buf.length) / 128) * 5);
      $("tile").style.setProperty("--lvl", lvl.toFixed(3));
      if (!ended) requestAnimationFrame(tick);
    };
    tick();
  } catch { /* purely cosmetic */ }
}

// ---------- Live mode: a real-time, hands-free conversation ----------
let pc, dc, micTrack, ending = false;
const send = (msg) => dc?.readyState === "open" && dc.send(JSON.stringify(msg));
const byItem = new Map();

function turnFor(id, who) {
  let t = byItem.get(id);
  if (!t) {
    t = { who, text: "", q }; // q is -1 during the small talk before the first question
    byItem.set(id, t);
    turns.push(t);
  }
  return t;
}

async function startLive(stream) {
  const name = $("name").value.trim();
  const { value } = await post("/api/realtime", { plan, name });

  pc = new RTCPeerConnection();
  pc.ontrack = (e) => {
    $("remote").srcObject = e.streams[0];
    meter(e.streams[0]);
  };
  micTrack = stream.getAudioTracks()[0];
  pc.addTrack(micTrack, new MediaStream([micTrack]));

  dc = pc.createDataChannel("oai-events");
  dc.onmessage = (e) => onLiveEvent(JSON.parse(e.data));
  dc.onopen = () => {
    $("tile").dataset.state = "live";
    status(`${person.name} joined`);
    send({ type: "response.create" }); // the interviewer speaks first
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" && !ended) {
      status("The connection dropped. Wrapping up");
      hangUp();
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const r = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/sdp" },
  });
  if (!r.ok) throw new Error(`Voice connection failed (${r.status})`);
  await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
}

function onLiveEvent(ev) {
  switch (ev.type) {
    case "input_audio_buffer.speech_started":
      turnFor(ev.item_id, "candidate");
      captionYou("…");
      status("Listening");
      break;
    case "input_audio_buffer.speech_stopped":
      status(`${person.name} is thinking`);
      break;
    case "conversation.item.input_audio_transcription.delta": {
      const t = turnFor(ev.item_id, "candidate");
      t.text += ev.delta || "";
      captionYou(t.text);
      break;
    }
    case "conversation.item.input_audio_transcription.completed": {
      const t = turnFor(ev.item_id, "candidate");
      t.text = (ev.transcript || "").trim();
      captionYou(t.text);
      break;
    }
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta": {
      const t = turnFor(ev.item_id, "interviewer");
      if (!t.text) captionYou("");
      t.text += ev.delta || "";
      captionThem(t.text);
      speaking(true);
      break;
    }
    case "response.output_audio_transcript.done":
    case "response.audio_transcript.done": {
      const t = turnFor(ev.item_id, "interviewer");
      if (ev.transcript) t.text = ev.transcript;
      captionThem(t.text);
      break;
    }
    case "output_audio_buffer.started":
      speaking(true);
      break;
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      speaking(false);
      if (ending) setTimeout(hangUp, 600);
      else if (!$("tile").hasAttribute("data-speaking")) status("Your turn. Just talk");
      break;
    case "response.done":
      handleToolCalls(ev.response);
      break;
    case "error":
      console.warn("Realtime error", ev.error);
      break;
  }
}

function handleToolCalls(response) {
  for (const item of response?.output || []) {
    if (item.type !== "function_call") continue;
    let args = {};
    try { args = JSON.parse(item.arguments || "{}"); } catch {}
    const reply = (output) =>
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify(output) } });

    if (item.name === "set_question") {
      setQuestion(args.index);
      // If the question was already spoken in this same response, file it under the new question.
      const last = turns.at(-1);
      if (last?.who === "interviewer" && last.text.includes("?")) last.q = q;
      reply({ ok: true, question: plan.questions[q].ask });
      send({ type: "response.create" });
    } else if (item.name === "end_interview") {
      ending = true;
      reply({ ok: true });
      // Hang up when the goodbye finishes playing (or soon, if it already has).
      setTimeout(hangUp, $("tile").hasAttribute("data-speaking") ? 12000 : 1500);
    }
  }
}

// ---------- Classic mode: tap to talk (when live voice isn't available) ----------
// Interviewer voice from /api/speak, falling back to the browser's built-in voice.
let cloudVoice = true;
const player = new Audio();
const audioCache = new Map();

function fetchAudio(text) {
  if (!cloudVoice || !text) return Promise.resolve(null);
  if (!audioCache.has(text)) {
    audioCache.set(
      text,
      fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: plan.interviewer }) })
        .then(async (r) => {
          if (r.status === 501) cloudVoice = false;
          return r.ok ? URL.createObjectURL(await r.blob()) : null;
        })
        .catch(() => null)
    );
  }
  return audioCache.get(text);
}

// iOS only lets a page play audio after a tap; play a blank clip inside the Join tap.
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

let voice;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith("en"));
  const pref = ["(Natural)", "(Premium)", "(Enhanced)", "Samantha", "Google US English", "Microsoft Aria", "Karen", "Daniel"];
  voice = pref.map((n) => vs.find((v) => v.name.includes(n))).find(Boolean) || vs.find((v) => v.default) || vs[0];
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function browserSpeak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.02;
    const timer = setTimeout(resolve, 2000 + text.length * 90);
    u.onend = u.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

async function say(text) {
  captionThem(text);
  captionYou("");
  speaking(true);
  const url = await fetchAudio(text);
  if (!(url && (await playUrl(url)))) await browserSpeak(text);
  speaking(false);
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let typing = !Recognition;
let rec, recording = false, committed = "", live = "";
let answerResolve, current;

function listen() {
  rec = new Recognition();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    live = Array.from(e.results, (r) => r[0].transcript).join(" ");
    captionYou((committed + " " + live).trim());
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      recording = false;
      resetTalk();
      setTyping(true);
      status("Microphone is blocked, so type your answer");
    }
  };
  // Mobile browsers stop listening after a pause; keep going until the user taps done.
  rec.onend = () => {
    committed = (committed + " " + live).trim();
    live = "";
    if (recording) {
      try { listen(); } catch {}
    }
  };
  rec.start();
}

function resetTalk() {
  $("talk").classList.remove("rec");
  $("talk").innerHTML = ICON.mic;
}

function stopRecording() {
  return new Promise((resolve) => {
    recording = false;
    resetTalk();
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
  $("talk").innerHTML = on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' : ICON.mic;
  $("type").hidden = !Recognition;
  if (on) setTimeout(() => $("typed").focus(), 50);
}

function lock(locked) {
  $("talk").disabled = locked;
  $("repeat").disabled = locked;
}

async function ask(text) {
  current = text;
  turns.push({ who: "interviewer", text, q });
  lock(true);
  await say(text);
  if (ended) return "";
  lock(false);
  status(typing ? "Type your answer, then tap the arrow" : "Tap the mic to answer");
  const a = await new Promise((resolve) => (answerResolve = resolve));
  turns.push({ who: "candidate", text: a, q });
  return a;
}

async function runClassic() {
  $("live-controls").hidden = true;
  $("classic-controls").hidden = false;
  $("tile").dataset.state = "live";
  setTyping(typing);
  const name = $("name").value.trim();
  const greeting = `Hi${name ? " " + name : ""}, I'm ${person.name}. Thanks for making the time. Let's dive in.`;
  fetchAudio(greeting);
  plan.questions.forEach((x) => fetchAudio(x.ask));
  await say(greeting);

  for (let i = 0; i < plan.questions.length && !ended; i++) {
    setQuestion(i);
    const exchanges = [];
    let text = plan.questions[i].ask;
    while (!ended) {
      const a = await ask(text);
      if (ended) break;
      exchanges.push({ q: text, a });
      lock(true);
      status(`${person.name} is thinking`);
      let t;
      try {
        t = await post("/api/turn", { plan, index: i, exchanges });
      } catch {
        t = { action: "next", say: "Thanks." };
      }
      if (t.action === "followup" && t.say) {
        text = t.say;
        continue;
      }
      if (t.say) {
        turns.push({ who: "interviewer", text: t.say, q });
        await say(t.say);
      }
      break;
    }
  }
  if (ended) return;
  await say("That's everything I wanted to ask. Thanks so much. Your scorecard is on its way.");
  hangUp();
}

$("talk").onclick = async () => {
  if (typing) {
    const a = $("typed").value.trim();
    if (!a) return;
    $("typed").value = "";
    answerResolve?.(a);
    return;
  }
  if (!recording) {
    speechSynthesis?.cancel();
    committed = "";
    live = "";
    captionYou("");
    recording = true;
    $("talk").classList.add("rec");
    $("talk").innerHTML = ICON.stop;
    status("Listening. Tap when you're done");
    try {
      listen();
    } catch {
      setTyping(true);
    }
    return;
  }
  lock(true);
  status(`${person.name} is thinking`);
  answerResolve?.(await stopRecording());
};
$("type").onclick = async () => {
  if (recording) $("typed").value = await stopRecording();
  setTyping(!typing);
  if (!$("talk").disabled) status(typing ? "Type your answer, then tap the arrow" : "Tap the mic to answer");
};
$("repeat").onclick = async () => {
  if (recording || !current) return;
  lock(true);
  await say(current);
  lock(false);
};

// ---------- Shared controls ----------
let endArmed = false;
function endPressed() {
  if (!endArmed) {
    endArmed = true;
    status("Tap end again to finish the interview");
    setTimeout(() => (endArmed = false), 3000);
    return;
  }
  hangUp();
}
$("end").onclick = endPressed;
$("end2").onclick = endPressed;
$("mute").onclick = () => {
  if (!micTrack) return;
  micTrack.enabled = !micTrack.enabled;
  $("mute").classList.toggle("off", !micTrack.enabled);
  $("mute").innerHTML = micTrack.enabled ? ICON.mic : ICON.micOff;
  status(micTrack.enabled ? "Unmuted" : "You're muted");
};
$("cc").onclick = () => {
  const off = $("captions").toggleAttribute("data-off");
  $("cc").classList.toggle("off", off);
};

let media;
function hangUp() {
  if (ended) return;
  ended = true;
  clearInterval(clock);
  try { pc?.close(); } catch {}
  media?.getTracks().forEach((t) => t.stop());
  speechSynthesis?.cancel();
  player.pause();
  if (recording) stopRecording();
  answerResolve?.("");
  finish();
}

async function getMedia(withCam) {
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: withCam ? { facingMode: "user", width: { ideal: 480 } } : false });
  } catch (err) {
    if (withCam) return getMedia(false);
    throw err;
  }
}

$("start").onclick = async () => {
  const email = $("email").value.trim();
  if (email && !EMAIL_RE.test(email)) {
    $("w-err").textContent = "That email doesn't look right.";
    return;
  }
  $("w-err").textContent = "";
  unlockAudio();
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch {}

  show("interview");
  window.scrollTo(0, 0);
  status("Connecting");
  captionThem("");
  try {
    media = await getMedia($("cam").checked);
  } catch {
    media = null;
  }
  if (media?.getVideoTracks().length) {
    $("self").srcObject = new MediaStream(media.getVideoTracks());
    $("self").hidden = false;
  }
  startClock();

  if (media?.getAudioTracks().length) {
    try {
      await startLive(media);
      return;
    } catch (err) {
      console.warn("Live voice unavailable, using tap-to-talk:", err.message);
      try { pc?.close(); } catch {}
      pc = dc = null;
      media.getAudioTracks().forEach((t) => t.stop());
    }
  }
  runClassic();
};

// ---------- Scorecard ----------
async function finish() {
  show("done");
  window.scrollTo(0, 0);
  $("d-loading").hidden = false;
  $("d-error").hidden = true;
  $("d-result").hidden = true;
  const said = turns.filter((t) => t.text?.trim());
  try {
    const r = await post("/api/finish", { plan, turns: said, name: $("name").value.trim(), email: $("email").value.trim() });
    renderResults(r.card, r.mail, r.baseline || []);
  } catch (err) {
    $("d-loading").hidden = true;
    $("d-error").hidden = false;
    $("d-err").textContent = err.message;
  }
}
$("retry").onclick = finish;

function meterEl(score = 0) {
  const m = el("span", "meter");
  m.setAttribute("aria-label", `${score} out of 5`);
  for (let k = 1; k <= 5; k++) m.append(el("i", k <= score ? "on" : ""));
  return m;
}

function criteria(list, scores) {
  return list.map((c, i) => {
    const s = scores[i] || {};
    const box = el("div", "crit");
    const h = el("div", "h");
    h.append(el("b", null, c.name), meterEl(s.score));
    box.append(h);
    if (s.evidence) box.append(el("p", "ev", `“${s.evidence}”`));
    if (s.comment) box.append(el("p", null, s.comment));
    return box;
  });
}

function renderResults(card, mail, baseline) {
  $("d-loading").hidden = true;
  $("d-result").hidden = false;
  $("d-role").textContent = `Scorecard · ${plan.role} at ${plan.company}`;
  $("d-headline").textContent = card.headline;
  $("d-summary").textContent = card.summary;
  const email = $("email").value.trim();
  $("d-mail").textContent = mail.sent
    ? `A copy is on its way to ${email}.`
    : `Not emailed: ${String(mail.reason || "").replace(/\.$/, "")}. Screenshot this page to keep it.`;

  // Count up to the score, ending on the exact value (it can have one decimal).
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 1100);
    $("d-score").textContent = t < 1 ? Math.round(card.overall * (1 - (1 - t) ** 3)) : String(card.overall);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  $("d-role-rubric").replaceChildren(...criteria(plan.rubric || [], card.role || []));
  $("d-baseline").replaceChildren(...criteria(baseline, card.baseline || []));

  $("d-qs").replaceChildren(
    ...plan.questions.map((x, i) => {
      const s = card.questions[i] || {};
      const d = el("details", "ans");
      const sum = el("summary");
      sum.append(el("span", "q", x.ask), meterEl(s.score), el("span", "t", `Q${i + 1} · ${x.why}`));
      const body = el("div", "body");
      body.append(s.quote ? el("blockquote", null, s.quote) : el("p", "muted", "No answer recorded."));
      for (const [k, v] of [["Worked", s.strength], ["Improve", s.improve]]) {
        if (!v) continue;
        const row = el("p", "kv");
        row.append(el("b", null, k), el("span", null, v));
        body.append(row);
      }
      d.append(sum, body);
      return d;
    })
  );
  $("d-next").replaceChildren(...(card.next_steps || []).map((s) => el("li", null, s)));
  $("again").href = location.href;
}

// ---------- Lobby: prep sheet in one scroll, then join ----------
function heading(title, note) {
  const h = el("h2", "sec", title);
  if (note) h.append(el("span", null, note));
  return h;
}

function bullets(items) {
  const ul = el("ul", "dash");
  ul.append(...items.map((t) => el("li", null, t)));
  return ul;
}

function numbered(rows) {
  const ul = el("ul", "list");
  ul.append(
    ...rows.map(([title, desc, small]) => {
      const li = el("li");
      li.append(el("b", null, title), el("span", "d", desc || ""), el("span", "s", small || ""));
      return li;
    })
  );
  return ul;
}

function more(summary, ...content) {
  const d = el("details", "more");
  d.append(el("summary", null, summary), ...content);
  return d;
}

function renderPrep(baseline, creator) {
  const p = plan.prep || {};
  const out = [];
  if (p.about) out.push(heading("The role"), el("p", "about", p.about));
  if (p.looks_for?.length) out.push(heading("What they look for"), bullets(p.looks_for));
  if (p.prepare?.length) out.push(heading("How to prepare"), bullets(p.prepare));
  if (p.tips?.length) out.push(heading("Tips for the call"), bullets(p.tips));
  out.push(
    heading("Graded on", plan.research ? "From the posting + research" : "From the posting"),
    numbered((plan.rubric || []).map((c) => [c.name, c.strong, creator ? c.source : ""]))
  );
  if (baseline?.length) {
    const names = baseline.map((c) => c.name.toLowerCase());
    out.push(el("p", "basics", `Plus the basics every interview is graded on: ${names.slice(0, -1).join(", ")}, and ${names.at(-1)}.`));
  }
  if (creator && plan.sources?.length) {
    const ul = el("ul", "list sources");
    ul.append(
      ...plan.sources.map((s) => {
        const li = el("li");
        const a = el("a", null, s.title);
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener";
        li.append(a, el("span", "s", new URL(s.url).hostname.replace(/^www\./, "")));
        return li;
      })
    );
    out.push(more("Research sources", ul));
  }
  if (creator) out.push(more("The questions (spoilers if you're taking it yourself)", numbered(plan.questions.map((x) => [x.ask, "", x.why]))));
  $("prep").replaceChildren(...out);
}

export function openLobby(p, { baseline, creator = false } = {}) {
  plan = p;
  person = interviewerFor(plan);
  document.title = `Interview: ${plan.role} at ${plan.company}`;
  $("portrait").hidden = false;
  $("portrait").querySelector(".face, .mono-face")?.remove();
  $("portrait").prepend(face(person, 900));
  $("w-who").textContent = `${person.name} is ready`;
  if (creator) $("w-kicker").innerHTML = plan.demo ? "Demo mode · <b>add an API key for real research</b>" : "Ready · <b>start now or share the link</b>";
  else $("w-kicker").textContent = `Mock interview · ${plan.company}`;
  $("w-title").replaceChildren(document.createTextNode(plan.role + " "), el("em", null, `at ${plan.company}`));
  $("w-sub").textContent = `With ${person.name} · ${plan.questions.length} questions · about ${plan.questions.length * 2} minutes`;
  $("tile-face").replaceChildren(face(person, 1000, 1400));
  $("tile-name").textContent = `${person.name} · ${plan.company}`;
  $("d-face").replaceChildren(face(person, 200));
  $("d-loading-title").textContent = `${person.name} is writing up your scorecard`;
  $("share-box").hidden = true;
  renderPrep(baseline, creator);
  $("start").disabled = false;
  show("welcome");
  window.scrollTo(0, 0);
}

export async function loadFromLink() {
  show("welcome");
  let p, baseline;
  try {
    const id = location.pathname.match(/^\/i\/([a-z0-9-]+)/)?.[1] || new URLSearchParams(location.search).get("id");
    if (id) {
      const r = await fetch(`/api/plan?id=${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      ({ plan: p, baseline } = data);
    } else {
      p = decodePlan(location.hash.slice(1));
    }
    if (!p?.questions?.length) throw new Error("This link is missing its interview.");
  } catch (e) {
    $("w-title").textContent = "This link doesn't work.";
    $("w-sub").textContent = e.message || "Ask whoever sent it for a fresh link.";
    $("portrait").hidden = true;
    return;
  }
  openLobby(p, { baseline });
}
