// Invitation emails via Resend's REST API (no SDK dependency needed).
// With the test sender (onboarding@resend.dev) Resend only delivers to the
// account owner's own address — verify a domain and change FROM for real
// guests. Without RESEND_API_KEY, sending is skipped and invitations still
// get created; they just stay in-app only.
const logger = require('./logger');

const FROM = 'E-vite <onboarding@resend.dev>';
const SEND_TIMEOUT_MS = 10 * 1000;

function appBaseUrl() {
    return (process.env.APP_BASE_URL || 'https://e-vite-vert.vercel.app').replace(/\/+$/, '');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

async function sendInvitationEmail({ to, inviterName, event, token }) {
    if (!process.env.RESEND_API_KEY) {
        logger.warn('RESEND_API_KEY not set — invitation email not sent');
        return false;
    }

    const rsvpUrl = `${appBaseUrl()}/invite?token=${encodeURIComponent(token)}`;
    const when = [event.event_date, event.event_time && event.event_time.slice(0, 5)]
        .filter(Boolean).join(' · ');
    const title = escapeHtml(event.title || 'an event');

    const html = `
<div style="font-family: 'Courier New', monospace; color: #111; max-width: 560px; margin: 0 auto;">
  <pre style="margin: 0 0 16px;">+----------------------------+
|        E - V I T E         |
+----------------------------+</pre>
  <p><b>${escapeHtml(inviterName)}</b> invited you to:</p>
  <div style="border: 1px dashed #111; padding: 14px 16px; margin: 12px 0;">
    <div style="font-weight: bold; font-size: 1.1em;">${title}</div>
    ${when ? `<div>When: ${escapeHtml(when)}</div>` : ''}
    ${event.location ? `<div>Where: ${escapeHtml(event.location)}</div>` : ''}
    ${event.description ? `<div style="margin-top: 6px;">${escapeHtml(event.description)}</div>` : ''}
  </div>
  <p>
    <a href="${rsvpUrl}" style="display: inline-block; border: 1px dashed #111; padding: 10px 22px; color: #111; text-decoration: none; font-weight: bold;">[ VIEW &amp; RSVP ]</a>
  </p>
  <p style="color: #777; font-size: 0.85em;">No account needed to RSVP. This invitation was sent through E-vite.</p>
</div>`;

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: FROM,
            to: [to],
            subject: `You're invited: ${event.title || 'an event'}`,
            html,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        logger.error(`Resend send to ${to} failed: ${res.status} ${detail.slice(0, 300)}`);
        return false;
    }
    return true;
}

module.exports = { sendInvitationEmail };
