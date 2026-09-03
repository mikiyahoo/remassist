import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { reviewSources, reviews } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';
import { SOURCE_LABEL, Stars, initials } from './display';
import { addReview, saveReviewSource, setReviewPublished } from './actions';
import { reviewMessage } from './messages';
import styles from '../../../admin.module.css';

/**
 * The reviews list — the Test Admin prototype's review cards, one source at a
 * time.
 *
 * This screen used to be a panel per source with a full form inline on every
 * row: five fields and a textarea, four times over. The prototype's shape is a
 * list you read, with editing behind an edit button, and that is the right
 * shape here for a reason specific to reviews. The job on this screen is
 * almost never "change a word" — it is "find the one that needs checking, or
 * take one down". A list of quotes serves both; a stack of forms serves
 * neither, and it puts a text box under other people's words as the default
 * state of the page.
 *
 * The tabs are the sources. Unlike the FAQ's status tabs, which slice one list
 * two ways, these separate two lists that were never really one: sortOrder is
 * per source, the public page renders them as two blocks, and a Trustpilot
 * review and a Google review are never compared with each other. A combined
 * view would have to invent an order across sources that means nothing.
 *
 * The last tab is not a filter. Sources holds the per-source figures — profile
 * link, the score the source publishes, the footnote the cards are read
 * against — which are about the two sources rather than about any one review,
 * and are touched roughly never. A tab is how they stay reachable without
 * sitting above the list competing for attention.
 *
 * Three deliberate departures from the mockup:
 *
 *  - No "Sync from source" button, and the rows do not say "Synced". There is
 *    no sync. Every review here was transcribed by hand from Trustpilot or
 *    Google, and a button promising to re-pull a feed that does not exist is
 *    the one thing on this screen worse than no button at all. The primary
 *    action is Add review, and the pill says Published or Hidden, which is the
 *    state the row actually has.
 *  - The mockup called the screen read-only. It is not, and that is a decision
 *    taken against MIGRATION-PLAN §6.5, which specified no create or edit path
 *    at all. What §6.5 was protecting against — a general-purpose CMS box that
 *    makes fabricating a testimonial easy — is answered instead by saying on
 *    the page what these fields are for, by keeping every source link required
 *    and resolvable, and by never deleting. Somebody has to be able to fix a
 *    transcription error, and doing it by hand in SQL is not safer.
 *  - The second row action hides rather than deletes. Content on this site is
 *    taken off the page and kept — see canUnpublishContent in
 *    lib/auth/roles.ts. It matters more here than anywhere else: a review that
 *    has been taken down is still the record of what the site once quoted
 *    somebody as saying.
 *
 * Both roles may edit content; the gate is re-checked inside every action,
 * because a server action renders outside this page.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Reviews',
  robots: { index: false, follow: false },
};

/** The tab that is not a source. */
const SOURCES_TAB = 'sources';

export default async function ReviewsListPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; tab?: string; add?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const message = reviewMessage(sp.ok, sp.error);
  const mayEdit = canEditContent(user.role);

  if (!isDatabaseConfigured()) {
    return (
      <>
        <Topbar sub="Database not configured" />
        <div className={styles.view}>
          <div className={styles.notice}>
            <strong>No database configured</strong>
            There is no <code>DATABASE_URL</code> in this environment, so there is nothing to
            edit.
          </div>
        </div>
      </>
    );
  }

  const db = getDb();
  const [sources, rows] = await Promise.all([
    db.select().from(reviewSources).orderBy(asc(reviewSources.sortOrder)),
    /* sortOrder is per source — the index is (source, sort_order) and moveReview
       only ever swaps siblings — so this order is only meaningful once the rows
       have been narrowed to one source, which the tab does. */
    db.select().from(reviews).orderBy(asc(reviews.sortOrder)),
  ]);

  /* A tab from the query string is only honoured if it names a source that
     exists, so a hand-typed ?tab= lands on the first source rather than on an
     empty list that looks like lost content. */
  const known = new Set<string>([...sources.map((s) => s.source), SOURCES_TAB]);
  const fallback = sources[0]?.source ?? SOURCES_TAB;
  const tab = sp.tab && known.has(sp.tab) ? sp.tab : fallback;
  const onSources = tab === SOURCES_TAB;

  const source = sources.find((s) => s.source === tab);
  const items = rows.filter((r) => r.source === tab);
  const live = items.filter((r) => r.published).length;
  const adding = mayEdit && !onSources && sp.add === '1';

  const href = (next: string, add?: '1') =>
    `/admin/content/reviews?tab=${next}${add ? '&add=1' : ''}`;

  return (
    <>
      <Topbar
        sub={`${rows.length} reviews, ${rows.filter((r) => r.published).length} live`}
      />

      <div className={styles.view}>
        {message && (
          <p
            className={`${styles.signinMsg} ${message.tone === 'ok' ? styles.msgOk : styles.msgErr}`}
            role="status"
          >
            {message.text}
          </p>
        )}

        <div className={`${styles.notice} ${styles.section}`}>
          <strong>These are other people&rsquo;s words</strong>
          Every review here was written by a named person on Trustpilot or Google. The fields
          behind Edit are for correcting a transcription error, not for improving the wording — a
          review that does not match its source is a fabricated testimonial. Hide one to take it
          off the page; nothing here deletes.
          <br />
          <code>/reviews</code> reads from the database, and saving revalidates it, so a
          correction is visible to visitors straight away.
        </div>

        <div className={styles.filterbar}>
          <div className={styles.filterPills} role="group" aria-label="Choose a review source">
            {sources.map((s) => (
              <Tab
                key={s.source}
                href={href(s.source)}
                on={tab === s.source}
                label={SOURCE_LABEL[s.source] ?? s.source}
                count={rows.filter((r) => r.source === s.source).length}
              />
            ))}
            {/* No count: it would be the number of sources, which is the number
                of tabs to its left. */}
            <Tab href={href(SOURCES_TAB)} on={onSources} label="Sources" />
          </div>

          {mayEdit && !onSources && (
            <Link
              className={`${styles.btn} ${styles.btnGhost} ${styles.filterEnd}`}
              href={adding ? href(tab) : href(tab, '1')}
            >
              {adding ? 'Cancel' : '+ Add review'}
            </Link>
          )}
        </div>

        {onSources ? (
          <SourcesTab sources={sources} mayEdit={mayEdit} />
        ) : (
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>
                  {SOURCE_LABEL[tab] ?? tab} reviews
                </h2>
                <p className={styles.panelSub}>
                  Rated {source?.ratingLabel} · {items.length} transcribed, {live} live
                </p>
              </div>
            </div>

            {/* The footnote is the caveat the public cards are read against —
                which review was removed by its author, whose dates are
                relative. Shown with the list it applies to, because an editor
                deciding whether a row looks wrong needs it here, not behind the
                Sources tab where it is edited. */}
            {source?.footnote && <p className={styles.panelIntro}>{source.footnote}</p>}

            {/* Revealed by the filter bar's own button rather than always
                present: an add-form per source is part of what made the old
                page long, and the source is the tab you are standing on. */}
            {adding && (
              <form className={styles.stackWide} action={addReview}>
                <input type="hidden" name="source" value={tab} />
                <div className={styles.inviteRow} style={{ padding: 0 }}>
                  <div className={`${styles.field} ${styles.grow}`}>
                    <label className={styles.fieldLabel} htmlFor="nau">
                      Author, as {SOURCE_LABEL[tab] ?? tab} prints it
                    </label>
                    <input
                      className={styles.control}
                      id="nau"
                      name="author"
                      maxLength={200}
                      required
                      autoFocus
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="ndt">Date</label>
                    <input
                      className={styles.control}
                      id="ndt"
                      name="dateText"
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="nra">Rating</label>
                    <input
                      className={styles.control}
                      id="nra"
                      name="rating"
                      type="number"
                      min={1}
                      max={5}
                      defaultValue={5}
                      required
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="nbd">
                    Review text, copied verbatim from {SOURCE_LABEL[tab] ?? tab}
                  </label>
                  <textarea
                    className={styles.textarea}
                    id="nbd"
                    name="body"
                    rows={4}
                    maxLength={4000}
                    required
                  />
                </div>
                <div className={styles.rowActions} style={{ padding: 0 }}>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                    Add review
                  </button>
                  <span className={styles.panelNote}>
                    {/* The meta line and the Trustpilot headline are on the
                        edit page. Three fields and the quote is what it takes
                        to have a row at all; the rest is easier to fill in
                        beside the original once the row exists. */}
                    Added hidden, so you can check it against the original first
                  </span>
                </div>
              </form>
            )}

            {items.length === 0 ? (
              <p className={styles.empty}>
                <strong>No {SOURCE_LABEL[tab] ?? tab} reviews yet</strong>
                Use &ldquo;Add review&rdquo; above to transcribe the first one.
              </p>
            ) : (
              items.map((r) => (
                <div className={styles.review} key={r.id}>
                  <span
                    className={`${styles.avatar} ${r.source === 'google' ? styles.avatarAlt : ''}`}
                    aria-hidden="true"
                  >
                    {initials(r.author)}
                  </span>

                  <div className={styles.reviewMain}>
                    <Stars rating={r.rating} />
                    {r.headline && <p className={styles.reviewHead}>{r.headline}</p>}
                    <p className={styles.reviewText}>&ldquo;{r.body}&rdquo;</p>
                    <div className={styles.reviewMeta}>
                      <b>{r.author}</b>
                      {r.meta && <span>{r.meta}</span>}
                      <span aria-hidden="true">·</span>
                      <span>{r.dateText}</span>
                      <span
                        className={`${styles.pill} ${r.published ? styles.pillLow : styles.pillMed}`}
                      >
                        {r.published ? 'Published' : 'Hidden'}
                      </span>
                    </div>
                  </div>

                  {mayEdit && (
                    <div className={styles.reviewActions}>
                      <Link
                        className={styles.iconBtn}
                        href={`/admin/content/reviews/${r.id}`}
                        aria-label={`Edit the review by ${r.author}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </svg>
                      </Link>

                      <form action={setReviewPublished}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="published" value={r.published ? '0' : '1'} />
                        <button
                          className={styles.iconBtn}
                          type="submit"
                          aria-label={
                            r.published
                              ? `Hide the review by ${r.author} from the reviews page`
                              : `Show the review by ${r.author} on the reviews page`
                          }
                        >
                          {r.published ? (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M3 3l18 18" />
                              <path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7 0 .8-.5 1.9-1.4 3" />
                              <path d="M6.3 6.9C3.9 8.4 3 10.4 3 12c0 2.5 4 7 9 7 1.6 0 3-.4 4.2-1" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))
            )}

            <div className={styles.panelFoot}>
              <span>
                Reorder from a review&rsquo;s edit page &mdash; the public page follows
                immediately after save. Hiding keeps the wording; nothing here deletes.
              </span>
              <Link className={styles.rowLink} href="/reviews">View the public page</Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The Sources tab: the figures the review cards are printed under.
 *
 * Read-only for a viewer rather than hidden from them. The star score and the
 * footnote explain what is on the public page, so somebody who cannot change
 * them still needs to be able to read them.
 */
function SourcesTab({
  sources,
  mayEdit,
}: {
  sources: Array<{
    source: string;
    url: string;
    stars: number;
    ratingLabel: string;
    footnote: string | null;
  }>;
  mayEdit: boolean;
}) {
  return (
    <div className={styles.sourcesGrid}>
      {sources.map((s) => {
        const label = SOURCE_LABEL[s.source] ?? s.source;
        return (
          <section className={`${styles.panel} ${styles.section}`} key={s.source}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>{label}</h2>
                <p className={styles.panelSub}>
                  What the reviews page prints above the {label} cards
                </p>
              </div>
              <a
                className={styles.rowLink}
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open the profile ↗
              </a>
            </div>

            <form className={styles.stackWide} action={saveReviewSource}>
              <input type="hidden" name="source" value={s.source} />
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`u-${s.source}`}>
                  {/* Required and validated as a real URL in saveReviewSource:
                      a testimonial section citing a source nobody can follow is
                      just a claim. */}
                  Link to the source profile
                </label>
                <input
                  className={styles.control}
                  id={`u-${s.source}`}
                  name="url"
                  type="url"
                  defaultValue={s.url}
                  required
                  readOnly={!mayEdit}
                />
              </div>
              <div className={styles.inviteRow} style={{ padding: 0 }}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor={`rl-${s.source}`}>
                    Rating label, as {label} words it
                  </label>
                  <input
                    className={styles.control}
                    id={`rl-${s.source}`}
                    name="ratingLabel"
                    defaultValue={s.ratingLabel}
                    required
                    readOnly={!mayEdit}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor={`st-${s.source}`}>Stars</label>
                  <input
                    className={styles.control}
                    id={`st-${s.source}`}
                    name="stars"
                    type="number"
                    min={1}
                    max={5}
                    defaultValue={s.stars}
                    required
                    readOnly={!mayEdit}
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`fn-${s.source}`}>
                  Footnote — anything the reader needs in order to read the cards correctly
                </label>
                <textarea
                  className={styles.textarea}
                  id={`fn-${s.source}`}
                  name="footnote"
                  rows={3}
                  defaultValue={s.footnote ?? ''}
                  readOnly={!mayEdit}
                />
              </div>
              {mayEdit && (
                <div className={styles.rowActions} style={{ padding: 0 }}>
                  <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                    Save {label} details
                  </button>
                </div>
              )}
            </form>
          </section>
        );
      })}
    </div>
  );
}

/** One tab. A link, not a button: which source you are looking at belongs in the URL. */
function Tab({ href, on, label, count }: {
  href: string;
  on: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      className={`${styles.fbtn} ${on ? styles.fbtnOn : ''}`}
      href={href}
      aria-current={on ? 'true' : undefined}
    >
      {label}
      {count !== undefined && <span className={styles.fbtnCount}>{count}</span>}
    </Link>
  );
}

function Topbar({ sub }: { sub: string }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>Reviews</h1>
          <p className={styles.tbSub}>{sub}</p>
        </div>
      </div>
    </header>
  );
}
