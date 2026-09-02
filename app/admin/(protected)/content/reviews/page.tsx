import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { reviewSources, reviews } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';
import {
  addReview, moveReview, saveReview, saveReviewSource, setReviewPublished,
} from './actions';
import { reviewMessage } from './messages';
import styles from '../../../admin.module.css';

/**
 * The reviews editor.
 *
 * These rows are quotes from named people on third-party platforms, which makes
 * this screen different from the FAQ one in a way worth stating on the page
 * rather than only in a comment: the fields exist so a transcription error can
 * be corrected, not so the wording can be improved. The banner says that,
 * because an editor who does not know it will reasonably assume otherwise.
 *
 * Logos and tone colours are not editable and are not in the database — they
 * are design, there are two of them, and they change roughly never.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Reviews',
  robots: { index: false, follow: false },
};

const SOURCE_LABEL: Record<string, string> = {
  trustpilot: 'Trustpilot',
  google: 'Google',
};

export default async function ReviewsEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
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
    db.select().from(reviews).orderBy(asc(reviews.source), asc(reviews.sortOrder)),
  ]);

  const bySource = new Map<string, typeof rows>();
  for (const s of sources) bySource.set(s.source, []);
  for (const r of rows) bySource.get(r.source)?.push(r);

  const live = rows.filter((r) => r.published).length;

  return (
    <>
      <Topbar sub={`${rows.length} reviews, ${live} live`} />

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
          are for correcting a transcription error, not for improving the wording — a review
          that does not match its source is a fabricated testimonial. Take one down by
          unpublishing it; nothing here deletes.
          <br />
          The public <code>/reviews</code> page still renders from{' '}
          <code>app/reviews/page.tsx</code> until the cutover, so these edits are not live yet.
        </div>

        {sources.map((s) => {
          const items = bySource.get(s.source) ?? [];
          return (
            <section className={`${styles.panel} ${styles.section}`} key={s.source}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>{SOURCE_LABEL[s.source] ?? s.source}</h2>
                <span className={styles.panelNote}>
                  {items.length} reviews · rated {s.ratingLabel} · {s.stars} stars
                </span>
              </div>

              {mayEdit && (
                <form className={styles.stackWide} action={saveReviewSource}>
                  <input type="hidden" name="source" value={s.source} />
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`u-${s.source}`}>
                      Link to the source profile
                    </label>
                    <input
                      className={styles.control}
                      id={`u-${s.source}`}
                      name="url"
                      type="url"
                      defaultValue={s.url}
                      required
                    />
                  </div>
                  <div className={styles.inviteRow} style={{ padding: 0 }}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor={`rl-${s.source}`}>
                        Rating label
                      </label>
                      <input
                        className={styles.control}
                        id={`rl-${s.source}`}
                        name="ratingLabel"
                        defaultValue={s.ratingLabel}
                        required
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
                      rows={2}
                      defaultValue={s.footnote ?? ''}
                    />
                  </div>
                  <div className={styles.rowActions} style={{ padding: 0 }}>
                    <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                      Save source details
                    </button>
                  </div>
                </form>
              )}

              {items.map((r, n) => (
                <div className={styles.faqRow} key={r.id}>
                  <form className={styles.stackWide} action={saveReview}>
                    <input type="hidden" name="id" value={r.id} />
                    <div className={styles.inviteRow} style={{ padding: 0 }}>
                      <div className={`${styles.field} ${styles.grow}`}>
                        <label className={styles.fieldLabel} htmlFor={`au-${r.id}`}>
                          Author
                          {!r.published && <span className={styles.tag}>Not live</span>}
                        </label>
                        <input className={styles.control} id={`au-${r.id}`} name="author"
                          defaultValue={r.author} maxLength={200} required readOnly={!mayEdit} />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={`me-${r.id}`}>
                          Meta — what the source prints under the name
                        </label>
                        <input className={styles.control} id={`me-${r.id}`} name="meta"
                          defaultValue={r.meta} maxLength={200} readOnly={!mayEdit} />
                      </div>
                    </div>
                    <div className={styles.inviteRow} style={{ padding: 0 }}>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={`dt-${r.id}`}>
                          Date, exactly as the source prints it
                        </label>
                        <input className={styles.control} id={`dt-${r.id}`} name="dateText"
                          defaultValue={r.dateText} maxLength={200} required readOnly={!mayEdit} />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={`ra-${r.id}`}>Rating</label>
                        <input className={styles.control} id={`ra-${r.id}`} name="rating"
                          type="number" min={1} max={5} defaultValue={r.rating} required
                          readOnly={!mayEdit} />
                      </div>
                      <div className={`${styles.field} ${styles.grow}`}>
                        <label className={styles.fieldLabel} htmlFor={`hd-${r.id}`}>
                          Headline — Trustpilot only
                        </label>
                        <input className={styles.control} id={`hd-${r.id}`} name="headline"
                          defaultValue={r.headline ?? ''} maxLength={200} readOnly={!mayEdit} />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor={`bd-${r.id}`}>
                        Review text, verbatim
                      </label>
                      <textarea className={styles.textarea} id={`bd-${r.id}`} name="body"
                        defaultValue={r.body} rows={4} maxLength={4000} required
                        readOnly={!mayEdit} />
                    </div>
                    {mayEdit && (
                      <div className={styles.rowActions} style={{ padding: 0 }}>
                        <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                          Save
                        </button>
                      </div>
                    )}
                  </form>

                  {mayEdit && (
                    <div className={styles.rowActions}>
                      <form action={setReviewPublished}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="published" value={r.published ? '0' : '1'} />
                        <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                          {r.published ? 'Take off the page' : 'Put it live'}
                        </button>
                      </form>
                      <form action={moveReview}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button className={`${styles.btn} ${styles.btnGhost}`} type="submit"
                          disabled={n === 0} aria-label="Move up">↑</button>
                      </form>
                      <form action={moveReview}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button className={`${styles.btn} ${styles.btnGhost}`} type="submit"
                          disabled={n === items.length - 1} aria-label="Move down">↓</button>
                      </form>
                    </div>
                  )}
                </div>
              ))}

              {mayEdit && (
                <form className={styles.stackWide} action={addReview}>
                  <input type="hidden" name="source" value={s.source} />
                  <div className={styles.inviteRow} style={{ padding: 0 }}>
                    <div className={`${styles.field} ${styles.grow}`}>
                      <label className={styles.fieldLabel} htmlFor={`nau-${s.source}`}>
                        New {SOURCE_LABEL[s.source]} review — author
                      </label>
                      <input className={styles.control} id={`nau-${s.source}`} name="author" required />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor={`nme-${s.source}`}>Meta</label>
                      <input className={styles.control} id={`nme-${s.source}`} name="meta" />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor={`ndt-${s.source}`}>Date</label>
                      <input className={styles.control} id={`ndt-${s.source}`} name="dateText" required />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor={`nra-${s.source}`}>Rating</label>
                      <input className={styles.control} id={`nra-${s.source}`} name="rating"
                        type="number" min={1} max={5} defaultValue={5} required />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`nbd-${s.source}`}>
                      Review text, copied verbatim from {SOURCE_LABEL[s.source]}
                    </label>
                    <textarea className={styles.textarea} id={`nbd-${s.source}`} name="body"
                      rows={3} required />
                  </div>
                  <div className={styles.rowActions} style={{ padding: 0 }}>
                    <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                      Add review
                    </button>
                    <span className={styles.panelNote}>
                      Added unpublished, so you can check it against the original first
                    </span>
                  </div>
                </form>
              )}
            </section>
          );
        })}

        <p className={styles.panelNote}>
          <Link className={styles.rowLink} href="/reviews">View the public page</Link>
        </p>
      </div>
    </>
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
