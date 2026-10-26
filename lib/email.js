import nodemailer from "nodemailer";
import { BASELINE } from "./rubric.js";

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const dots = (n) =>
  [1, 2, 3, 4, 5]
    .map((k) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:3px;background:${k <= n ? "#5b5bf6" : "#e5e5e5"}"></span>`)
    .join("");

function criteriaRows(criteria, scores) {
  return criteria
    .map((c, i) => {
      const s = scores[i] || {};
      return `<tr><td style="padding:12px 0;border-top:1px solid #efefef">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-weight:600;font-size:14px">${esc(c.name)}</td>
          <td align="right" style="white-space:nowrap">${dots(s.score || 0)}</td>
        </tr></table>
        <div style="font-size:14px;color:#52525b;margin-top:4px">${esc(s.comment)}</div>
        ${s.evidence ? `<div style="font-size:13px;color:#71717a;font-style:italic;margin-top:4px">“${esc(s.evidence)}”</div>` : ""}
      </td></tr>`;
    })
    .join("");
}

export function scorecardHtml({ plan, card, name, transcript }) {
  const rows = plan.questions
    .map((q, i) => {
      const s = card.questions[i] || {};
      const followups = (transcript[i]?.exchanges || []).length - 1;
      return `
      <tr><td style="padding:18px 0;border-top:1px solid #efefef">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:12px;color:#8a8a92">Q${i + 1} · ${esc(q.why)}${followups > 0 ? ` · ${followups} follow-up${followups > 1 ? "s" : ""}` : ""}</td>
          <td align="right" style="white-space:nowrap">${dots(s.score || 0)}</td>
        </tr></table>
        <div style="font-weight:600;margin:6px 0 10px;font-size:15px">${esc(q.ask)}</div>
        ${s.quote ? `<div style="margin:0 0 10px;padding:2px 0 2px 12px;border-left:2px solid #5b5bf6;font-style:italic;color:#3f3f46;font-size:14px">“${esc(s.quote)}”</div>` : `<div style="color:#8a8a92;margin-bottom:10px;font-size:14px">No answer recorded.</div>`}
        <div style="font-size:14px;margin-bottom:4px"><b style="color:#8a8a92;font-size:11px;letter-spacing:.05em">WORKED</b>&nbsp; ${esc(s.strength)}</div>
        <div style="font-size:14px"><b style="color:#8a8a92;font-size:11px;letter-spacing:.05em">IMPROVE</b>&nbsp; ${esc(s.improve)}</div>
      </td></tr>`;
    })
    .join("");
  const h = (t) => `<tr><td style="padding:28px 0 6px;font-size:12px;font-weight:600;letter-spacing:.06em;color:#8a8a92">${t}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f4f3;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0c0c0d">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="100%" style="max-width:600px;background:#ffffff;border-radius:16px;padding:28px" cellpadding="0" cellspacing="0">
    <tr><td>
      <div style="font-size:13px;color:#5b5bf6;font-weight:500">Mock interview scorecard</div>
      <h1 style="margin:6px 0 2px;font-size:24px;letter-spacing:-.02em">${esc(plan.role)}${plan.company ? ` · ${esc(plan.company)}` : ""}</h1>
      <div style="margin:0 0 20px;color:#8a8a92;font-size:14px">${name ? `For ${esc(name)} · ` : ""}${new Date().toDateString()}</div>
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="background:#0c0c0d;color:#fff;border-radius:12px;padding:10px 16px;font-size:30px;font-weight:700;letter-spacing:-.02em">${card.overall}<span style="font-size:14px;font-weight:400;color:#a1a1aa">/10</span></td>
        <td style="padding-left:16px;font-weight:600;font-size:17px">${esc(card.headline)}</td>
      </tr></table>
      <p style="margin:16px 0 0;line-height:1.55;color:#3f3f46">${esc(card.summary)}</p>
    </td></tr>
    ${h("ROLE RUBRIC")}
    ${criteriaRows(plan.rubric || [], card.role || [])}
    ${h("BASELINE")}
    ${criteriaRows(BASELINE, card.baseline || [])}
    ${h("ANSWER BY ANSWER")}
    ${rows}
    ${h("PRACTICE NEXT")}
    <tr><td><ol style="margin:0;padding-left:20px;line-height:1.7;font-size:14px">${(card.next_steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol></td></tr>
  </table></td></tr></table></body></html>`;
}

// Sends with Resend if RESEND_API_KEY is set, otherwise Gmail (GMAIL_USER + GMAIL_APP_PASSWORD).
// Returns { sent: boolean, reason?: string }.
export async function sendScorecard({ to, subject, html }) {
  if (process.env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "Mock Interview <onboarding@resend.dev>", to, subject, html }),
    });
    if (!r.ok) return { sent: false, reason: `Resend error ${r.status}: ${await r.text()}` };
    return { sent: true };
  }
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const t = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, "") },
    });
    await t.sendMail({ from: `Mock Interview <${process.env.GMAIL_USER}>`, to, subject, html });
    return { sent: true };
  }
  return { sent: false, reason: "Email is not configured on the server yet." };
}
