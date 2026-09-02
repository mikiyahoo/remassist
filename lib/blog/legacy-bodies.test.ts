import { describe, expect, it } from 'vitest';
import { LEGACY_BODY_SLUGS, hasLegacyBody, isPublishable } from './legacy-bodies';

describe('legacy bodies', () => {
  it('names the one article that still lives in a component', () => {
    // If this set grows, something has gone backwards: the direction of travel
    // is to convert an article once, by hand, and drop its slug.
    expect(LEGACY_BODY_SLUGS.size).toBe(1);
    expect(hasLegacyBody('hiring-offshore-without-losing-quality-control')).toBe(true);
  });

  it('does not claim a body for anything else', () => {
    expect(hasLegacyBody('role-scorecard-define-a-remote-hire-in-one-page')).toBe(false);
    expect(hasLegacyBody('')).toBe(false);
  });
});

describe('isPublishable', () => {
  it('allows the legacy article even with no stored body', () => {
    // The guard exists to stop an empty post going live. Without this branch it
    // would also refuse to publish the one article that is already live.
    expect(isPublishable('hiring-offshore-without-losing-quality-control', null)).toBe(true);
  });

  it('allows any post that has stored words', () => {
    expect(isPublishable('anything', 'Some real copy.')).toBe(true);
  });

  it('refuses a post with no body from either source', () => {
    for (const body of [null, '', '   ', '\n\n']) {
      expect(isPublishable('a-new-post', body), JSON.stringify(body)).toBe(false);
    }
  });
});
