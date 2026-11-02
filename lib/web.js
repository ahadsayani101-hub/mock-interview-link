// Free web research without a search API key: search DuckDuckGo (or Bing as a backup), read the
// top pages, and pull the company's Wikipedia article. Every step is best effort; whatever
// fails is skipped, and the AI fills gaps from what it already knows.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/xhtml+xml,*/*" };
// Sites that block bots or need a login; their search snippets are still used.
const SKIP = /(^|\.)(glassdoor|linkedin|indeed|facebook|instagram|x|twitter|youtube|tiktok|reddit|quora|pinterest)\.com$/;

async function get(url, { ms = 8000, ...init } = {}) {
  try {
    const r = await fetch(url, { ...init, headers: { ...HEADERS, ...init.headers }, signal: AbortSignal.timeout(ms), redirect: "follow" });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/" };
const decode = (s) =>
  s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) =>
    ENTITIES[e] ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : m)
  );
const strip = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Readable text of a page: drops scripts, styles, navigation and footers.
export function pageText(html) {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|section|article|br|tr)>/gi, "\n");
  const text = decode(body.replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 30) // skip menu items and buttons
    .join("\n");
  return { title, text };
}

export function parseDuckDuckGo(html) {
  const out = [];
  // Each result: a title link (class result__a), then its snippet before the next result.
  const blocks = html.split(/(?=<a[^>]*class="result__a")/).slice(1);
  for (const block of blocks) {
    const a = block.match(/^<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decode(a[1]);
    const wrapped = url.match(/[?&]uddg=([^&]+)/);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (url.startsWith("//")) url = "https:" + url;
    const snip = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/);
    if (/^https?:\/\//.test(url) && !/duckduckgo\.com\/y\.js/.test(url)) out.push({ url, title: strip(a[2]), snippet: strip(snip?.[1] || "") });
  }
  return out;
}

// Google News RSS: recent headlines with dates, no key needed.
export function parseNewsRss(xml) {
  const out = [];
  for (const item of xml.split("<item>").slice(1)) {
    const tag = (t) => decode(item.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
    const url = tag("link");
    const date = new Date(tag("pubDate"));
    const when = isNaN(date) ? "" : date.toISOString().slice(0, 10);
    if (url) out.push({ url, title: strip(tag("title")), snippet: `${when ? when + ": " : ""}${strip(tag("title"))} (${tag("source") || "news"})` });
  }
  return out;
}

async function news(company) {
  const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${company}" when:1y`)}&hl=en-US&gl=US&ceid=US:en`, { ms: 6000 });
  return xml ? parseNewsRss(xml).slice(0, 10) : [];
}

export function parseBing(html) {
  const out = [];
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decode(a[1]);
    // Bing sometimes wraps links: .../ck/a?...&u=a1<base64 of the real URL>
    const u = url.match(/[?&]u=a1([^&]+)/);
    if (u) {
      try { url = Buffer.from(u[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch {}
    }
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (/^https?:\/\//.test(url)) out.push({ url, title: strip(a[2]), snippet: strip(p?.[1] || "") });
  }
  return out;
}

async function search(q) {
  const ddg = await get("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q, kl: "us-en" }).toString(),
  });
  const found = ddg ? parseDuckDuckGo(ddg) : [];
  if (found.length) return found.slice(0, 8);
  const bing = await get(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en&cc=US`);
  return bing ? parseBing(bing).slice(0, 8) : [];
}

// Reads a page directly, or through a free reader service for sites that need JavaScript.
async function readPage(url) {
  const html = await get(url, { ms: 7000 });
  let page = html ? pageText(html) : { title: "", text: "" };
  if (page.text.length < 600) {
    const md = await get(`https://r.jina.ai/${url}`, { ms: 9000, headers: { Accept: "text/plain" } });
    if (md && md.length > page.text.length) page = { title: md.match(/^Title:\s*(.+)$/m)?.[1] || page.title, text: md };
  }
  return page.text.length > 200 ? { url, title: page.title || url, text: page.text.slice(0, 6000) } : null;
}

async function wikipedia(company) {
  const api = "https://en.wikipedia.org/w/api.php?format=json&origin=*&";
  const s = await get(`${api}action=query&list=search&srlimit=1&srsearch=${encodeURIComponent(company + " company")}`, { ms: 6000 });
  const title = s && JSON.parse(s).query?.search?.[0]?.title;
  if (!title) return null;
  const x = await get(`${api}action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`, { ms: 6000 });
  const page = x && Object.values(JSON.parse(x).query?.pages || {})[0];
  return page?.extract ? { url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`, title: `${title} (Wikipedia)`, text: page.extract.slice(0, 6000) } : null;
}

const host = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
};

// Returns { results: search hits with snippets, pages: [{ url, title, text }] }.
export async function webResearch({ company, position }) {
  const year = new Date().getFullYear();
  const queries = [
    `${company} ${position} interview process`,
    `${company} ${position} interview questions`,
    `${company} mission values culture what they look for`,
    `${company} careers ${position}`,
    `${company} news ${year}`,
  ];
  const [headlines, ...lists] = await Promise.all([news(company).catch(() => []), ...queries.map((q) => search(q).catch(() => []))]);

  // Read the top couple of readable pages from each search, skipping repeats.
  const seen = new Set();
  const toRead = [];
  for (const list of lists) {
    let taken = 0;
    for (const r of list) {
      const h = host(r.url);
      if (taken === 2 || seen.has(r.url) || SKIP.test(h)) continue;
      seen.add(r.url);
      toRead.push(r.url);
      taken++;
    }
  }
  const [wiki, ...pages] = await Promise.all([wikipedia(company).catch(() => null), ...toRead.slice(0, 8).map((u) => readPage(u).catch(() => null))]);

  const results = [];
  const urls = new Set();
  for (const list of lists) for (const r of list) if (!urls.has(r.url)) urls.add(r.url), results.push(r);
  // Headlines go in as search snippets (news sites rarely allow reading the full article).
  return { results: [...results.slice(0, 30), ...headlines], pages: [wiki, ...pages].filter(Boolean) };
}
