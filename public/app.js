// Entry point for the one-page app: build an interview, share it, then hand off to the lobby.
import { initTheme, initClock, INTERVIEWERS, face, encodePlan, post, el, show, savedInterviews } from "/ui.js";
import { openLobby, loadFromLink } from "/interview.js";
import { initInstall } from "/install.js";
import qrcode from "/vendor/qrcode.js";

const $ = (id) => document.getElementById(id);
initTheme();
initClock();
initInstall();

// A shared link (/i/<id>, /i#<plan> or ?id=) opens straight into the lobby.
if (/^\/i(\/|$)/.test(location.pathname) || new URLSearchParams(location.search).has("id")) {
  loadFromLink().then((plan) => {
    if (plan) renderShare(plan, location.pathname.match(/^\/i\/([a-z0-9-]+)/)?.[1], location.href);
  });
} else {
  show("create");
  renderSaved();
}
// Back/forward moves between the build form and an interview's link, so reload that step.
addEventListener("popstate", () => location.reload());

const people = Object.values(INTERVIEWERS);
$("faces").replaceChildren(...people.map((p) => face(p, 120)));

// Single-choice chip groups
function chips(group, onPick) {
  group.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      group.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      onPick(b.dataset.v);
    };
  });
}
let count = 5;
chips($("count"), (v) => (count = Number(v)));

let interviewer = people[Math.floor(Math.random() * people.length)].id;
$("who").replaceChildren(
  ...people.map((p) => {
    const b = el("button", "chip-btn");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(p.id === interviewer));
    b.dataset.v = p.id;
    b.append(face(p, 80), p.name);
    return b;
  })
);
// The hero shows whoever will interview you.
function hero(id) {
  const p = INTERVIEWERS[id];
  $("hero-photo").replaceChildren(face(p, 1600, 1200));
  $("hero-who").textContent = `${p.name} is ready to interview you`;
}
hero(interviewer);
chips($("who"), (v) => hero((interviewer = v)));

if (navigator.clipboard?.readText) {
  $("paste").hidden = false;
  $("paste").onclick = async () => {
    try {
      $("posting").value = await navigator.clipboard.readText();
      $("posting").dispatchEvent(new Event("input"));
    } catch {}
  };
}
$("posting").oninput = () => {
  const n = $("posting").value.trim().split(/\s+/).filter(Boolean).length;
  $("words").textContent = `${n} word${n === 1 ? "" : "s"}`;
};

let timer;
function working(company) {
  const steps = [
    `Researching ${company}. This takes a minute or two`,
    "Reading the job description",
    "Finding what interviewers look for",
    "Building your rubric",
    "Writing the questions",
    "Writing your prep sheet",
    "Still digging. Good research takes a minute",
  ];
  let i = 0;
  const step = () => {
    $("note").replaceChildren(el("span", "bar-anim"), el("span", null, steps[Math.min(i++, steps.length - 1)]));
  };
  step();
  timer = setInterval(step, 9000);
}

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("err").textContent = "";
  const company = $("company").value.trim();
  $("go").disabled = true;
  $("go-label").textContent = "Building";
  working(company || "the company");
  try {
    const { plan, id, baseline } = await post("/api/create", {
      company,
      position: $("position").value,
      posting: $("posting").value,
      count,
      interviewer,
    });
    const url = id ? `${location.origin}/i/${id}` : `${location.origin}/i#${encodePlan(plan)}`;
    history.pushState(null, "", url); // the address bar now holds the share link
    openLobby(plan, { baseline, creator: true });
    renderShare(plan, id, url);
  } catch (err) {
    $("err").textContent = err.message;
  } finally {
    clearInterval(timer);
    $("note").textContent = "";
    $("go").disabled = false;
    $("go-label").textContent = "Build my interview";
  }
};

function renderShare(plan, id, url) {
  $("share-box").hidden = false;
  $("short").textContent = id ? url.replace(/^https?:\/\//, "") : "Copy long link";
  try {
    const qr = qrcode(0, "L");
    qr.addData(url);
    qr.make();
    $("qr").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  } catch {
    $("qr").textContent = "";
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      $("copied").textContent = "Copied to clipboard";
    } catch {
      $("copied").textContent = "Couldn't copy. Press and hold the link instead.";
    }
    setTimeout(() => ($("copied").textContent = ""), 2000);
  };
  $("short").onclick = copy;
  $("share").textContent = navigator.share ? "Share link" : "Copy link";
  $("share").onclick = () =>
    navigator.share ? navigator.share({ title: `Practice interview: ${plan.role} at ${plan.company}`, url }).catch(() => {}) : copy();
}

// Interviews built or taken on this device, newest first, with the last score.
function renderSaved() {
  const list = savedInterviews().slice(0, 6);
  $("saved").hidden = !list.length;
  const day = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  $("saved-list").replaceChildren(
    ...list.map((x) => {
      const a = el("a", "saved-row");
      a.href = x.path;
      const main = el("span", "saved-main");
      main.append(el("b", null, x.role || "Interview"), el("span", null, [x.company, day(x.scoredAt || x.at)].filter(Boolean).join(" · ")));
      const score = el("span", "saved-score");
      if (x.score != null) score.append(String(x.score), el("small", null, "/10"));
      else score.append(el("small", null, "Not taken yet"));
      a.append(main, score, el("span", "saved-go"));
      a.lastChild.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
      return a;
    })
  );
}
