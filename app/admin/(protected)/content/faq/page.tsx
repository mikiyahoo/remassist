import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { faqGroups, faqItems } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';
import { addFaqItem, moveFaqItem, saveFaqGroup, setFaqItemPublished } from './actions';
import { faqMessage } from './messages';
import styles from '../../../admin.module.css';

/**
 * The FAQ list — the Test Admin prototype's shape.
 *
 * A scannable line per question: grip, question, section tag, status pill,
 * icon actions. Editing lives at ./[id]. This replaced a form per row, which
 * at 29 questions meant 29 textareas on one page; the list now shows all of
 * them in roughly the space three forms took.
 *
 * The grip is decorative and says so to a screen reader. This admin has no
 * client-side drag — reordering is the two icon buttons beside it — and a grip
 * that looks draggable but is not would be a lie the mockup could afford and a
 * working page cannot.
 *
 * Both roles may edit content; the gate is re-checked inside every action,
 * because a server action renders outside this page.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'FAQ',
  robots: { index: false, follow: false },
};

export default async function FaqListPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; add?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const message = faqMessage(sp.ok, sp.error);
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
  const [groups, items] = await Promise.all([
    db.select().from(faqGroups).orderBy(asc(faqGroups.sortOrder)),
    db.select().from(faqItems).orderBy(asc(faqItems.sortOrder)),
  ]);

  const byGroup = new Map<string, typeof items>();
  for (const g of groups) byGroup.set(g.id, []);
  for (const i of items) byGroup.get(i.groupId)?.push(i);

  const live = items.filter((i) => i.published).length;
  const addingTo = sp.add && groups.some((g) => g.id === sp.add) ? sp.add : null;

  return (
    <>
      <Topbar sub={`${items.length} questions, ${live} live`} />

      <div className={styles.view}>
        {message && (
          <p
            className={`${styles.signinMsg} ${message.tone === 'ok' ? styles.msgOk : styles.msgErr}`}
            role="status"
          >
            {message.text}
          </p>
        )}

        {groups.map((g) => {
          const rows = byGroup.get(g.id) ?? [];
          return (
            <section className={`${styles.panel} ${styles.section}`} key={g.id}>
              <div className={styles.panelHead}>
                <div>
                  <h2 className={styles.panelTitle}>{g.title}</h2>
                  <p className={styles.panelSub}>
                    {rows.length} questions · anchor <code>#{g.slug}</code>
                  </p>
                </div>
                {mayEdit && (
                  <Link
                    className={styles.panelLink}
                    href={addingTo === g.id
                      ? '/admin/content/faq'
                      : `/admin/content/faq?add=${g.id}`}
                  >
                    {addingTo === g.id ? 'Cancel' : '+ Add question'}
                  </Link>
                )}
              </div>

              {rows.length === 0 ? (
                <p className={styles.empty}>
                  <strong>No questions in this section</strong>
                  Use “Add question” above.
                </p>
              ) : (
                rows.map((it, n) => (
                  <div className={styles.faqRow} key={it.id}>
                    {/* Decorative: reordering is the arrows on the right. */}
                    <span className={styles.grip} aria-hidden="true" />

                    <Link className={styles.faqQ} href={`/admin/content/faq/${it.id}`}>
                      {it.question}
                    </Link>

                    <span className={styles.faqCat}>{g.title}</span>

                    <span
                      className={`${styles.pill} ${it.published ? styles.pillLow : styles.pillMed}`}
                    >
                      {it.published ? 'Published' : 'Draft'}
                    </span>

                    {mayEdit && (
                      <div className={styles.actions}>
                        <Link
                          className={styles.iconBtn}
                          href={`/admin/content/faq/${it.id}`}
                          aria-label={`Edit: ${it.question}`}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                          </svg>
                        </Link>

                        <form action={setFaqItemPublished}>
                          <input type="hidden" name="id" value={it.id} />
                          <input type="hidden" name="published" value={it.published ? '0' : '1'} />
                          <button
                            className={styles.iconBtn}
                            type="submit"
                            aria-label={it.published ? 'Take off the page' : 'Put it live'}
                          >
                            {it.published ? (
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

                        <form action={moveFaqItem}>
                          <input type="hidden" name="id" value={it.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button
                            className={styles.iconBtn}
                            type="submit"
                            disabled={n === 0}
                            aria-label="Move up"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 19V5M5 12l7-7 7 7" />
                            </svg>
                          </button>
                        </form>

                        <form action={moveFaqItem}>
                          <input type="hidden" name="id" value={it.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button
                            className={styles.iconBtn}
                            type="submit"
                            disabled={n === rows.length - 1}
                            aria-label="Move down"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 5v14M5 12l7 7 7-7" />
                            </svg>
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Revealed by the panel's own link rather than always present:
                  six permanent add-forms is what made the old page long. */}
              {mayEdit && addingTo === g.id && (
                <form className={styles.stackWide} action={addFaqItem}>
                  <input type="hidden" name="groupId" value={g.id} />
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`nq-${g.id}`}>
                      New question in “{g.title}”
                    </label>
                    <input
                      className={styles.control}
                      id={`nq-${g.id}`}
                      name="question"
                      placeholder="What do people actually ask?"
                      maxLength={300}
                      required
                      autoFocus
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`na-${g.id}`}>Answer</label>
                    <textarea
                      className={styles.textarea}
                      id={`na-${g.id}`}
                      name="answer"
                      rows={4}
                      maxLength={4000}
                      required
                    />
                  </div>
                  <div className={styles.rowActions} style={{ padding: 0 }}>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                      Add question
                    </button>
                    <span className={styles.panelNote}>
                      Added as a draft, so you can check it before it goes live
                    </span>
                  </div>
                </form>
              )}

              {mayEdit && (
                <details className={styles.groupSettings}>
                  <summary>Section title and anchor</summary>
                  <form className={styles.inviteRow} action={saveFaqGroup}>
                    <input type="hidden" name="id" value={g.id} />
                    <div className={`${styles.field} ${styles.grow}`}>
                      <label className={styles.fieldLabel} htmlFor={`t-${g.id}`}>Title</label>
                      <input
                        className={styles.control}
                        id={`t-${g.id}`}
                        name="title"
                        defaultValue={g.title}
                        required
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor={`s-${g.id}`}>Anchor</label>
                      <input
                        className={styles.control}
                        id={`s-${g.id}`}
                        name="slug"
                        defaultValue={g.slug}
                        pattern="[a-z][a-z\-]*[a-z]"
                        title="Lowercase letters and hyphens only — it is part of a URL"
                        required
                      />
                    </div>
                    <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                      Save section
                    </button>
                  </form>
                </details>
              )}
            </section>
          );
        })}

        <p className={styles.panelNote}>
          <Link className={styles.rowLink} href="/faq">View the public page</Link>
          {' · '}Saving revalidates <code>/faq</code>, so changes are visible straight away.
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
          <h1 className={styles.tbTitle}>FAQ</h1>
          <p className={styles.tbSub}>{sub}</p>
        </div>
      </div>
    </header>
  );
}
