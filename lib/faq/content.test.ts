import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The build-time fallback.
 *
 * .github/workflows runs `npm run build` with no DATABASE_URL, and /faq is
 * prerendered, so without this path CI either fails or ships an empty FAQ page.
 * That is a failure nobody would notice until the site was live, which is
 * exactly the kind worth pinning in a test.
 *
 * The module is imported fresh in each test because it reads process.env
 * through isDatabaseConfigured at call time.
 */
describe('getFaq with no database', () => {
  const saved = process.env.DATABASE_URL;

  beforeEach(() => { delete process.env.DATABASE_URL; });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  it('falls back to the seed rather than returning nothing', async () => {
    const { getFaq } = await import('./content');
    const groups = await getFaq();
    expect(groups).toHaveLength(6);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(29);
  });

  it('keeps the group blurbs and source links', async () => {
    // These were nearly lost in the cutover: the schema had no column for them,
    // so every count matched while six lines of visible copy would have gone.
    const { getFaq } = await import('./content');
    for (const g of await getFaq()) {
      expect(g.blurb, g.slug).toBeTruthy();
      expect(g.linkHref, g.slug).toBeTruthy();
      expect(g.linkLabel, g.slug).toBeTruthy();
    }
  });

  it('keeps the anchors the jump nav links to', async () => {
    // The slugs are hrefs. Changing one silently breaks a link on the page.
    const { getFaq } = await import('./content');
    const slugs = (await getFaq()).map((g) => g.slug);
    expect(slugs).toEqual(['pricing', 'starting', 'people', 'tools-data', 'scope', 'oversight']);
  });

  it('never returns an unpublished question', async () => {
    const { getFaq } = await import('./content');
    const groups = await getFaq();
    for (const g of groups) for (const i of g.items) {
      expect(i.question.length, 'a rendered question must not be empty').toBeGreaterThan(0);
      expect(i.answer.length, 'a rendered answer must not be empty').toBeGreaterThan(0);
    }
  });
});
