import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state';

// First-visit walkthrough. Each step points at one control in the top bar or the
// section tabs (they are on screen whatever tab is open). Steps whose control is
// hidden at this width are skipped. Seen once per browser; "Take the tour" on
// How it works replays it.

const SEEN_KEY = 'smart-roster:tour';
export const TOUR_EVENT = 'smart-roster:tour';

export function startTour() {
  window.dispatchEvent(new Event(TOUR_EVENT));
}

interface Step {
  /** CSS selector of the control to point at; none for a centred card. */
  target?: string;
  title: string;
  body: ReactNode;
}

const navTab = (label: string) => `.navtabs button[data-tab="${label}"]`;

const STEPS: Step[] = [
  {
    title: 'Welcome to Smart Roster',
    body: 'It plans a month of cover for 32 people across 20 brands, checks it against every rule, and explains anything it can’t solve. This tour takes about a minute.',
  },
  {
    target: '.monthnav',
    title: 'Pick the month',
    body: 'Rosters are planned one month at a time. December 2026 has sample leave, holidays and a few deliberately hard gaps.',
  },
  {
    target: '.topbar .btn.primary',
    title: 'Generate the roster',
    body: 'The engine plans weekly offs, the holiday rotation and backup cover in about two seconds. Cells you edit by hand are locked and kept when you regenerate.',
  },
  {
    target: navTab('roster'),
    title: 'See it five ways',
    body: 'View the month by company, pod, brand, process or person. Click any cell to change it; you see what the change fixes or breaks before you apply it. Pod leads approve their pod here.',
  },
  {
    target: navTab('issues'),
    title: 'Every problem, with the reason',
    body: 'Each gap or broken rule says who normally covers it, why they can’t, and what would fix it. Some fixes are one click.',
  },
  {
    target: navTab('changes'),
    title: 'Sick days and leave',
    body: 'Report an absence and preview the smallest repair: only that person’s days change and a backup steps in. Leave requests show their risk before you approve them.',
  },
  {
    target: navTab('setup'),
    title: 'Your brands and people',
    body: 'Add brands, processes, shifts, staff, holidays and leave. Assign a primary and backups to each brand process, then regenerate.',
  },
  {
    target: '.syncstate',
    title: 'Saved for everyone',
    body: 'Changes go to a shared database, so everyone who opens the app sees the same roster. If someone saved first, you get their version and a note.',
  },
  {
    target: navTab('guide'),
    title: 'Come back any time',
    body: 'How it works has a two-minute demo script, the rules the engine follows, and a button to replay this tour.',
  },
];

function visible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

type Box = { x: number; y: number; w: number; h: number };

export function Tour() {
  const { sync } = useStore();
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Open on the first visit, once the first load has settled the top bar.
  useEffect(() => {
    if (sync === 'loading') return;
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === 'done';
    } catch {
      /* storage blocked: show it, it can be closed */
    }
    if (seen) return;
    const t = window.setTimeout(() => setStep((s) => s ?? 0), 500);
    return () => window.clearTimeout(t);
  }, [sync]);

  useEffect(() => {
    const open = () => setStep(0);
    window.addEventListener(TOUR_EVENT, open);
    return () => window.removeEventListener(TOUR_EVENT, open);
  }, []);

  const close = useCallback(() => {
    setStep(null);
    try {
      localStorage.setItem(SEEN_KEY, 'done');
    } catch {
      /* fine: it shows again next time */
    }
  }, []);

  /** Move by `dir`, skipping steps whose control isn't on screen at this width. */
  const go = useCallback(
    (from: number, dir: 1 | -1) => {
      for (let i = from + dir; i >= 0 && i < STEPS.length; i += dir) {
        const t = STEPS[i].target;
        if (!t || visible(document.querySelector(t))) return setStep(i);
      }
      if (dir === 1) close();
    },
    [close],
  );

  const current = step === null ? null : STEPS[step];

  // Measure the target and place the card next to it; follow scrolling and resizing.
  useLayoutEffect(() => {
    if (!current) return;
    const el = current.target ? document.querySelector(current.target) : null;
    if (current.target && !visible(el)) {
      go(step!, 1);
      return;
    }
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
    const place = () => {
      const gutter = 16;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const cw = cardRef.current?.offsetWidth ?? 360;
      const ch = cardRef.current?.offsetHeight ?? 200;
      if (!el) {
        setBox(null);
        setCard({ x: (vw - cw) / 2, y: Math.max(gutter, (vh - ch) / 2) });
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 6;
      setBox({ x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 });
      const below = r.bottom + pad + 12;
      const y = below + ch <= vh - gutter ? below : Math.max(gutter, r.top - pad - 12 - ch);
      const x = Math.min(Math.max(gutter, r.left + r.width / 2 - cw / 2), vw - cw - gutter);
      setCard({ x, y });
    };
    place();
    const raf = requestAnimationFrame(place); // again once the card has its real height
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [current, step, go]);

  useEffect(() => {
    if (step !== null) nextRef.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') go(step, 1);
      else if (e.key === 'ArrowLeft') go(step, -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, go, close]);

  if (step === null || !current) return null;
  const shown = STEPS.filter((s) => !s.target || visible(document.querySelector(s.target)));
  const pos = Math.max(0, shown.indexOf(current)) + 1;
  const last = pos === shown.length;

  return (
    <div className="tour" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      {box ? (
        <div className="tour-spot" style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }} aria-hidden="true" />
      ) : (
        <div className="tour-scrim" aria-hidden="true" />
      )}
      <div
        ref={cardRef}
        key={step}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={card ? { transform: `translate(${card.x}px, ${card.y}px)` } : { visibility: 'hidden' }}
      >
        <span className="tour-count">
          {pos} of {shown.length}
        </span>
        <h3 id="tour-title">{current.title}</h3>
        <p id="tour-body">{current.body}</p>
        <div className="tour-actions">
          <button className="btn ghost" onClick={close}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          <div className="spacer" />
          {pos > 1 && (
            <button className="btn" onClick={() => go(step, -1)}>
              Back
            </button>
          )}
          <button ref={nextRef} className="btn primary" onClick={() => (last ? close() : go(step, 1))}>
            {last ? 'Start using it' : pos === 1 ? 'Show me around' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
