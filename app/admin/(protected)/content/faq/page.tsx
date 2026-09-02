import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { faqGroups, faqItems } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';
import {
  addFaqItem, moveFaqItem, saveFaqGroup, saveFaqItem, setFaqItemPublished,
} from './actions';
import { faqMessage } from './messages';
import styles from '../../../admin.module.css';

/**
 * The FAQ editor.
 *
 * Both roles may edit content — see canEditContent. The gate is still checked
 * here and again inside every action, because a server action renders outside
 * this page and is reachable on its own.
 *
 * Plain forms, no client JavaScript. Each question is its own form posting to a
 * server action, which means the page works before hydration and there is no
 * dirty-state to lose. The cost is a full round trip per save, which for 29
 * questions edited occasionally is the right trade.
 *
 * There is no delete control, and no endpoint behind one. Unpublishing takes a
 * question off the site and keeps what it said.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'FAQ',
  robots: { index: false, follow: false },
};

export default async function FaqEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const message = faqMessage(sp.ok, sp.error);
  const mayEdit = canEditContent(user.role);

  if (!isDatabaseConfigured()) {
    return (
      <>
        <Topbar count={null} live={null} />
        <div className={styles.view}>
          <div className={styles.notice}>
            <strong>No database configured</strong>
            There is no <code>DATABASE_URL</code> in this environment, so there is nothing to
            edit. The public <code>/faq</code> page still renders from source.
          </div>
        </div>
      </>
    );
  }

  const db = getDb();
  const [groups, items] = await Promise.all([
    db.select().from(faqGroups).orderBy(asc(faqGroups.sortOrder)),
    db.select().from(faqItems).orderBy(asc(faqItems.groupId), asc(faqItems.sortOrder)),
  ]);

  const byGroup = new Map<string, typeof items>();
  for (const g of groups) byGroup.set(g.id, []);
  for (const i of items) byGroup.get(i.groupId)?.push(i);

  const live = items.filter((i) => i.published).length;

  return (
    <>
      <Topbar count={items.length} live={live} />

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
          <strong>The public page still reads from source</strong>
          Editing here changes the database. <code>/faq</code> renders from{' '}
          <code>app/faq/page.tsx</code> until the cutover, so these edits are not live yet.
          That is deliberate — the content was imported and verified first.
        </div>

        {groups.map((g) => {
          const rows = byGroup.get(g.id) ?? [];
          return (
            <section className={`${styles.panel} ${styles.section}`} key={g.id}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>{g.title}</h2>
                <span className={styles.panelNote}>
                  {rows.length} questions · anchor <code>#{g.slug}</code>
                </span>
              </div>

              {mayEdit && (
                <form className={styles.inviteRow} action={saveFaqGroup}>
                  <input type="hidden" name="id" value={g.id} />
                  <div className={`${styles.field} ${styles.grow}`}>
                    <label className={styles.fieldLabel} htmlFor={`t-${g.id}`}>Section title</label>
                    <input className={styles.control} id={`t-${g.id}`} name="title" defaultValue={g.title} required />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`s-${g.id}`}>Anchor</label>
                    <input
                      className={styles.control}
                      id={`s-${g.id}`}
                      name="slug"
                      defaultValue={g.slug}
                      pattern="[a-z][a-z\-]*[a-z]"
                      /* Part of a URL — the jump nav links to it. */
                      title="Lowercase letters and hyphens only"
                      required
                    />
                  </div>
                  <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                    Save section
                  </button>
                </form>
              )}

              {rows.length === 0 ? (
                <p className={styles.empty}>
                  <strong>No questions in this section</strong>
                  Add one below.
                </p>
              ) : (
                rows.map((it, n) => (
                  <div className={styles.faqRow} key={it.id}>
                    <form className={styles.stackWide} action={saveFaqItem}>
                      <input type="hidden" name="id" value={it.id} />
                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={`q-${it.id}`}>
                          Question
                          {!it.published && <span className={styles.tag}>Not live</span>}
                        </label>
                        <input
                          className={styles.control}
                          id={`q-${it.id}`}
                          name="question"
                          defaultValue={it.question}
                          maxLength={300}
                          required
                          readOnly={!mayEdit}
                        />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel} htmlFor={`a-${it.id}`}>Answer</label>
                        <textarea
                          className={styles.textarea}
                          id={`a-${it.id}`}
                          name="answer"
                          defaultValue={it.answer}
                          maxLength={4000}
                          rows={4}
                          required
                          readOnly={!mayEdit}
                        />
                      </div>
                      {mayEdit && (
                        <div className={styles.rowActions}>
                          <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                            Save
                          </button>
                        </div>
                      )}
                    </form>

                    {mayEdit && (
                      <div className={styles.rowActions}>
                        <form action={setFaqItemPublished}>
                          <input type="hidden" name="id" value={it.id} />
                          <input type="hidden" name="published" value={it.published ? '0' : '1'} />
                          <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                            {it.published ? 'Take off the page' : 'Put it live'}
                          </button>
                        </form>
                        <form action={moveFaqItem}>
                          <input type="hidden" name="id" value={it.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button
                            className={`${styles.btn} ${styles.btnGhost}`}
                            type="submit"
                            disabled={n === 0}
                            aria-label="Move up"
                          >
                            ↑
                          </button>
                        </form>
                        <form action={moveFaqItem}>
                          <input type="hidden" name="id" value={it.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button
                            className={`${styles.btn} ${styles.btnGhost}`}
                            type="submit"
                            disabled={n === rows.length - 1}
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                ))
              )}

              {mayEdit && (
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
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`na-${g.id}`}>Answer</label>
                    <textarea
                      className={styles.textarea}
                      id={`na-${g.id}`}
                      name="answer"
                      rows={3}
                      maxLength={4000}
                      required
                    />
                  </div>
                  <div className={styles.rowActions}>
                    <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                      Add question
                    </button>
                    {/* Said out loud, because "I added it and it is not on the
                        site" is otherwise the next question. */}
                    <span className={styles.panelNote}>Added unpublished, so you can check it first</span>
                  </div>
                </form>
              )}
            </section>
          );
        })}

        <p className={styles.panelNote}>
          <Link className={styles.rowLink} href="/faq">View the public page</Link>
        </p>
      </div>
    </>
  );
}

function Topbar({ count, live }: { count: number | null; live: number | null }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>FAQ</h1>
          <p className={styles.tbSub}>
            {count === null
              ? 'Database not configured'
              : `${count} questions, ${live} live`}
          </p>
        </div>
      </div>
    </header>
  );
}
