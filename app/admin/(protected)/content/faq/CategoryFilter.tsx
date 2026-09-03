'use client';

import { useRouter } from 'next/navigation';
import styles from '../../../admin.module.css';

/**
 * The category dropdown on the FAQ list.
 *
 * A client component for one reason: the prototype's filter bar has no Apply
 * button, so the select has to navigate when it changes. The alternative — a
 * GET form with a visible submit — is a control the design does not have, and
 * an onChange that only works with JS is acceptable here in a way it would not
 * be on a public page: this screen is already behind a sign-in that needs JS
 * for nothing else but is only ever used by staff on a real browser.
 *
 * It carries no data of its own. The options are resolved on the server and
 * arrive as plain strings, and the value it navigates to is validated again by
 * the page against the groups that actually exist — a hand-typed `?cat=` is
 * ignored rather than trusted.
 *
 * Status stays in the URL alongside it, so picking a category does not silently
 * throw away the Published/Draft tab the editor is on.
 */
export default function CategoryFilter({
  groups,
  value,
  status,
}: {
  groups: Array<{ id: string; title: string }>;
  value: string;
  status: string;
}) {
  const router = useRouter();

  return (
    <label className={styles.selectField}>
      <span className={styles.srOnly}>Filter by category</span>
      <select
        value={value}
        onChange={(e) => {
          const params = new URLSearchParams();
          if (status !== 'all') params.set('status', status);
          if (e.target.value !== 'all') params.set('cat', e.target.value);
          const qs = params.toString();
          router.push(`/admin/content/faq${qs ? `?${qs}` : ''}`);
        }}
      >
        <option value="all">All categories</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>{g.title}</option>
        ))}
      </select>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  );
}
