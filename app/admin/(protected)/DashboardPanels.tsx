import Link from 'next/link';
import { SOURCE_LABELS } from '@/lib/leads/display';
import styles from '../admin.module.css';

/**
 * The dashboard's lower panels, matching the Test Admin prototype: an
 * at-a-glance rail, a 14-day volume chart and a top-sources breakdown.
 *
 * Split out of page.tsx because that file was becoming one long render with
 * four unrelated shapes in it. Every value is passed in — none of these query
 * anything, so the page keeps its single round trip to the database.
 */

const SOURCE_ICON: Record<string, React.ReactNode> = {
  qualify_quiz: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 11l3 3 7-7" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    </svg>
  ),
  ask_widget: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-5A8 8 0 1 1 21 12z" />
    </svg>
  ),
  contact_form: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  pricing_cta: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.7 5 3.2 5 1.3 5 3.3-2.2 3-5 3-5-1.1-5-3" />
    </svg>
  ),
};

/** A source, named beside a tinted glyph. Falls back to the raw key. */
export function SourceTag({ source }: { source: string }) {
  return (
    <span className={styles.srcTag}>
      <span className={styles.sourceChip}>
        {SOURCE_ICON[source] ?? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>
        )}
      </span>
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

export function AtAGlance({ counts }: {
  counts: {
    faqLive: number; faqTotal: number;
    reviewsLive: number; postsLive: number; postsTotal: number;
    quizzes: number; anonymous: number;
    catalogEmpty: boolean; mailConfigured: boolean;
  };
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>At a glance</h2>
          <p className={styles.panelSub}>What the site is serving right now</p>
        </div>
      </div>

      <div className={styles.glanceSection}>
        <div className={styles.glanceLabel}>Live content</div>
        {/* Each row links to the screen that changes the number, so a count
            that looks wrong is one click from being fixed. */}
        <Link className={styles.glanceRow} href="/admin/content/faq">
          FAQ answers live<b>{counts.faqLive} of {counts.faqTotal}</b>
        </Link>
        <Link className={styles.glanceRow} href="/admin/content/reviews">
          Reviews shown<b>{counts.reviewsLive}</b>
        </Link>
        <Link className={styles.glanceRow} href="/admin/content/posts">
          Posts published<b>{counts.postsLive} of {counts.postsTotal}</b>
        </Link>
      </div>

      <div className={styles.glanceSection}>
        <div className={styles.glanceLabel}>Shortcuts</div>
        <Link className={styles.glanceRow} href="/admin/quizzes?only=anonymous">
          Quizzes with no contact details<b>{counts.anonymous}</b>
        </Link>
        <Link className={styles.glanceRow} href="/admin/catalog">
          Rate catalog<b>{counts.catalogEmpty ? 'Empty' : 'Populated'}</b>
        </Link>
        <Link className={styles.glanceRow} href="/admin/leads/export">
          Export every lead as CSV<b>↓</b>
        </Link>
      </div>

      <div className={styles.glanceSection}>
        <div className={styles.glanceLabel}>System</div>
        {/* Reported rather than assumed. Without a Resend key there are no
            emailed codes, no invitations and no verification — which is the
            single most useful thing to know from this screen. */}
        <div className={styles.statusRow}>
          <span className={`${styles.statusDot} ${counts.mailConfigured ? '' : styles.statusDotWarn}`} />
          <span>
            {counts.mailConfigured
              ? 'Email is configured — codes and invitations can be sent'
              : 'No email provider. Password sign-in only; invitations cannot be sent.'}
          </span>
        </div>
        <div className={styles.statusRow}>
          <span className={styles.statusDot} />
          <span>{counts.quizzes} fit finder submissions stored</span>
        </div>
      </div>
    </section>
  );
}

export function LeadVolume({ days }: { days: Array<{ label: string; n: number; today: boolean }> }) {
  /* Scaled against the busiest day rather than a fixed ceiling, so the shape
     is readable when the numbers are small — which they are on a new site. A
     zero day still shows a sliver, otherwise "no leads" and "no bar rendered"
     look identical. */
  const peak = Math.max(1, ...days.map((d) => d.n));

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Lead volume — last 14 days</h2>
          <p className={styles.panelSub}>Site-wide submissions, one bar per day</p>
        </div>
      </div>
      <div className={styles.chart}>
        {days.map((d) => (
          <div
            className={`${styles.chartCol} ${d.today ? styles.chartToday : ''}`}
            key={d.label}
            title={`${d.n} lead${d.n === 1 ? '' : 's'} on ${d.label}`}
          >
            <div
              className={styles.chartBar}
              style={{ height: `${Math.max(3, Math.round((d.n / peak) * 100))}%` }}
            />
            <span className={styles.cday}>{d.label}</span>
          </div>
        ))}
      </div>
      <p className={styles.panelFoot}>
        {days.reduce((n, d) => n + d.n, 0)} in the last 14 days
      </p>
    </section>
  );
}

export function TopSources({ rows, total }: {
  rows: Array<{ source: string; n: number }>;
  total: number;
}) {
  const shade = [styles.srcFill, styles.srcFillA, styles.srcFillB, styles.srcFillC];

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Top sources</h2>
          <p className={styles.panelSub}>Where leads came from</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>
          <strong>Nothing to break down yet</strong>
          Sources appear here once leads start arriving.
        </p>
      ) : (
        <div className={styles.sources}>
          {rows.map((r, i) => {
            const pct = total > 0 ? Math.round((r.n / total) * 100) : 0;
            return (
              <div key={r.source}>
                <div className={styles.srcLabel}>
                  <b>{SOURCE_LABELS[r.source] ?? r.source}</b>
                  <span>{r.n} · {pct}%</span>
                </div>
                <div className={styles.srcTrack}>
                  <div
                    className={`${styles.srcFill} ${shade[Math.min(i, shade.length - 1)]}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
