import { describe, expect, it } from 'vitest';
import {
  INVITE_TTL_SEC, generateInviteToken, hasLiveCode, hashInviteToken, inviteCodeExpiry,
  inviteExpiry, invitePath, inviteRefusal, isWellFormedInviteToken,
} from './invite';

describe('generateInviteToken', () => {
  it('is 43 base64url characters — 32 bytes, no padding, URL-path safe', () => {
    for (let i = 0; i < 500; i++) {
      const token = generateInviteToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // '+' and '/' would need escaping in a path segment and '=' would be
      // stripped by some mail clients rewriting the link.
      expect(token).not.toMatch(/[+/=]/);
    }
  });

  it('does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateInviteToken());
    expect(seen.size).toBe(2000);
  });
});

describe('hashInviteToken', () => {
  it('is stable, so a row can be found by the hash of a presented token', () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });

  it('never returns the token it was given', () => {
    // The whole point of the column: a database dump must not be a stack of
    // usable invitations.
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates tokens that differ by one character', () => {
    expect(hashInviteToken('a')).not.toBe(hashInviteToken('b'));
  });
});

describe('isWellFormedInviteToken', () => {
  it('accepts what the generator produces', () => {
    for (let i = 0; i < 200; i++) {
      expect(isWellFormedInviteToken(generateInviteToken())).toBe(true);
    }
  });

  it('rejects the shapes that turn up in a hand-edited URL', () => {
    for (const v of [
      '', 'short', 'x'.repeat(42), 'x'.repeat(44),
      // A hash presented as a token — 64 hex characters, the wrong length.
      hashInviteToken('anything'),
      // Path traversal and SQL-ish punctuation, neither of which can reach a
      // query if the shape is checked first.
      '../'.repeat(14) + 'x', "'; drop table invitations; --",
    ]) {
      expect(isWellFormedInviteToken(v), JSON.stringify(v)).toBe(false);
    }
  });
});

describe('expiry helpers', () => {
  const now = new Date('2026-09-01T12:00:00Z');

  it('sets the invitation a week out', () => {
    expect(inviteExpiry(now).getTime() - now.getTime()).toBe(INVITE_TTL_SEC * 1000);
  });

  it('sets the code fifteen minutes out — far shorter than the invitation', () => {
    const code = inviteCodeExpiry(now).getTime() - now.getTime();
    expect(code).toBe(15 * 60 * 1000);
    expect(code).toBeLessThan(INVITE_TTL_SEC * 1000);
  });
});

describe('inviteRefusal', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const future = new Date('2026-09-05T12:00:00Z');
  const past = new Date('2026-08-30T12:00:00Z');

  it('allows a fresh, unaccepted invitation', () => {
    expect(inviteRefusal({ acceptedAt: null, expiresAt: future }, now)).toBeNull();
  });

  it('refuses one that expired', () => {
    expect(inviteRefusal({ acceptedAt: null, expiresAt: past }, now)).toBe('expired');
  });

  it('refuses one already accepted', () => {
    expect(inviteRefusal({ acceptedAt: past, expiresAt: future }, now)).toBe('accepted');
  });

  it('reports an accepted-and-expired invitation as accepted', () => {
    // Ordering matters for what the page says. "Expired" invites the person to
    // ask for a new link; "accepted" tells them the account already exists and
    // they should sign in, which is the true and more useful answer.
    expect(inviteRefusal({ acceptedAt: past, expiresAt: past }, now)).toBe('accepted');
  });

  it('treats the exact expiry instant as expired', () => {
    expect(inviteRefusal({ acceptedAt: null, expiresAt: now }, now)).toBe('expired');
  });
});

describe('hasLiveCode', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const soon = new Date('2026-09-01T12:10:00Z');
  const gone = new Date('2026-09-01T11:50:00Z');

  it('is false before a code has ever been issued', () => {
    expect(hasLiveCode({ codeHash: null, codeExpiresAt: null }, now)).toBe(false);
  });

  it('is true for an unexpired issued code', () => {
    expect(hasLiveCode({ codeHash: 'scrypt$...', codeExpiresAt: soon }, now)).toBe(true);
  });

  it('is false once it expires', () => {
    expect(hasLiveCode({ codeHash: 'scrypt$...', codeExpiresAt: gone }, now)).toBe(false);
  });

  it('is false for a half-written row rather than throwing', () => {
    // Neither column is enforced against the other, so both orders of a
    // partial write have to be survivable.
    expect(hasLiveCode({ codeHash: 'scrypt$...', codeExpiresAt: null }, now)).toBe(false);
    expect(hasLiveCode({ codeHash: null, codeExpiresAt: soon }, now)).toBe(false);
  });
});

describe('invitePath', () => {
  it('puts the token in the path, never a query string', () => {
    // A query string lands in access logs and Referer headers far more readily
    // than a path does, and this one creates an account.
    const token = generateInviteToken();
    expect(invitePath(token)).toBe(`/admin/invite/${token}`);
    expect(invitePath(token)).not.toContain('?');
  });
});
