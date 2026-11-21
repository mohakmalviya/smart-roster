import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSampleDataset } from './data/seed';
import { buildContext, type Ctx } from './engine/context';
import { shiftMonth } from './engine/dates';
import { applyAvailabilityChanges, generateRoster, type GenerateOptions, type GenerateResult } from './engine/generate';
import type { Dataset, Roster } from './engine/types';
import { validate, type Validation } from './engine/validate';

// ─────────────────────────────────────────────────────────────────────────────
// App state: the dataset (setup tables) and one roster per month.
// The source of truth is the Postgres database behind /api/state and /api/roster,
// shared by everyone who opens the app. Every save carries the version it was based
// on; if someone else saved first the server answers 409 and we load theirs.
// localStorage is a cache, and the whole store when the API can't be reached.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'smart-roster:v1';
const MONTH_KEY = 'smart-roster:month';

/** loading: first read. saved, saving, error: shared database. local: this browser only. */
export type SyncState = 'loading' | 'saved' | 'saving' | 'error' | 'local';

interface Snapshot {
  data: Dataset;
  version: number;
  rosters: Record<string, Roster>;
  rosterVersions: Record<string, number>;
}

/** What the server last confirmed, kept by reference so a save sends only what changed. */
interface Remote {
  version: number;
  rosterVersions: Record<string, number>;
  data: Dataset;
  rosters: Record<string, Roster>;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON: an HTML error page, or a dev server without the API */
  }
  if (!res.ok || json === null) throw new HttpError(res.status, (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return json as T;
}

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
      if (s?.data?.version === 1 && s.rosters && s.month) return { ...s, month: localStorage.getItem(MONTH_KEY) ?? s.month };
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
  sync: SyncState;
  retrySync: () => void;
  toast: string | null;
  notify: (msg: string) => void;
  setMonth: (m: string) => void;
  updateData: (fn: (d: Dataset) => Dataset, note?: string) => void;
  setRoster: (r: Roster) => void;
  generate: (opts?: { freezeBefore?: string; keepLocks?: boolean; data?: Dataset }) => Promise<void>;
  applyAvailability: (dataOverride?: Dataset) => string[];
  resetAll: () => Promise<void>;
  replaceState: (s: AppState) => void;
}

const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>('loading');
  const toastTimer = useRef<number | undefined>(undefined);
  const remote = useRef<Remote | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const flushing = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      localStorage.setItem(MONTH_KEY, state.month);
    } catch {
      /* quota / private mode: keep working in memory */
    }
  }, [state]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  /** Take a server snapshot as the new truth. The month on screen stays put. */
  const adopt = useCallback((snap: Snapshot) => {
    remote.current = { version: snap.version, rosterVersions: { ...snap.rosterVersions }, data: snap.data, rosters: snap.rosters };
    setState((cur) => ({ ...cur, data: snap.data, rosters: snap.rosters }));
    setSync('saved');
  }, []);

  // First load: read the shared database. Without one, carry on in this browser.
  useEffect(() => {
    let live = true;
    api<Snapshot>('GET', '/api/state')
      .then((snap) => live && adopt(snap))
      .catch(() => live && setSync('local'));
    return () => {
      live = false;
    };
  }, [adopt]);

  /** Send whatever differs from the last confirmed snapshot, one request at a time. */
  const flush = useCallback(async () => {
    const r = remote.current;
    if (!r || flushing.current) return;
    flushing.current = true;
    setSync('saving');
    try {
      for (;;) {
        const s = stateRef.current;
        if (s.data === r.data && s.rosters === r.rosters) break;
        if (s.data !== r.data) {
          const data = s.data;
          r.version = (await api<{ version: number }>('PUT', '/api/state', { data, baseVersion: r.version })).version;
          r.data = data;
        }
        for (const m of Object.keys(s.rosters)) {
          const roster = s.rosters[m];
          if (roster === r.rosters[m]) continue;
          r.rosterVersions[m] = (await api<{ version: number }>('PUT', '/api/roster', { roster, baseVersion: r.rosterVersions[m] ?? 0 })).version;
        }
        for (const m of Object.keys(r.rosters)) {
          if (s.rosters[m]) continue;
          await api('DELETE', `/api/roster?month=${encodeURIComponent(m)}`);
          delete r.rosterVersions[m];
        }
        // `s.rosters` is now on the server. The loop runs again only if the user
        // changed something while the requests were in flight.
        r.rosters = s.rosters;
      }
      setSync('saved');
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        try {
          adopt(await api<Snapshot>('GET', '/api/state'));
          notify('Someone else saved changes first. Their version is loaded; redo your last edit if you still need it.');
        } catch {
          setSync('error');
        }
      } else {
        setSync('error');
        notify(`Not saved to the shared database (${e instanceof Error ? e.message : String(e)}). It retries on your next change.`);
      }
    } finally {
      flushing.current = false;
    }
  }, [adopt, notify]);

  // Save shortly after the last change, so typing in a field sends one request.
  useEffect(() => {
    const r = remote.current;
    if (!r || (state.data === r.data && state.rosters === r.rosters)) return;
    setSync('saving');
    const t = window.setTimeout(flush, 600);
    return () => window.clearTimeout(t);
  }, [state.data, state.rosters, flush]);

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
          `${opts.freezeBefore ? 'Re-optimised' : 'Generated'} in ${(res.ms / 1000).toFixed(1)}s after checking ${res.evaluations.toLocaleString()} plans. Uncovered shifts: ${res.gapUnits}.`,
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
    sync,
    retrySync: () => void flush(),
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
    resetAll: async () => {
      if (!remote.current) {
        setState({ data: createSampleDataset(), rosters: {}, month: state.month });
        notify('Sample data restored.');
        return;
      }
      setSync('saving');
      try {
        adopt(await api<Snapshot>('POST', '/api/state?reset=1'));
        notify('Sample data restored for everyone.');
      } catch (e) {
        setSync('error');
        notify('Reset failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    },
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
