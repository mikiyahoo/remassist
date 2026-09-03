import { describe, expect, it } from 'vitest';
import seed from '@/db/content-seed.json';

/**
 * The build-time fallback's data.
 *
 * .github/workflows runs `npm run build` with no DATABASE_URL, and /faq is
 * prerendered, so getFaq falls back to db/content-seed.json. If that file is
 * ever wrong or short, CI ships an empty FAQ page and nobody notices until the
 * site is live.
 *
 * Asserted against the JSON directly rather than by calling getFaq with the
 * environment temporarily broken. An earlier version of this file deleted
 * process.env.DATABASE_URL around each test and passed in isolation while
 * failing in the full suite: vitest runs test files concurrently and they share
 * process.env, so this file, lib/auth/require.test.ts and lib/auth/mailer.test.ts
 * were overwriting each other's variables. A test that has to mutate global
 * state to run is a test that will eventually fail for reasons unrelated to the
 * code it covers.
 *
 * What that costs: the one-line `if (!isDatabaseConfigured()) return fromSeed()`
 * branch is not executed here. It is covered by inspection, on the same
 * reasoning as the note at the foot of lib/auth/session.test.ts — the value was
 * always in the data being complete, not in the branch being taken.
 */
describe('the FAQ seed that CI builds from', () => {
  it('has every group and question', () => {
    expect(seed.faqGroups).toHaveLength(6);
    expect(seed.faqItems).toHaveLength(29);
  });

  it('keeps the group blurbs and source links', () => {
    // These were nearly lost in the cutover: faq_groups had no column for them,
    // so every count matched while six lines of visible copy would have gone.
    for (const g of seed.faqGroups) {
      expect(g.blurb, g.slug).toBeTruthy();
      expect(g.linkHref, g.slug).toBeTruthy();
      expect(g.linkLabel, g.slug).toBeTruthy();
    }
  });

  it('keeps the anchors the jump nav links to, in order', () => {
    // The slugs are hrefs. Changing one silently breaks a link on the page.
    expect(seed.faqGroups.map((g) => g.slug)).toEqual([
      'pricing', 'starting', 'people', 'tools-data', 'scope', 'oversight',
    ]);
  });

  it('has no empty question or answer', () => {
    for (const i of seed.faqItems) {
      expect(i.question.trim().length, i.groupSlug).toBeGreaterThan(0);
      expect(i.answer.trim().length, i.question).toBeGreaterThan(0);
    }
  });

  it('assigns every question to a group that exists', () => {
    const slugs = new Set(seed.faqGroups.map((g) => g.slug));
    for (const i of seed.faqItems) expect(slugs.has(i.groupSlug), i.groupSlug).toBe(true);
  });
});
