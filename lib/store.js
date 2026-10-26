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

export async function savePlan(plan) {
  const id = randomBytes(6).toString("base64url");
  await redis(["SET", `plan:${id}`, JSON.stringify(plan), "EX", TTL]);
  return id;
}

export async function loadPlan(id) {
  if (!/^[A-Za-z0-9_-]{4,16}$/.test(id)) return null;
  const raw = await redis(["GET", `plan:${id}`]);
  return raw ? JSON.parse(raw) : null;
}
