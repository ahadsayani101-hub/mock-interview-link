// Optional short links. If an Upstash Redis database is connected (Vercel Marketplace sets
// KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN), plans are saved and the link is short
// enough for a QR code. Without one, the whole plan is packed into the link instead.
import { randomBytes } from "node:crypto";

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasStore = () => Boolean(url() && token());

async function redis(cmd) {
  const r = await fetch(url(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const data = await r.json();
  if (data.error) throw new Error(`Store error: ${data.error}`);
  return data.result;
}

const TTL = 60 * 60 * 24 * 90; // 90 days

// Readable short ids like "stripe-7kq2": company name plus a few random characters.
function makeId(company) {
  const slug = String(company || "interview")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/, "") || "interview";
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const code = [...randomBytes(4)].map((b) => abc[b % abc.length]).join("");
  return `${slug}-${code}`;
}

export async function savePlan(plan) {
  for (let i = 0; i < 5; i++) {
    const id = makeId(plan.company);
    if (await redis(["SET", `plan:${id}`, JSON.stringify(plan), "EX", TTL, "NX"])) return id;
  }
  throw new Error("Couldn't create a short link. Try again.");
}

export async function loadPlan(id) {
  if (!/^[a-z0-9-]{4,40}$/.test(id)) return null;
  const raw = await redis(["GET", `plan:${id}`]);
  return raw ? JSON.parse(raw) : null;
}

// Usage limits so a public link can't run up the API bill: per visitor per hour, and for the
// whole site per day. Generous per visitor, since a classroom on one Wi-Fi shares an address.
// Without a database, or if it's unreachable, nothing is limited.
export async function overLimit(name, ip, { perHour, perDay }) {
  if (!hasStore()) return false;
  try {
    const hour = Math.floor(Date.now() / 3600e3);
    const keys = [[`rl:${name}:${ip}:${hour}`, 3600, perHour], [`rl:${name}:day:${Math.floor(hour / 24)}`, 86400, perDay]];
    for (const [key, ttl, max] of keys) {
      const n = await redis(["INCR", key]);
      if (n === 1) await redis(["EXPIRE", key, ttl]);
      if (n > max) return true;
    }
  } catch (err) {
    console.error("Usage limit check failed", err);
  }
  return false;
}
