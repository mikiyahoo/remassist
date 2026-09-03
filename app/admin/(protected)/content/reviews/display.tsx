import styles from '../../../admin.module.css';

/**
 * How a review is drawn in the admin, shared by the list and the edit page.
 *
 * Presentation only, and deliberately so: the source's display name and the
 * avatar tint are design with two possible values that change roughly never,
 * which is the same reasoning lib/reviews/content.ts gives for keeping the
 * logos out of the database. Nothing here reads or writes anything.
 */

export const SOURCE_LABEL: Record<string, string> = {
  trustpilot: 'Trustpilot',
  google: 'Google',
};

/**
 * Initials for the avatar.
 *
 * Authors here are whatever the source printed — "TANO Group", "ROOFING PROS",
 * "Surafel Dereje" — so this takes the first letter of the first two words and
 * falls back to the first two characters of a single-word name. Decorative: the
 * meta line underneath spells the name out, which is why the avatar is
 * aria-hidden and is the first thing dropped on a narrow screen.
 */
export function initials(author: string): string {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const STAR = 'm12 3 2.6 5.6 6 .6-4.5 4 1.2 5.9L12 16.4 6.7 19l1.2-5.9-4.5-4 6-.6z';

/**
 * The star row: filled to the rating, outlined for the rest.
 *
 * Five stars are always drawn rather than only the earned ones, because "four
 * filled of five" and "four stars, total unknown" look identical when the
 * remainder is left off, and the difference is the whole meaning.
 */
export function Stars({ rating }: { rating: number }) {
  return (
    <div className={styles.stars} role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 24 24"
          fill={n <= rating ? 'currentColor' : 'none'}
          stroke={n <= rating ? 'none' : 'currentColor'}
          strokeWidth={1.6}
          aria-hidden="true"
        >
          <path d={STAR} />
        </svg>
      ))}
    </div>
  );
}
