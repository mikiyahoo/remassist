import Link from 'next/link';
import { count, desc, sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { leads, quizSubmissions } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { LEAD_STATUSES, formatDate } from '@/lib/leads/display';
import { agentTiers, faqItems, posts, reviews } from '@/db/schema';
import { AtAGlance, LeadVolume, SourceTag, TopSources } from './DashboardPanels';
import styles from '../admin.module.css';

/**
 * The admin landing page.
 *
 * Replaces a redirect to /admin/leads. That redirect was honest when leads were
 * the only surface, but it meant the admin had no answer to "how are we doing"
 * short of reading a table row by row.
 *
 * Counts only, and every one of them is a link into the screen that can act on
 * the number. A dashboard that reports a figure you cannot then investigate is
 * a poster, not a tool.
 *
 * Lives inside (protected) so it inherits the gate. It is /admin because a
 * route group adds nothing to the URL.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

const RECENT = 6;

export default async function DashboardPage() {
  await requireUser();

  if (!isDatabaseConfigured()) {
    return (
      <>
        <Topbar subtitle="Database not configured" />
        <div className={styles.view}>
          <div className={styles.notice}>
            <strong>No database configured</strong>
            There is no <code>DATABASE_URL</code> in this environment, so there is nothing to
            count. The public form degrades too — <code>/api/leads</code> answers 503 and
            visitors fall back to composing an email, so nothing is being lost.
          </div>
        </div>
      </>
    );
  }

  const db = getDb();

  const [byStatus, totals, quizTotals, recentLeads, bySource, byDay, faqCounts,
    reviewCounts, postCounts, tierCounts] = await Promise.all([
    db
      .select({ status: leads.status, n: count() })
      .from(leads)
      .groupBy(leads.status),
    db.select({ n: count() }).from(leads),
    db
      .select({
        n: count(),
        /* Submissions with no lead are the ones no other screen shows: the lead
           detail page only joins quizzes to the lead they belong to. */
        anonymous: sql<number>`count(*) filter (where ${quizSubmissions.leadId} is null)`,
        completed: sql<number>`count(*) filter (where ${quizSubmissions.completed})`,
      })
      .from(quizSubmissions),
    db
      .select({
        id: leads.id,
        createdAt: leads.createdAt,
        name: leads.name,
        email: leads.email,
        status: leads.status,
        source: leads.source,
      })
      .from(leads)
      .orderBy(desc(leads.createdAt))
      .limit(RECENT),
    db.select({ source: leads.source, n: count() }).from(leads).groupBy(leads.source),
    /* Every lead of the last 14 days, bucketed by day in SQL rather than in
       JS: the database already knows how to do this and the alternative is
       pulling rows only to count them. */
    db
      .select({
        day: sql<string>`to_char(${leads.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        n: count(),
      })
      .from(leads)
      .where(sql`${leads.createdAt} >= now() - interval '14 days'`)
      .groupBy(sql`1`),
    db
      .select({
        faqLive: sql<number>`count(*) filter (where ${faqItems.published})`,
        faqTotal: count(),
      })
      .from(faqItems),
    db
      .select({ n: sql<number>`count(*) filter (where ${reviews.published})` })
      .from(reviews),
    db
      .select({
        live: sql<number>`count(*) filter (where ${posts.published})`,
        total: count(),
      })
      .from(posts),
    /* The rate catalog drives every quoted estimate, so "is it populated" is
       worth stating rather than assuming. Counting one of its three tables is
       enough: db:seed fills them together or not at all. */
    db.select({ n: count() }).from(agentTiers),
  ]);

  const statusCount = new Map(byStatus.map((r) => [r.status, Number(r.n)]));
  const leadTotal = Number(totals[0]?.n ?? 0);
  const quizzes = Number(quizTotals[0]?.n ?? 0);
  const anonymous = Number(quizTotals[0]?.anonymous ?? 0);
  const completed = Number(quizTotals[0]?.completed ?? 0);
  const untouched = statusCount.get('new') ?? 0;

  const sourceRows = bySource
    .map((r) => ({ source: r.source, n: Number(r.n) }))
    .sort((a, b) => b.n - a.n);

  /* Fourteen buckets built here rather than in SQL, because a day with no
     leads produces no row and the chart needs the gap to exist. */
  const perDay = new Map(byDay.map((r) => [r.day, Number(r.n)]));
  const today = new Date();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(
      today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (13 - i),
    ));
    const key = d.toISOString().slice(0, 10);
    return {
      label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      n: perDay.get(key) ?? 0,
      today: i === 13,
    };
  });

  return (
    <>
      <Topbar subtitle="Everything the system has captured" />

      <div className={styles.view}>
        <div className={styles.stats}>
          <Stat href="/admin/leads" value={leadTotal} label="Leads captured" icon={ICON.inbox} />
          <Stat
            href="/admin/leads?status=new"
            value={untouched}
            label="Awaiting a first response"
            icon={ICON.clock}
            delta={untouched > 0 ? { text: 'Needs attention', tone: 'needs' } : undefined}
          />
          <Stat
            href="/admin/quizzes"
            value={quizzes}
            label="Fit finder submissions"
            icon={ICON.check}
            note={`${completed} completed`}
          />
          <Stat
            href="/admin/quizzes?only=anonymous"
            value={anonymous}
            label="Quizzes with no contact details"
            icon={ICON.ghost}
            note={anonymous > 0 ? 'Interest with nobody to reply to' : 'Everyone left details'}
          />
        </div>

        {/* Who just arrived, full width: it is the one table here worth reading
            top to bottom, and the first question anyone opening the admin has. */}
        <section className={`${styles.panel} ${styles.section}`}>
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Recent leads</h2>
              <p className={styles.panelSub}>Newest submissions across the site</p>
            </div>
            <Link className={styles.panelLink} href="/admin/leads">View all →</Link>
          </div>
          {recentLeads.length === 0 ? (
            <p className={styles.empty}>
              <strong>Nothing captured yet</strong>
              Leads from the contact form, the fit finder and the pricing CTA all land here.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Lead</th><th>Source</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {recentLeads.map((l) => (
                    <tr key={l.id}>
                      {/* Two lines per cell, the prototype's dominant table
                          pattern: the identifying value in weight, its
                          qualifier under it in small grey. */}
                      <td>
                        <Link className={styles.rowLink} href={`/admin/leads/${l.id}`}>
                          <span className={styles.cellPrimary}>
                            {l.name ?? 'No name given'}
                          </span>
                        </Link>
                        <span className={`${styles.cellSecondary} ${styles.mono}`}>{l.email}</span>
                      </td>
                      <td className={styles.nowrap}>
                        <SourceTag source={l.source} />
                        <span className={`${styles.cellSecondary} ${styles.mono}`}>
                          {formatDate(l.createdAt)}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.pill} ${styles[`s_${l.status}`]}`}>{l.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Two breakdowns of the same leads side by side — one by status, one by
            where they came from. Both are bars against a total, so they read as
            a pair rather than as two unrelated panels. */}
        <div className={styles.grid2eq}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Pipeline</h2>
              <span className={styles.panelNote}>
                {completed} of {quizzes} quizzes were completed
              </span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Status</th><th>Leads</th><th aria-label="Share" /></tr>
                </thead>
                <tbody>
                  {LEAD_STATUSES.map((s) => {
                    const n = statusCount.get(s) ?? 0;
                    const pct = leadTotal > 0 ? Math.round((n / leadTotal) * 100) : 0;
                    return (
                      <tr key={s}>
                        <td>
                          <Link className={styles.rowLink} href={`/admin/leads?status=${s}`}>
                            <span className={`${styles.pill} ${styles[`s_${s}`]}`}>{s}</span>
                          </Link>
                        </td>
                        <td className={styles.mono}>{n}</td>
                        <td className={styles.barCell}>
                          {/* A bar rather than only a number: the shape of the
                              pipeline is the point, and 3 vs 30 does not read as
                              a difference in a column of digits. */}
                          <span className={styles.bar} aria-hidden="true">
                            <span className={styles.barFill} style={{ width: `${pct}%` }} />
                          </span>
                          <span className={styles.barPct}>{pct}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <TopSources rows={sourceRows} total={leadTotal} />
        </div>

        {/* The chart takes the wide column and the rail keeps its width, which
            is what At a glance was drawn to be: a narrow object beside something
            wider, not a full-width band of its own. */}
        <div className={styles.grid2}>
          <LeadVolume days={days} />

          <AtAGlance
            counts={{
              faqLive: Number(faqCounts[0]?.faqLive ?? 0),
              faqTotal: Number(faqCounts[0]?.faqTotal ?? 0),
              reviewsLive: Number(reviewCounts[0]?.n ?? 0),
              postsLive: Number(postCounts[0]?.live ?? 0),
              postsTotal: Number(postCounts[0]?.total ?? 0),
              quizzes,
              anonymous,
              catalogEmpty: Number(tierCounts[0]?.n ?? 0) === 0,
              mailConfigured: Boolean(process.env.AUTH_RESEND_KEY),
            }}
          />
        </div>
      </div>
    </>
  );
}

/**
 * Stat card, in the prototype's anatomy: icon tile top-left, optional delta
 * pill top-right, then label, then value. Label before value is the part worth
 * keeping — it reads as "what is this / how many" rather than a number in
 * search of a caption.
 */
function Stat({ href, value, label, icon, note, delta }: {
  href: string;
  value: number;
  label: string;
  icon: React.ReactNode;
  note?: string;
  delta?: { text: string; tone: 'up' | 'needs' };
}) {
  return (
    <Link className={styles.statCard} href={href}>
      <div className={styles.statTop}>
        <span className={styles.statIco}>{icon}</span>
        {delta && (
          <span
            className={`${styles.statDelta} ${delta.tone === 'up' ? styles.deltaUp : styles.deltaNeeds}`}
          >
            {delta.text}
          </span>
        )}
      </div>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {note && <div className={styles.statNote}>{note}</div>}
    </Link>
  );
}

/* Stroke-only 24px icons, matching the sidebar's set. Declared once here
   rather than inline so the four cards cannot drift apart in weight. */
const ICON = {
  inbox: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M4 5h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3.2 1.9" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 11l3 3 7-7" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    </svg>
  ),
  ghost: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a7 7 0 0 0-7 7v10l3-2 2 2 2-2 2 2 3-2V10a7 7 0 0 0-5-6.7" />
      <path d="M9.5 10h.01M14.5 10h.01" />
    </svg>
  ),
};

function Topbar({ subtitle }: { subtitle: string }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>Dashboard</h1>
          <p className={styles.tbSub}>{subtitle}</p>
        </div>
      </div>
    </header>
  );
}
