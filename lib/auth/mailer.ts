/**
 * Sending an authentication email — MIGRATION-PLAN §10.
 *
 * Lifted out of auth.ts because there are now two senders: the sign-in code
 * that Auth.js's Resend provider asks for, and the invitation the team screen
 * sends. Both carry a live credential, so both must obey the same rule about
 * never printing one in production — and one copy of that rule is the only
 * safe number of copies.
 */

/** Falls back to the subdomain the sign-in domain is verified under. */
export const DEFAULT_FROM = 'Rem Assist <signin@auth.remconnect.io>';

export function mailFrom(): string {
  return process.env.AUTH_EMAIL_FROM ?? DEFAULT_FROM;
}

/**
 * Whether to print credentials to the terminal instead of emailing them.
 *
 * Both conditions are required, and neither is overridable by configuration:
 *
 *   NODE_ENV !== 'production'  — Next sets this to 'production' in `next build`
 *                                and in the built server, so a deployed
 *                                instance can never take this branch whatever
 *                                its env file says.
 *   no AUTH_RESEND_KEY         — the moment a real key exists, real mail is
 *                                sent, so this cannot linger once configured.
 *
 * The failure mode if this were ever wrong is that working credentials for
 * company addresses get written to the application log, so it is deliberately
 * not switchable by an env var somebody could set by accident.
 *
 * A function rather than a module constant: evaluated at import time it would
 * freeze whatever the environment looked like when the module graph was first
 * walked, which in a test run is before the test has set anything.
 */
export function printLocally(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.AUTH_RESEND_KEY;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Printed to the terminal in place of sending, in local development only.
   * Holds the credential in readable form, which is exactly why printLocally
   * above is not configurable.
   */
  localPreview: string;
}

/**
 * Send, or print locally.
 *
 * Throws on failure rather than swallowing it. A caller that carries on after a
 * failed send tells somebody to check an inbox that will never receive
 * anything, which is worse than an error page: they wait, then they ask, then
 * somebody reads the logs. In production with no key this throws too — a
 * misconfigured admin should be unreachable, not quietly open.
 */
export async function sendAuthEmail(mail: OutboundEmail): Promise<void> {
  if (printLocally()) {
    console.log(mail.localPreview);
    return;
  }

  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) throw new Error('AUTH_RESEND_KEY is not set, so no mail can be sent');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });

  if (!res.ok) throw new Error(`Resend refused the email: ${await res.text()}`);
}
