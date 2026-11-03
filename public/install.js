// Callback as an app: registers the service worker and runs the "Get the app" button.
// Android and desktop Chrome/Edge show their own install prompt; on iPhone the button opens
// short "Add to Home Screen" steps, since Safari has no install prompt.

const $ = (id) => document.getElementById(id);
const ua = navigator.userAgent;
export const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const android = /Android/i.test(ua);
const macSafari = !iOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
export const isApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
const ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Add"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24" fill="currentColor" aria-label="Menu"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

function steps() {
  if (iOS) {
    const safari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return [
      `Tap the Share button <i>${SHARE}</i> ${safari ? "at the bottom of Safari (on iPad it's at the top)." : "next to the address bar."}`,
      `Scroll down and tap <b>Add to Home Screen</b> <i>${ADD}</i>`,
      "Tap <b>Add</b>. Callback is now on your home screen.",
    ];
  }
  if (android) {
    return [
      `Tap the menu <i>${DOTS}</i> at the top right of your browser.`,
      "Tap <b>Install app</b> or <b>Add to Home screen</b>.",
      "Tap <b>Install</b>. Callback is now with your other apps.",
    ];
  }
  if (macSafari) return ["In the menu bar, click <b>File</b>.", "Click <b>Add to Dock</b>, then <b>Add</b>."];
  return ["Open this page in Chrome or Edge.", "Click the install icon at the right end of the address bar, then <b>Install</b>."];
}

export function initInstall() {
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  if (isApp()) {
    document.documentElement.dataset.app = "";
    return;
  }

  let prompt = null;
  const buttons = document.querySelectorAll("[data-install]");
  const offer = (on) => buttons.forEach((b) => (b.hidden = !on));
  offer(iOS || android || macSafari);

  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our own button instead of the browser's banner
    prompt = e;
    offer(true);
  });
  addEventListener("appinstalled", () => {
    prompt = null;
    offer(false);
  });

  const sheet = $("install");
  $("install-close").onclick = () => sheet.close();
  sheet.addEventListener("click", (e) => e.target === sheet && sheet.close()); // tap outside to close

  buttons.forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      if (prompt) {
        prompt.prompt();
        const { outcome } = await prompt.userChoice.catch(() => ({}));
        if (outcome === "accepted") offer(false);
        prompt = null;
        return;
      }
      $("install-steps").innerHTML = steps().map((s) => `<li><span>${s}</span></li>`).join("");
      sheet.showModal();
    })
  );
}
