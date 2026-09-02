import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { posts } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';
import { hasLegacyBody, isPublishable } from '@/lib/blog/legacy-bodies';
import { addPost, savePost, setPostPublished } from './actions';
import { postMessage } from './messages';
import styles from '../../../admin.module.css';

/**
 * The blog post editor.
 *
 * Bodies are plain text: blank lines separate paragraphs, a leading "## " makes
 * a heading. Not a limitation to apologise for — see the note in actions.ts on
 * why staff-authored HTML is not accepted here.
 *
 * One article's body still lives in a React component. Its row says so rather
 * than showing an empty textarea that an editor would reasonably try to fill.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Blog posts',
  robots: { index: false, follow: false },
};

export default async function PostsEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const message = postMessage(sp.ok, sp.error);
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
  const rows = await db.select().from(posts).orderBy(desc(posts.date));
  const live = rows.filter((p) => p.published).length;

  return (
    <>
      <Topbar sub={`${rows.length} posts, ${live} live`} />

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
          <strong>Plain text, not HTML</strong>
          Leave a blank line between paragraphs, and start a line with <code>## </code> for a
          heading. HTML is not accepted — rendering staff-written HTML on a public page would
          be a cross-site scripting hole the first time an editor account was phished.
          <br />
          The public <code>/blog</code> still renders from <code>lib/blog/posts.ts</code> until
          the cutover, so these edits are not live yet.
        </div>

        {mayEdit && (
          <section className={`${styles.panel} ${styles.section}`}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>New post</h2>
              <span className={styles.panelNote}>Created as a draft</span>
            </div>
            <form className={styles.stackWide} action={addPost}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="np-title">Title</label>
                <input className={styles.control} id="np-title" name="title" maxLength={300} required />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="np-slug">
                  Slug — this becomes the URL, so lowercase letters, numbers and hyphens only
                </label>
                <input
                  className={styles.control}
                  id="np-slug"
                  name="slug"
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="how-to-scope-a-remote-role"
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="np-excerpt">
                  Excerpt — the line shown on the index card
                </label>
                <textarea className={styles.textarea} id="np-excerpt" name="excerpt" rows={2}
                  maxLength={600} required />
              </div>
              <div className={styles.rowActions} style={{ padding: 0 }}>
                <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                  Create draft
                </button>
              </div>
            </form>
          </section>
        )}

        {rows.map((p) => {
          const legacy = hasLegacyBody(p.slug);
          const publishable = isPublishable(p.slug, p.body);
          return (
            <section className={`${styles.panel} ${styles.section}`} key={p.id}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>
                  {p.title}
                  {!p.published && <span className={styles.tag}>Draft</span>}
                </h2>
                <span className={styles.panelNote}>
                  <code>/blog/{p.slug}</code> · {p.date}
                </span>
              </div>

              <form className={styles.stackWide} action={savePost}>
                <input type="hidden" name="id" value={p.id} />
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor={`ti-${p.id}`}>Title</label>
                  <input className={styles.control} id={`ti-${p.id}`} name="title"
                    defaultValue={p.title} maxLength={300} required readOnly={!mayEdit} />
                </div>
                <div className={styles.inviteRow} style={{ padding: 0 }}>
                  <div className={`${styles.field} ${styles.grow}`}>
                    <label className={styles.fieldLabel} htmlFor={`sl-${p.id}`}>Slug</label>
                    <input className={styles.control} id={`sl-${p.id}`} name="slug"
                      defaultValue={p.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      required readOnly={!mayEdit} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`da-${p.id}`}>Date</label>
                    <input className={styles.control} id={`da-${p.id}`} name="date"
                      defaultValue={p.date} placeholder="YYYY-MM-DD"
                      pattern="\d{4}-\d{2}-\d{2}" required readOnly={!mayEdit} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`rt-${p.id}`}>Read time</label>
                    <input className={styles.control} id={`rt-${p.id}`} name="readTime"
                      defaultValue={p.readTime} readOnly={!mayEdit} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`ca-${p.id}`}>Category</label>
                    <input className={styles.control} id={`ca-${p.id}`} name="category"
                      defaultValue={p.category} readOnly={!mayEdit} />
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor={`ex-${p.id}`}>Excerpt</label>
                  <textarea className={styles.textarea} id={`ex-${p.id}`} name="excerpt"
                    defaultValue={p.excerpt} rows={2} maxLength={600} required readOnly={!mayEdit} />
                </div>
                <div className={styles.inviteRow} style={{ padding: 0 }}>
                  <div className={`${styles.field} ${styles.grow}`}>
                    <label className={styles.fieldLabel} htmlFor={`im-${p.id}`}>Image path</label>
                    <input className={styles.control} id={`im-${p.id}`} name="image"
                      defaultValue={p.image} readOnly={!mayEdit} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`an-${p.id}`}>Author</label>
                    <input className={styles.control} id={`an-${p.id}`} name="authorName"
                      defaultValue={p.authorName} readOnly={!mayEdit} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`aa-${p.id}`}>Author avatar</label>
                    <input className={styles.control} id={`aa-${p.id}`} name="authorAvatar"
                      defaultValue={p.authorAvatar} readOnly={!mayEdit} />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor={`bo-${p.id}`}>
                    Article body — blank line between paragraphs, <code>## </code> for a heading
                  </label>
                  {legacy ? (
                    <p className={styles.panelNote}>
                      {/* Said plainly rather than showing an empty box somebody
                          would reasonably try to fill and then lose. */}
                      This article&rsquo;s body still lives in{' '}
                      <code>app/blog/[slug]/ArticleBody.tsx</code> as 436 lines of markup, and
                      is rendered from there. It was not auto-converted because a
                      pattern-matched conversion of that file would most likely produce a
                      subtly broken article. To edit it here, convert it once by hand and
                      remove the slug from <code>lib/blog/legacy-bodies.ts</code>.
                    </p>
                  ) : (
                    <textarea className={styles.textarea} id={`bo-${p.id}`} name="body"
                      defaultValue={p.body ?? ''} rows={12} maxLength={120000}
                      readOnly={!mayEdit} />
                  )}
                </div>

                {mayEdit && !legacy && (
                  <div className={styles.rowActions} style={{ padding: 0 }}>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                      Save
                    </button>
                  </div>
                )}
              </form>

              {mayEdit && (
                <div className={styles.rowActions}>
                  <form action={setPostPublished}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="published" value={p.published ? '0' : '1'} />
                    <button
                      className={`${styles.btn} ${styles.btnGhost}`}
                      type="submit"
                      disabled={!p.published && !publishable}
                    >
                      {p.published ? 'Take off the blog' : 'Publish'}
                    </button>
                  </form>
                  {!p.published && !publishable && (
                    <span className={styles.panelNote}>
                      Needs a body before it can go live — an empty post is a link to a blank page
                    </span>
                  )}
                  {p.published && (
                    <Link className={styles.rowLink} href={`/blog/${p.slug}`}>View on the blog</Link>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function Topbar({ sub }: { sub: string }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>Blog posts</h1>
          <p className={styles.tbSub}>{sub}</p>
        </div>
      </div>
    </header>
  );
}
