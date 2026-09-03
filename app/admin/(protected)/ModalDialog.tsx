'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from '../admin.module.css';

/**
 * A modal, built on the native <dialog> element.
 *
 * A client component for one reason, and it is a narrow one: `showModal()` is
 * the only way to get a real modal, and it can only be called from script. What
 * that call buys is everything a hand-rolled overlay has to reimplement and
 * usually gets wrong — a focus trap, focus restored to whatever opened it,
 * Esc-to-close, inert content behind, and a ::backdrop to style. The overlay in
 * components/widgets/BookingModalDialog.tsx is ~120 lines for less than this.
 *
 * It holds no data and no state. The shell is client-side; the form inside
 * arrives as `children`, rendered on the server, still a plain
 * `<form action={serverAction}>` like every other form in this admin.
 *
 * OPEN STATE LIVES IN THE URL, not in this component. The page decides whether
 * to render it at all, from a search param, so the back button works, a
 * half-filled form survives a refresh, and Cancel is an ordinary link. Every
 * way out — Esc, the close button, the backdrop — goes to the same `cancelHref`
 * rather than just hiding the element, so the URL and the screen cannot
 * disagree.
 *
 * With JavaScript off the dialog never opens. That is a real limitation and it
 * is the right trade here: the fallback is the list you were already looking
 * at, nothing is lost, and this admin already needs script for the category
 * filter next to it.
 */
export default function ModalDialog({
  title,
  cancelHref,
  children,
}: {
  title: string;
  cancelHref: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  /* Opened on mount rather than rendered with the `open` attribute: a
     statically-open dialog is not modal — no focus trap, no inert background,
     and ::backdrop never paints. */
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const leave = () => router.push(cancelHref);

  return (
    <dialog
      className={styles.modal}
      ref={ref}
      aria-label={title}
      /* Esc. preventDefault stops the browser closing the element behind our
         back, which would leave ?add=1 in the URL with nothing on screen. */
      onCancel={(e) => { e.preventDefault(); leave(); }}
      /* A backdrop click. The backdrop is not a child, so a click on it targets
         the dialog itself — that identity check is the whole test, and it is
         why the panel below is an element rather than bare children. */
      onClick={(e) => { if (e.target === ref.current) leave(); }}
    >
      <div className={styles.modalPanel}>
        <div className={styles.modalHead}>
          <h2 className={styles.panelTitle}>{title}</h2>
          <Link className={styles.iconBtn} href={cancelHref} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Link>
        </div>
        {children}
      </div>
    </dialog>
  );
}
