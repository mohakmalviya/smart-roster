import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSampleDataset } from './data/seed';
import { buildContext, type Ctx } from './engine/context';
import { shiftMonth } from './engine/dates';
import { applyAvailabilityChanges, generateRoster, type GenerateOptions, type GenerateResult } from './engine/generate';
import type { Dataset, Roster } from './engine/types';
import { validate, type Validation } from './engine/validate';

// ─────────────────────────────────────────────────────────────────────────────
// App state: the dataset (the "database") and one roster per month.
// Persisted in the browser (localStorage) behind this single module, so it can
// be swapped for a server/DB without touching views or the engine.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'smart-roster:v1';

export interface AppState {
  data: Dataset;
  rosters: Record<string, Roster>;
  month: string;
}

function defaultMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 7);
}

function initialState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s?.data?.version === 1 && s.rosters && s.month) return s;
    }
  } catch {
    /* storage unavailable or corrupt: fall back to sample data */
  }
  return { data: createSampleDataset(), rosters: {}, month: defaultMonth() };
}

// ── Generation runs in a Web Worker so the UI never freezes ──────────────────
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: GenerateResult) => void; reject: (e: unknown) => void }>();

function generateAsync(data: Dataset, month: string, opts: GenerateOptions): Promise<GenerateResult> {
  try {
    if (!worker) {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent) => {
        const { id, ok, result, error } = e.data;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (ok) p.resolve(result);
        else p.reject(new Error(error));
      };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker!.postMessage({ id, data, month, opts });
    });
  } catch {
    return Promise.resolve(generateRoster(data, month, opts));
  }
}

export interface Store {
  state: AppState;
  data: Dataset;
  month: string;
  roster: Roster | undefined;
  ctx: Ctx;
  validation: Validation | null;
  busy: string | null;
  toast: string | null;
  notify: (msg: string) => void;
  setMonth: (m: string) => void;
  updateData: (fn: (d: Dataset) => Dataset, note?: string) => void;
  setRoster: (r: Roster) => void;
  generate: (opts?: { freezeBefore?: string; keepLocks?: boolean; data?: Dataset }) => Promise<void>;
  applyAvailability: (dataOverride?: Dataset) => string[];
  resetAll: () => void;
  replaceState: (s: AppState) => void;
}

const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* quota / private mode: keep working in memory */
    }
  }, [state]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const { data, month, rosters } = state;
  const roster = rosters[month];
  const prev = rosters[shiftMonth(month, -1)]?.cells;
  const next = rosters[shiftMonth(month, 1)]?.cells;
  const ctx = useMemo(() => buildContext(data, month, { prev, next }), [data, month, prev, next]);
  const validation = useMemo(() => (roster ? validate(ctx, roster.cells) : null), [ctx, roster]);

  const setRoster = useCallback((r: Roster) => setState((s) => ({ ...s, rosters: { ...s.rosters, [r.month]: r } })), []);

  const generate = useCallback(
    async (opts: { freezeBefore?: string; keepLocks?: boolean; data?: Dataset } = {}) => {
      setBusy(opts.freezeBefore ? 'Re-optimising…' : 'Generating roster…');
      try {
        const s = state;
        const existing = s.rosters[s.month];
        const d = opts.data ?? s.data;
        const res = await generateAsync(d, s.month, {
          existing: opts.keepLocks === false ? undefined : existing,
          freezeBefore: opts.freezeBefore,
          prev: s.rosters[shiftMonth(s.month, -1)]?.cells,
          next: s.rosters[shiftMonth(s.month, 1)]?.cells,
        });
        setState((cur) => ({ ...cur, data: opts.data ?? cur.data, rosters: { ...cur.rosters, [res.roster.month]: res.roster } }));
        notify(
          `${opts.freezeBefore ? 'Re-optimised' : 'Generated'} in ${(res.ms / 1000).toFixed(1)}s — ${res.evaluations.toLocaleString()} plans evaluated, ${res.gapUnits} uncovered head-day(s).`,
        );
      } catch (e) {
        notify('Generation failed: ' + String(e));
      } finally {
        setBusy(null);
      }
    },
    [state, notify],
  );

  const applyAvailability = useCallback(
    (dataOverride?: Dataset) => {
      const d = dataOverride ?? state.data;
      const r = state.rosters[state.month];
      if (!r) return [];
      const res = applyAvailabilityChanges(d, r);
      setState((cur) => ({ ...cur, data: d, rosters: { ...cur.rosters, [r.month]: res.roster } }));
      return res.changes;
    },
    [state],
  );

  const store: Store = {
    state,
    data,
    month,
    roster,
    ctx,
    validation,
    busy,
    toast,
    notify,
    setMonth: (m) => setState((s) => ({ ...s, month: m })),
    updateData: (fn, note) => {
      setState((s) => ({ ...s, data: fn(s.data) }));
      if (note) notify(note);
    },
    setRoster,
    generate,
    applyAvailability,
    resetAll: () => setState({ data: createSampleDataset(), rosters: {}, month: state.month }),
    replaceState: (s) => setState(s),
  };

  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
