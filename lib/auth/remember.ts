/**
 * "Keep me signed in" — MIGRATION-PLAN §10.
 *
 * Auth.js has no per-sign-in session length: `session.maxAge` and
 * `cookies.sessionToken.options.maxAge` are both plain numbers resolved once
 * from the config, and neither accepts a function. The only seam is that
 * `NextAuth()` accepts a function of the request, so the whole config — session
 * length included — can be resolved per request. This module holds the small
 * amount of state that decision reads from.
 *
 * Kept free of next-auth and next/headers imports so the durations and the
 * resolver can be unit-tested on their own.
 */

/** Set before sign-in starts, read on every later request to size the session. */
export const REMEMBER_COOKIE = 'admin-remember';

/** Unticked: long enough for a working day, short enough for a shared machine. */
export const SHORT_SESSION_SEC = 8 * 60 * 60;

/** Ticked. */
export const LONG_SESSION_SEC = 30 * 24 * 60 * 60;

/**
 * How often the sliding window is refreshed. At one hour the 8-hour session
 * means "eight hours idle" rather than "signed out mid-task", which is the
 * behaviour people expect from a remember-me checkbox's absence.
 */
export const SESSION_UPDATE_AGE_SEC = 60 * 60;

/**
 * Session length for a request carrying this cookie value.
 *
 * Anything other than an explicit opt-in gets the short session: an absent,
 * empty or unrecognised cookie must not be a route to a 30-day session.
 */
export function sessionMaxAge(cookieValue: string | undefined): number {
  return cookieValue === '1' ? LONG_SESSION_SEC : SHORT_SESSION_SEC;
}

/**
 * Cookie options for the remember flag itself.
 *
 * When remembered it has to outlive the session it describes, because every
 * later request re-reads it to size the sliding renewal — if it expired first,
 * a remembered session would quietly start shrinking to eight hours. When not
 * remembered it is a browser-session cookie, so closing the browser forgets
 * the preference along with the sign-in.
 */
export function rememberCookieOptions(remember: boolean, isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction,
    path: '/',
    ...(remember ? { maxAge: LONG_SESSION_SEC } : {}),
  };
}
