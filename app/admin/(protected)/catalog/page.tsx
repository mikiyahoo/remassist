import { asc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { agentTiers, coverageOptions, serviceCategories } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import styles from '../../admin.module.css';

/**
 * The rate catalog, read-only.
 *
 * These three tables decide what the fit finder quotes: a service category, an
 * hourly rate by tier, and a coverage option's seats and monthly hours. Change
 * a number here and every estimate the site produces changes with it — which is
 * exactly why nobody could previously see them from the admin. An estimate you
 * cannot trace back to the figure that produced it is not auditable.
 *
 * Read-only on purpose for now. Editing these is a pricing change, and it wants
 * the same care as one: knowing what a row currently says is the first half of
 * that, and it is the half that was missing.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Rate catalog',
  robots: { index: false, follow: false },
};

export default async function CatalogPage() {
  await requireUser();

  if (!isDatabaseConfigured()) {
    return (
      <>
        <Topbar />
        <div className={styles.view}>
          <div className={styles.notice}>
            <strong>No database configured</strong>
            There is no <code>DATABASE_URL</code> in this environment, so the catalog cannot
            be read.
          </div>
        </div>
      </>
    );
  }

  const db = getDb();
  const [categories, tiers, coverage] = await Promise.all([
    db.select().from(serviceCategories).orderBy(asc(serviceCategories.sortOrder)),
    db.select().from(agentTiers).orderBy(asc(agentTiers.sortOrder)),
    db.select().from(coverageOptions).orderBy(asc(coverageOptions.sortOrder)),
  ]);

  const empty = categories.length === 0 && tiers.length === 0 && coverage.length === 0;

  return (
    <>
      <Topbar />

      <div className={styles.view}>
        {empty && (
          <div className={`${styles.notice} ${styles.section}`}>
            <strong>The catalog is empty</strong>
            All three tables have no rows, so the quiz is falling back to whatever defaults
            live in <code>lib/quiz/quiz.ts</code> rather than reading these. Run{' '}
            <code>npm run db:seed</code> to populate them.
          </div>
        )}

        <section className={`${styles.panel} ${styles.section}`}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Agent tiers</h2>
            <span className={styles.panelNote}>{tiers.length} rows — drives the hourly rate</span>
          </div>
          {tiers.length === 0 ? (
            <p className={styles.empty}><strong>No tiers</strong>Nothing to price against.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Key</th><th>Label</th><th>Hourly rate</th><th>Order</th></tr>
                </thead>
                <tbody>
                  {tiers.map((t) => (
                    <tr key={t.key}>
                      <td className={styles.mono}>{t.key}</td>
                      <td>{t.label}</td>
                      <td className={styles.mono}>
                        {t.hourlyRateUsd === null
                          ? <span className={styles.none}>Not set</span>
                          : `$${t.hourlyRateUsd}/hr`}
                      </td>
                      <td className={styles.mono}>{t.sortOrder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${styles.panel} ${styles.section}`}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Coverage options</h2>
            <span className={styles.panelNote}>
              {coverage.length} rows — seats and monthly hours behind every estimate
            </span>
          </div>
          {coverage.length === 0 ? (
            <p className={styles.empty}><strong>No coverage options</strong>Nothing to size against.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Key</th><th>Label</th><th>Long label</th>
                    <th>Seats</th><th>Monthly hours</th><th>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((c) => (
                    <tr key={c.key}>
                      <td className={styles.mono}>{c.key}</td>
                      <td>{c.label}</td>
                      <td>{c.longLabel ?? <span className={styles.none}>—</span>}</td>
                      <td className={styles.mono}>{c.seats ?? <span className={styles.none}>—</span>}</td>
                      <td className={styles.mono}>{c.monthlyHours ?? <span className={styles.none}>—</span>}</td>
                      <td className={styles.mono}>{c.sortOrder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Service categories</h2>
            <span className={styles.panelNote}>{categories.length} rows</span>
          </div>
          {categories.length === 0 ? (
            <p className={styles.empty}><strong>No categories</strong>Nothing to route a lead into.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Key</th><th>Name</th><th>Slug</th><th>Nav blurb</th><th>Order</th></tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.key}>
                      <td className={styles.mono}>{c.key}</td>
                      <td>{c.name}</td>
                      <td className={styles.mono}>{c.slug}</td>
                      <td>{c.navBlurb ?? <span className={styles.none}>—</span>}</td>
                      <td className={styles.mono}>{c.sortOrder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Topbar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>Rate catalog</h1>
          <p className={styles.tbSub}>The figures behind every quoted estimate</p>
        </div>
      </div>
    </header>
  );
}
