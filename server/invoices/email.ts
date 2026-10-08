/**
 * Outbound invoice email through Resend (https://resend.com/docs/api-reference/emails/send-email).
 *
 * Env:
 *   RESEND_API_KEY         API key. Unset → sending is off (PDF download and share links still work).
 *   INVOICE_EMAIL_FROM     Sender address on the app's verified domain, e.g. invoices@mail.example.nz
 *   INVOICE_SEND_HOURLY_LIMIT / INVOICE_SEND_DAILY_LIMIT   Per-user caps (defaults 10 / 30).
 *
 * The From display name is the user's business name; Reply-To is the user's own email,
 * so replies reach them, not the app.
 */

export type OutboundEmail = {
  fromName: string;
  replyTo: string | null;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachment: { filename: string; content: Uint8Array } | null;
  idempotencyKey: string;
};

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

export function emailConfig(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.INVOICE_EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export function emailEnabled(): boolean {
  return emailConfig() != null;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function sendLimits(): { hourly: number; daily: number } {
  return {
    hourly: positiveInt(process.env.INVOICE_SEND_HOURLY_LIMIT, 10),
    daily: positiveInt(process.env.INVOICE_SEND_DAILY_LIMIT, 30),
  };
}

/** Display name safe for a From header: no quotes, angle brackets or line breaks. */
export function safeDisplayName(name: string): string {
  return name.replace(/["<>\r\n\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) || 'Invoice';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain message → simple HTML (escaped, line breaks kept, share link clickable). */
export function messageHtml(message: string, link: string | null): string {
  const body = escapeHtml(message).replace(/\n/g, '<br>');
  const linkHtml = link ? `<p><a href="${escapeHtml(link)}">View the invoice online</a></p>` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f1f1f">${body}${linkHtml}</div>`;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

let fetchImpl: FetchLike = (url, init) => fetch(url, init);

/** Tests only: swap the HTTP client. */
export function setEmailFetchForTest(f: FetchLike | null): void {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
}

export async function sendEmail(mail: OutboundEmail): Promise<SendResult> {
  const cfg = emailConfig();
  if (!cfg) return { ok: false, error: 'Email sending is not set up on this server.' };
  const body: Record<string, unknown> = {
    from: `${safeDisplayName(mail.fromName)} <${cfg.from}>`,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  };
  if (mail.replyTo) body.reply_to = mail.replyTo;
  if (mail.attachment) {
    body.attachments = [
      { filename: mail.attachment.filename, content: Buffer.from(mail.attachment.content).toString('base64') },
    ];
  }
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': mail.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: json.message ? `Email provider: ${json.message}` : `Email provider error (${res.status})` };
    return { ok: true, id: typeof json.id === 'string' ? json.id : null };
  } catch {
    return { ok: false, error: 'Could not reach the email provider. Try again shortly.' };
  }
}
