import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

/**
 * What the settings screen can say after an action — MIGRATION-PLAN §10.
 *
 * A fixed set of codes carried in the query string, resolved to text here.
 * The actions never put their own wording in the URL: a redirect parameter
 * rendered back into the page is a reflected-XSS shape, and even escaped it
 * lets anyone hand a colleague a link that makes the admin claim whatever they
 * like. A code that is not in this table renders nothing at all.
 *
 * Separate from actions.ts because a 'use server' module may only export async
 * functions — a constant beside the action it belongs to is a build error.
 */
export const SETTINGS_OK = {
  'password-changed': 'Your password has been changed.',
} as const;

export const SETTINGS_ERR = {
  'password-current': 'That is not your current password.',
  'password-weak': `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase is fine, and easier to remember than a mangled word.`,
  'password-mismatch': 'The two new passwords did not match.',
  'password-same': 'That is already your password.',
  'verify-failed': 'The verification email could not be sent. Ask an administrator to check the mail configuration.',
  'no-database': 'The database is unavailable, so nothing was changed.',
} as const;

export function settingsMessage(
  ok: string | undefined,
  err: string | undefined,
): { text: string; tone: 'ok' | 'err' } | null {
  if (err && err in SETTINGS_ERR) {
    return { text: SETTINGS_ERR[err as keyof typeof SETTINGS_ERR], tone: 'err' };
  }
  if (ok && ok in SETTINGS_OK) {
    return { text: SETTINGS_OK[ok as keyof typeof SETTINGS_OK], tone: 'ok' };
  }
  return null;
}
