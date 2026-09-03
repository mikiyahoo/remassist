'use client';

import { useState, type ReactNode } from 'react';
import styles from '../../admin.module.css';

/**
 * The answers behind a submission's estimate, folded away behind a bottom
 * arrow. Everything that does not change — the header, the estimate cards,
 * the lead link — stays server-rendered on the page; only the open/closed
 * state is client state, so the answers arrive as children.
 */
export default function AnswerAccordion({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.answerAccordion}>
      <div className={open ? styles.answerAccordionBody : styles.answerAccordionBodyClosed}>
        {children}
      </div>
      <button
        type="button"
        className={styles.answerAccordionToggle}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{open ? 'Hide' : 'Show'} the answers ({count})</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={open ? 'm6 14 6-6 6 6' : 'm6 10 6 6 6-6'} />
        </svg>
      </button>
    </div>
  );
}