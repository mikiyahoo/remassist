/**
 * Posts whose article body still lives in a React component rather than in the
 * database.
 *
 * app/blog/[slug]/ArticleBody.tsx is 436 lines of JSX — headings, nested lists,
 * a blockquote, entities. Converting that to stored text by pattern-matching
 * would very likely produce a subtly broken article and report success, so it
 * was left where it is when the content was imported.
 *
 * This set is the bridge, and it is deliberately a single shared fact rather
 * than a condition repeated in two places. Two things read it: the publish
 * guard, which must not refuse to publish a post that plainly has a body; and
 * the public renderer, which must render the component for these slugs and the
 * stored text for everything else.
 *
 * It should shrink to nothing. When somebody wants to edit this article, the
 * honest move is to convert it once, by hand, check it, and drop the slug.
 */
export const LEGACY_BODY_SLUGS: ReadonlySet<string> = new Set([
  'hiring-offshore-without-losing-quality-control',
]);

export function hasLegacyBody(slug: string): boolean {
  return LEGACY_BODY_SLUGS.has(slug);
}

/** Whether a post can go on the blog: it needs words, from either source. */
export function isPublishable(slug: string, body: string | null): boolean {
  return hasLegacyBody(slug) || Boolean(body && body.trim().length > 0);
}
