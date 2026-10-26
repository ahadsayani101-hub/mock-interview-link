import nodemailer from "nodemailer";

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function scorecardHtml({ plan, card, name, transcript }) {
  const rows = plan.questions
    .map((q, i) => {
      const s = card.questions[i] || {};
      const followups = (transcript[i]?.exchanges || []).length - 1;
      return `
      <tr><td style="padding:16px 0;border-top:1px solid #e5e7eb">
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Question ${i + 1} · ${esc(q.why)}${followups > 0 ? ` · ${followups} follow-up${followups > 1 ? "s" : ""}` : ""}</div>
        <div style="font-weight:600;margin:4px 0 8px">${esc(q.ask)}</div>
        <div style="font-size:14px;margin-bottom:8px"><b>${"★".repeat(s.score || 0)}${"☆".repeat(5 - (s.score || 0))}</b> ${s.score || 0}/5</div>
        ${s.quote ? `<blockquote style="margin:0 0 8px;padding:8px 12px;border-left:3px solid #6366f1;background:#f5f5ff;font-style:italic">“${esc(s.quote)}”</blockquote>` : `<div style="color:#6b7280;margin-bottom:8px">No answer recorded.</div>`}
        <div style="font-size:14px"><b>What worked:</b> ${esc(s.strength)}</div>
        <div style="font-size:14px"><b>Make it stronger:</b> ${esc(s.improve)}</div>
      </td></tr>`;
    })
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="100%" style="max-width:600px;background:#fff;border-radius:12px;padding:24px" cellpadding="0" cellspacing="0">
    <tr><td>
      <div style="font-size:13px;color:#6b7280">Mock interview scorecard</div>
      <h1 style="margin:4px 0 0;font-size:22px">${esc(plan.role)}${plan.company ? ` · ${esc(plan.company)}` : ""}</h1>
      <div style="margin:4px 0 16px;color:#374151">${name ? `For ${esc(name)} · ` : ""}${new Date().toDateString()}</div>
      <div style="display:inline-block;background:#111827;color:#fff;border-radius:10px;padding:10px 16px;font-size:28px;font-weight:700">${card.overall}<span style="font-size:14px;font-weight:400">/10</span></div>
      <div style="font-weight:600;margin-top:12px">${esc(card.headline)}</div>
      <p style="margin:6px 0 16px;line-height:1.5">${esc(card.summary)}</p>
    </td></tr>
    ${rows}
    <tr><td style="padding-top:16px;border-top:1px solid #e5e7eb">
      <div style="font-weight:600;margin-bottom:6px">Practice next</div>
      <ol style="margin:0;padding-left:20px;line-height:1.6">${(card.next_steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    </td></tr>
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
