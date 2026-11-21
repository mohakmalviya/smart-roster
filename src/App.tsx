import { useEffect, useRef, useState, type ReactNode } from 'react';
import { approvalState } from './engine/approval';
import { reqLabel } from './engine/context';
import { monthLabel, shiftMonth, plural } from './engine/dates';
import { cloneCells } from './engine/context';
import { useStore } from './state';
import { downloadFile, Modal, SevBadge } from './ui/common';
import { IconChevronLeft, IconChevronRight, IconLoader, IconMoon, IconMore, IconSun } from './ui/icons';
import { Changes } from './views/Changes';
import { Guide } from './views/Guide';
import { Issues } from './views/Issues';
import { Overview } from './views/Overview';
import { RosterView, type Lens } from './views/RosterView';
import { Setup } from './views/Setup';

type Tab = 'overview' | 'roster' | 'issues' | 'changes' | 'setup' | 'guide';

const NAV: { tab: Tab; label: string }[] = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'roster', label: 'Roster' },
  { tab: 'issues', label: 'Issues' },
  { tab: 'changes', label: 'Changes and leave' },
  { tab: 'setup', label: 'Setup' },
  { tab: 'guide', label: 'How it works' },
];

export function App() {
  const store = useStore();
  const { month, roster, validation, busy, toast, setMonth, generate } = store;
  const [tab, setTab] = useState<Tab>('overview');
  const [lens, setLens] = useState<Lens>('company');
  const [sel, setSelState] = useState<Record<Lens, string>>({ company: '', pod: '', brand: '', process: '', employee: '' });
  const [publishing, setPublishing] = useState(false);
  const [reopt, setReopt] = useState(false);

  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const openRoster = (l: Lens, v?: string) => {
    setLens(l);
    if (v) setSelState((x) => ({ ...x, [l]: v }));
    go('roster');
  };

  const s = validation?.summary;
  const issueCount = s ? s.errors + s.warnings : 0;
  const published = roster?.status === 'PUBLISHED';

  return (
    <div className="app">
      <div className="masthead">
        <header className="topbar">
          <span className="wordmark">Smart Roster</span>

          <div className="monthnav" aria-label="Month">
            <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
              <IconChevronLeft size={16} />
            </button>
            <b>{monthLabel(month)}</b>
            <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
              <IconChevronRight size={16} />
            </button>
          </div>

          {roster && <span className={`docstate ${published ? 'pub' : ''}`}>{published ? 'Published' : 'Draft'}</span>}
          <SyncStatus />

          {s && tab !== 'overview' && (
            <span className="summary">
              <span className="cov-part">{s.coveragePct.toFixed(1)}% covered, </span>
              {s.errors > 0 ? (
                <button className="linkbtn" onClick={() => go('issues')}>
                  {s.errors} must fix
                </button>
              ) : (
                <span className="ok-text">nothing to fix</span>
              )}
            </span>
          )}

          <div className="spacer" />
          {busy && (
            <span className="busy small">
              <IconLoader size={14} /> <span className="busy-t">{busy}</span>
            </span>
          )}
          {roster && (
            <div className="actions-wide">
              <button className="btn" disabled={!!busy} onClick={() => setReopt(true)} title="Keep the days before a date and re-plan the rest">
                Re-optimise
              </button>
              <button className="btn" disabled={!!busy} onClick={() => setPublishing(true)}>
                Publish
              </button>
              <button className="btn" onClick={() => exportCsv(store)}>
                Export CSV
              </button>
            </div>
          )}
          <ThemeSwitch />
          <button className="btn primary" disabled={!!busy} onClick={() => generate()}>
            {roster ? 'Regenerate' : 'Generate roster'}
          </button>
          {roster && (
            <MoreMenu
              disabled={!!busy}
              items={[
                ['Re-optimise from a date…', null, () => setReopt(true)],
                ['Publish…', null, () => setPublishing(true)],
                ['Export CSV', null, () => exportCsv(store)],
              ]}
            />
          )}
        </header>

        <nav className="navtabs" aria-label="Sections">
          {NAV.map((n) => (
            <button key={n.tab} className={tab === n.tab ? 'active' : ''} onClick={() => go(n.tab)} aria-current={tab === n.tab ? 'page' : undefined}>
              {n.label}
              {n.tab === 'issues' && issueCount > 0 && <span className={`count ${s && s.errors ? 'err' : ''}`}>{issueCount}</span>}
            </button>
          ))}
        </nav>
      </div>

      <main className="main">
        {tab === 'overview' && <Overview openRoster={openRoster} goIssues={() => go('issues')} />}
        {tab === 'roster' && <RosterView lens={lens} setLens={setLens} sel={sel} setSel={(l, v) => setSelState((x) => ({ ...x, [l]: v }))} />}
        {tab === 'issues' && <Issues />}
        {tab === 'changes' && <Changes />}
        {tab === 'setup' && <Setup />}
        {tab === 'guide' && <Guide />}
      </main>

      {publishing && <PublishModal onClose={() => setPublishing(false)} />}
      {reopt && <ReoptModal onClose={() => setReopt(false)} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

const SYNC_TEXT = {
  loading: ['Loading…', 'Reading the shared database'],
  saving: ['Saving…', 'Sending your change to the shared database'],
  saved: ['Saved', 'Saved to the shared database. Everyone who opens the app sees this version.'],
  error: ['Not saved', 'The last change did not reach the shared database. Click to try again.'],
  local: ['This browser only', 'The shared database is not reachable, so changes are kept in this browser.'],
} as const;

function SyncStatus() {
  const { sync, retrySync } = useStore();
  const [text, title] = SYNC_TEXT[sync];
  if (sync === 'error')
    return (
      <button className="syncstate err linkbtn" onClick={retrySync} title={title}>
        {text}, retry
      </button>
    );
  return (
    <span className={`syncstate ${sync}`} title={title} role="status">
      {text}
    </span>
  );
}

function MoreMenu({ items, disabled }: { items: [string, ReactNode, () => void][]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="more" ref={ref}>
      <button className="btn icon" onClick={() => setOpen((o) => !o)} aria-label="More actions" aria-expanded={open}>
        <IconMore size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map(([label, icon, fn]) => (
            <button
              key={label}
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                fn();
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PublishModal({ onClose }: { onClose: () => void }) {
  const { roster, validation, setRoster, notify, ctx, data } = useStore();
  const errors = validation?.issues.filter((i) => i.severity === 'ERROR') ?? [];
  const [ack, setAck] = useState(false);
  const [ackPods, setAckPods] = useState(false);
  if (!roster) return null;
  const unapproved = data.pods.filter((p) => approvalState(ctx, roster, p.id) !== 'approved');
  return (
    <Modal
      title="Publish roster"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={(errors.length > 0 && !ack) || (unapproved.length > 0 && !ackPods)}
            onClick={() => {
              const notes = [
                errors.length ? `${errors.length} acknowledged ${plural(errors.length, 'issue')}` : '',
                unapproved.length ? `${unapproved.length} ${plural(unapproved.length, 'pod')} not approved by the lead` : '',
              ].filter(Boolean);
              setRoster({
                ...roster,
                status: 'PUBLISHED',
                publishedAt: new Date().toISOString(),
                publishedCells: cloneCells(roster.cells),
                acknowledged: errors.map((e) => e.key),
                log: [...roster.log, { at: new Date().toISOString(), text: `Published${notes.length ? ` with ${notes.join(' and ')}` : ''}.` }],
              });
              notify('Roster published. Later changes will be tracked against this version.');
              onClose();
            }}
          >
            Publish
          </button>
        </>
      }
    >
      {errors.length === 0 ? (
        <div className="banner ok">No must-fix issues. The roster meets every mandatory rule.</div>
      ) : (
        <>
          <div className="banner err">
            {errors.length} must-fix {plural(errors.length, 'issue')} remain. You can still publish if they have been handled outside the tool (for example, a
            client agreed to reduced cover), but you need to acknowledge them.
          </div>
          <div className="stack" style={{ gap: 4, maxHeight: 260, overflow: 'auto' }}>
            {errors.map((e) => (
              <div key={e.key} className="small row" style={{ flexWrap: 'nowrap' }}>
                <SevBadge s={e.severity} /> {e.title}
              </div>
            ))}
          </div>
          <label className="row small">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have reviewed these and accept them for this month.
          </label>
        </>
      )}
      {unapproved.length === 0 ? (
        <div className="banner ok">Every pod lead has approved their pod.</div>
      ) : (
        <>
          <div className="banner warn">
            {unapproved.length} of {data.pods.length} {plural(data.pods.length, 'pod')} {unapproved.length === 1 ? 'has' : 'have'} no current approval from the
            pod lead. Leads approve on the Roster tab, Pod view.
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {unapproved.map((p) => {
              const lead = p.leadId ? ctx.emp.get(p.leadId)?.name : undefined;
              const st = approvalState(ctx, roster, p.id);
              return (
                <div key={p.id} className="small">
                  Pod {p.name}: {!lead ? 'no lead set' : st === 'changed' ? `changed since ${lead} approved` : `waiting for ${lead}`}
                </div>
              );
            })}
          </div>
          <label className="row small">
            <input type="checkbox" checked={ackPods} onChange={(e) => setAckPods(e.target.checked)} /> Publish without these approvals.
          </label>
        </>
      )}
      <p className="small muted">After publishing, every change is tracked and shown as a notification to the people affected (Changes tab).</p>
    </Modal>
  );
}

function ReoptModal({ onClose }: { onClose: () => void }) {
  const { ctx, generate } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(ctx.dates.includes(today) ? today : ctx.dates[Math.min(14, ctx.dates.length - 1)]);
  return (
    <Modal
      title="Re-optimise the rest of the month"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onClose();
              generate({ freezeBefore: from });
            }}
          >
            Re-optimise
          </button>
        </>
      }
    >
      <p className="small">
        Days before the chosen date stay exactly as they are (they have happened or people have planned around them). From that date on, the engine re-plans
        weekly offs and cover. Cells you edited by hand stay locked.
      </p>
      <label className="field">
        Re-plan from
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {ctx.dates.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
    </Modal>
  );
}

function exportCsv(store: ReturnType<typeof useStore>) {
  const { ctx, roster, data, month } = store;
  if (!roster) return;
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ['Employee', 'Pod', 'Role', ...ctx.dates];
  const rows = ctx.emps.map((e) => [
    e.name,
    data.pods.find((p) => p.id === e.podId)?.name ?? '',
    e.role,
    ...ctx.dates.map((d) => {
      const c = roster.cells[e.id]?.[d];
      if (!c) return '';
      if (c.status !== 'WORK') return c.status;
      if (!c.duties.length) return 'STANDBY';
      return c.duties.map((x) => reqLabel(ctx, x.requirementId) + (x.backup ? ' (backup)' : '')).join(' | ');
    }),
  ]);
  downloadFile(`roster-${month}.csv`, [head, ...rows].map((r) => r.map(esc).join(',')).join('\n'), 'text/csv');
}

function ThemeSwitch() {
  const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const [dark, setDark] = useState(() => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : systemDark();
  });
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try {
      localStorage.setItem('smart-roster:theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button className="btn ghost icon theme-switch" onClick={flip} title={label} aria-label={label}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
