'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from './FitFinderQuiz.module.css';

/**
 * Loads the fit finder's quiz off the critical path.
 *
 * QuizLogic is 18 KB of client JS — the scoring table, the five steps and the
 * portalled result popup — and it sits in the home page's eighth section,
 * below the fold on every viewport. It was eager, so every home-page visitor
 * downloaded and parsed it whether they scrolled that far or not.
 *
 * This wrapper exists because components/home/FitFinder.tsx is a *server*
 * component: `next/dynamic` and IntersectionObserver both need a client
 * boundary, and putting one around the whole section would have turned the
 * section furniture into client JS too. So the boundary is drawn as tightly as
 * possible — this file and nothing else.
 *
 * TWO triggers, and the second is not optional. The observer is the fast path:
 * it requests the chunk while the section is still a screen away, so it has
 * arrived by the time it is looked at. But an observer that never fires would
 * leave this section as a permanently blank box — a worse outcome than
 * shipping the quiz eagerly ever was — and IntersectionObserver genuinely does
 * not run in every environment that renders the page (it does not fire at all
 * in the in-app browser pane this was tested in). So an idle callback loads it
 * regardless, with a timeout so it happens even on a page that never goes
 * idle. Whichever fires first wins; `show` only ever goes one way.
 *
 * /qualify is untouched — it imports QuizLogic directly, because there the
 * quiz *is* the page and deferring it would be strictly worse.
 */
const QuizLogic = dynamic(() => import('@/components/quiz/QuizLogic'), { ssr: false });

/** How long to wait for idle before loading anyway. */
const IDLE_TIMEOUT_MS = 2500;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export default function FitFinderQuiz() {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* Hoisted out of both branches below. The cleanup returned at the end of
       this effect calls cancelIdleCallback, and a declaration inside either
       branch is not in scope there. */
    const w = window as IdleWindow;

    let io: IntersectionObserver | undefined;
    let idleId: number | undefined;
    let timeoutId: number | undefined;

    const load = () => {
      setShow(true);
      io?.disconnect();
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };

    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([e]) => { if (e.isIntersecting) load(); },
        { rootMargin: '600px' },
      );
      io.observe(el);
    } else {
      /* The backstop, and only for browsers with no IntersectionObserver.
         It used to run unconditionally, which meant QuizLogic was fetched and
         evaluated on every home page visit within 2.5s whether or not anyone
         scrolled — the observer above already loads it 600px early, so the
         timer was not buying reach, only guaranteed work. requestIdleCallback
         where it exists (not Safari before 17.4), a plain timer otherwise. */
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(load, { timeout: IDLE_TIMEOUT_MS });
      else timeoutId = window.setTimeout(load, IDLE_TIMEOUT_MS);
    }

    return () => {
      io?.disconnect();
      if (idleId !== undefined) (window as IdleWindow).cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div ref={ref}>
      {show ? <QuizLogic quizId="fit_finder" /> : <div className={styles.skeleton} aria-hidden="true" />}
    </div>
  );
}
