#!/usr/bin/env node
/**
 * Read today's hardcoded site content out of app/ and write it to
 * db/content-seed.json.
 *
 *   node --experimental-strip-types tools/extract-content.mjs
 *
 * Development only, and run once rather than on every seed. The output is
 * committed on purpose: it is the artifact a human can diff against the source
 * files to confirm nothing was dropped or mangled, which is not something you
 * can check by reading a parser. The seeder then only has to read JSON, which
 * keeps it portable to the VPS's Node 20.
 *
 * Post BODIES are deliberately not extracted. app/blog/[slug]/ArticleBody.tsx
 * is 436 lines of JSX with classNames, entities and nested lists; converting it
 * to HTML by pattern-matching would very likely produce a subtly broken article
 * and call it a success. Bodies stay null, the cutover keeps rendering that
 * component for its slug, and new posts written in the admin get stored HTML.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

/** Turn a JS string literal's escapes back into the characters they stand for. */
function unquote(raw) {
  return raw
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

/* ── Posts: imported, not parsed ───────────────────────────────────────── */
/* lib/blog/posts.ts exports POSTS as plain data, so it can be imported and
   read exactly. No regex, no risk of a missed field. */
const { POSTS } = await import('../lib/blog/posts.ts');
const posts = POSTS.map((p, i) => ({
  slug: p.slug,
  title: p.title,
  excerpt: p.excerpt,
  body: null,
  date: p.date,
  readTime: p.readTime,
  category: p.category,
  image: p.image,
  authorName: p.author.name,
  authorAvatar: p.author.avatar,
  published: p.published,
  sortOrder: i,
}));

/* ── Reviews: SOURCES is not exported and holds JSX, so parse it ────────── */
const reviewsSrc = read('app/reviews/page.tsx');

const sourceMeta = {
  trustpilot: { ratingLabel: 'Excellent', sortOrder: 0 },
  google: { ratingLabel: '5.0', sortOrder: 1 },
};

const reviewSources = [];
const reviews = [];

for (const key of ['trustpilot', 'google']) {
  /* Each source block runs from its id to the start of the next, or to the end
     of the array. Anchoring on `id: '<key>'` rather than on position means a
     reordering of the file does not silently swap the two. */
  const block = reviewsSrc.split(`id: '${key}'`)[1];
  if (!block) throw new Error(`no source block for ${key}`);

  const url = /url: ([A-Z_]+)/.exec(block)?.[1];
  const urlValue = url
    ? new RegExp(`const ${url} = '([^']+)'`).exec(reviewsSrc)?.[1]
    : undefined;
  if (!urlValue) throw new Error(`no url for ${key}`);

  const stars = Number(/rating: (\d+)/.exec(block)?.[1]);
  const footnote = /footnote:\s*\n?\s*'((?:[^']|\\')*)'/.exec(block)?.[1];

  reviewSources.push({
    source: key,
    url: urlValue,
    stars,
    ratingLabel: sourceMeta[key].ratingLabel,
    footnote: footnote ? unquote(footnote) : null,
    sortOrder: sourceMeta[key].sortOrder,
  });

  /* Every { author: ... } object inside this source's block. */
  const items = block.split('reviews: [')[1] ?? '';
  const objects = items.split(/\n\s{6}\{/).slice(1);
  objects.forEach((o, i) => {
    const field = (name) => {
      const m = new RegExp(`${name}:\\s*\\n?\\s*'((?:[^']|\\\\')*)'`).exec(o);
      return m ? unquote(m[1]) : undefined;
    };
    const author = field('author');
    if (!author) return;
    reviews.push({
      source: key,
      author,
      meta: field('meta'),
      dateText: field('date'),
      headline: field('headline') ?? null,
      body: field('body'),
      rating: Number(/rating: (\d+)/.exec(o)?.[1] ?? 5),
      sortOrder: i,
      published: true,
    });
  });
}

/* ── FAQ: raw <details> markup, one <p> answer each ────────────────────── */
const faqSrc = read('app/faq/page.tsx');

const faqGroups = [];
const faqItems = [];

/* Split on the section openers so each chunk is exactly one group. */
const sections = faqSrc.split(/<section id='([a-z-]+)' className=\{styles\['rs-group'\]\}>/).slice(1);
for (let i = 0; i < sections.length; i += 2) {
  const slug = sections[i];
  const chunk = sections[i + 1];
  const title = /<h2 className=\{styles\['rs-h2'\]\}>([^<]+)<\/h2>/.exec(chunk)?.[1];
  if (!title) throw new Error(`no title for faq group ${slug}`);

  /* The line under the heading, and the "Pricing page →" link beside it. Both
     are content the page renders today, so a cutover that dropped them would
     lose visible copy while every count still matched. */
  const head = /<div className=\{styles\['rs-group-head'\]\}>([\s\S]*?)<\/div>\s*<\/div>/.exec(chunk)?.[1] ?? chunk;
  const blurb = /<p>([\s\S]*?)<\/p>/.exec(head)?.[1]?.trim() ?? null;
  const link = /<a className=\{styles\['rs-source'\]\} href='([^']+)'>([^<]+)<\/a>/.exec(chunk);

  faqGroups.push({
    slug,
    title,
    blurb,
    linkHref: link?.[1] ?? null,
    linkLabel: link?.[2]?.trim() ?? null,
    sortOrder: faqGroups.length,
  });

  const pairs = [...chunk.matchAll(
    /<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g,
  )];
  pairs.forEach(([, question, answer], n) => {
    faqItems.push({
      groupSlug: slug,
      question: question.trim(),
      answer: answer.trim(),
      sortOrder: n,
      published: true,
    });
  });
}

const out = { posts, reviewSources, reviews, faqGroups, faqItems };
writeFileSync('db/content-seed.json', `${JSON.stringify(out, null, 2)}\n`, 'utf8');

console.log('db/content-seed.json written');
console.log(`  posts          ${posts.length} (${posts.filter((p) => p.published).length} published, 0 bodies by design)`);
console.log(`  review sources ${reviewSources.length}`);
console.log(`  reviews        ${reviews.length}`);
console.log(`  faq groups     ${faqGroups.length}`);
console.log(`  faq items      ${faqItems.length}`);

/* Fail loudly on anything that parsed to an empty field, because a silent
   undefined here becomes a NOT NULL violation at seed time at best, and a
   published page with a blank answer at worst. */
const holes = [
  ...reviews.filter((r) => !r.author || !r.meta || !r.dateText || !r.body).map((r) => `review ${r.author}`),
  ...faqItems.filter((f) => !f.question || !f.answer).map((f) => `faq ${f.question}`),
  ...faqGroups.filter((g) => !g.blurb || !g.linkHref || !g.linkLabel).map((g) => `faq group ${g.slug} (blurb or link)`),
  ...posts.filter((p) => !p.slug || !p.title || !p.excerpt).map((p) => `post ${p.slug}`),
];
if (holes.length) {
  console.error(`\n  INCOMPLETE: ${holes.length} record(s) have empty fields:`);
  for (const h of holes) console.error(`    ${h}`);
  process.exit(1);
}
console.log('  every record has its required fields');
