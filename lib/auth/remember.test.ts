import { describe, expect, it } from 'vitest';
import {
  LONG_SESSION_SEC, SHORT_SESSION_SEC, rememberCookieOptions, sessionMaxAge,
} from './remember';

describe('sessionMaxAge', () => {
  it('gives the long session only on an explicit opt-in', () => {
    expect(sessionMaxAge('1')).toBe(LONG_SESSION_SEC);
  });

  it('falls back to the short session for anything else', () => {
    // An absent, empty or unrecognised cookie must never be a route to a
    // 30-day session — that is the direction this has to fail in.
    expect(sessionMaxAge('0')).toBe(SHORT_SESSION_SEC);
    expect(sessionMaxAge(undefined)).toBe(SHORT_SESSION_SEC);
    expect(sessionMaxAge('')).toBe(SHORT_SESSION_SEC);
    expect(sessionMaxAge('true')).toBe(SHORT_SESSION_SEC);
    expect(sessionMaxAge('yes')).toBe(SHORT_SESSION_SEC);
    expect(sessionMaxAge('01')).toBe(SHORT_SESSION_SEC);
  });

  it('uses the durations the product asked for', () => {
    expect(SHORT_SESSION_SEC).toBe(8 * 60 * 60);
    expect(LONG_SESSION_SEC).toBe(30 * 24 * 60 * 60);
  });
});

describe('rememberCookieOptions', () => {
  it('outlives the session it describes when remembered', () => {
    // It is re-read on every request to size the sliding renewal. If it
    // expired first, a remembered session would quietly shrink to eight hours.
    const opts = rememberCookieOptions(true, true);
    expect(opts.maxAge).toBe(LONG_SESSION_SEC);
  });

  it('is a browser-session cookie when not remembered', () => {
    const opts = rememberCookieOptions(false, true);
    expect('maxAge' in opts).toBe(false);
  });

  it('is httpOnly and lax in both cases', () => {
    for (const remember of [true, false]) {
      const opts = rememberCookieOptions(remember, true);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
    }
  });

  it('only sets secure in production, so local http still works', () => {
    expect(rememberCookieOptions(true, true).secure).toBe(true);
    expect(rememberCookieOptions(true, false).secure).toBe(false);
  });
});
