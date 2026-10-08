/**
 * Sending an invoice without app email (KAN-71): a mailto: link for the user's own email app.
 * mailto: cannot carry attachments, so the message includes the invoice's share link instead.
 */

/** mailto: link with recipients, subject and body, each percent-encoded. */
export function mailtoHref(to: string[], subject: string, body: string): string {
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${to.map((t) => encodeURIComponent(t)).join(',')}?${q}`;
}
