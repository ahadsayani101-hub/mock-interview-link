// Shared bits: page steps, theme switch, interviewer faces, link packing, API calls.

// The app is one page; each step is a section and only one shows at a time.
export const show = (id) => ["create", "welcome", "interview", "done"].forEach((s) => (document.getElementById(s).hidden = s !== id));

// ---------- Theme ----------
export function initTheme() {
  const root = document.documentElement;
  const buttons = document.querySelectorAll(".theme");
  const apply = (dark) => {
    if (dark) root.dataset.dark = "";
    else delete root.dataset.dark;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#f2eee6");
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(dark)));
  };
  apply("dark" in root.dataset);
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      const dark = !("dark" in root.dataset);
      root.dataset.theme = dark ? "dark" : "light";
      try { localStorage.setItem("theme", root.dataset.theme); } catch {}
      apply(dark);
    })
  );
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => {
    if (!root.dataset.theme) apply(e.matches);
  });
}

// ---------- Interviewers ----------
const photo = (id, w, h) => `https://images.unsplash.com/${id}?w=${w}&h=${h}&fit=crop&crop=faces&auto=format&q=80`;
export const INTERVIEWERS = {
  maya: { id: "maya", name: "Maya", photo: "photo-1494790108377-be9c29b29330" },
  daniel: { id: "daniel", name: "Daniel", photo: "photo-1472099645785-5658abf4ff4e" },
};
export const interviewerFor = (plan) => INTERVIEWERS[plan?.interviewer] || INTERVIEWERS.maya;

// A photo of the interviewer, falling back to their initial if the image can't load.
export function face(person, w = 400, h = w) {
  const img = document.createElement("img");
  img.className = "face";
  img.alt = person.name;
  img.src = photo(person.photo, w, h);
  img.onerror = () => img.replaceWith(Object.assign(document.createElement("div"), { className: "mono-face", textContent: person.name[0] }));
  return img;
}

// ---------- Links and API ----------
// Without a database, interview plans travel inside the link itself (after #).
export function encodePlan(plan) {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePlan(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

export async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status });
  return data;
}

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
