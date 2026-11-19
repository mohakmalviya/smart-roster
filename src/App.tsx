import { useEffect, useRef, useState, type ReactNode } from 'react';
import { reqLabel } from './engine/context';
import { monthLabel, shiftMonth } from './engine/dates';
import { cloneCells } from './engine/context';
import { useStore } from './state';
import { downloadFile, Modal, SevBadge } from './ui/common';
import {
  IconAlert,
  IconBook,
  IconCalendar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconLoader,
  IconMore,
  IconOverview,
  IconRewind,
  IconSend,
  IconSettings,
  IconSwap,
  IconWand,
} from './ui/icons';
import { Changes } from './views/Changes';
import { Guide } from './views/Guide';
import { Issues } from './views/Issues';
import { Overview } from './views/Overview';
import { RosterView, type Lens } from './views/RosterView';
import { Setup } from './views/Setup';

type Tab = 'overview' | 'roster' | 'issues' | 'changes' | 'setup' | 'guide';

interface NavItem {
  tab: Tab;
  label: string;
  short: string;
  icon: ReactNode;
  group: string;
  sub: string;
}

const NAV: NavItem[] = [
  { tab: 'overview', label: 'Overview', short: 'Overview', icon: <IconOverview />, group: 'Plan', sub: 'Coverage, open problems and who is working on any day.' },
  { tab: 'roster', label: 'Roster', short: 'Roster', icon: <IconCalendar />, group: 'Plan', sub: 'The month by company, pod, brand, process or person. Click any cell to edit it.' },
  { tab: 'issues', label: 'Issues', short: 'Issues', icon: <IconAlert />, group: 'Plan', sub: 'Every rule the roster breaks, why it happened, and how to fix it.' },
  { tab: 'changes', label: 'Changes & approvals', short: 'Changes', icon: <IconSwap />, group: 'Operate', sub: 'Report sickness, approve leave and see who needs to hear about a change.' },
  { tab: 'setup', label: 'Setup', short: 'Setup', icon: <IconSettings />, group: 'Configure', sub: 'Brands, processes, people, calendars and rules. Everything here is editable.' },
  { tab: 'guide', label: 'How it works', short: 'Guide', icon: <IconBook />, group: 'Configure', sub: 'What the engine does, which rules are mandatory, and the assumptions behind it.' },
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
  const page = NAV.find((n) => n.tab === tab)!;
  const published = roster?.status === 'PUBLISHED';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brandmark">
          <span className="logo" aria-hidden="true">
            <IconCalendar size={17} />
          </span>
          <span className="bm-text">
            Smart Roster
            <span className="bm-sub">Roster planning</span>
          </span>
        </div>

        <div className="monthnav" aria-label="Month">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <IconChevronLeft size={16} />
          </button>
          <b>{monthLabel(month)}</b>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            <IconChevronRight size={16} />
          </button>
        </div>

        {roster && (
          <span className={`status-pill ${published ? 'pub' : 'draft'}`}>
            <span className="dot" />
            {published ? 'Published' : 'Draft'}
          </span>
        )}

        {s && (
          <div className="health" title={`${s.coveredUnits} of ${s.requiredUnits} head-days covered`}>
            <div className="health-top">
              <span>
                <b>{s.coveragePct.toFixed(1)}%</b> covered
              </span>
              {s.errors > 0 ? (
                <button className="mini-err" onClick={() => go('issues')}>
                  {s.errors} must-fix
                </button>
              ) : (
                <span className="mini-ok">
                  <IconCheck size={12} /> valid
                </span>
              )}
            </div>
            <div className="meter">
              <span style={{ width: `${Math.min(100, s.coveragePct)}%` }} className={s.gapUnits ? 'has-gap' : ''} />
            </div>
          </div>
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
              <IconRewind size={15} /> Re-optimise
            </button>
            <button className="btn" disabled={!!busy} onClick={() => setPublishing(true)}>
              <IconSend size={15} /> Publish
            </button>
            <button className="btn icon" onClick={() => exportCsv(store)} title="Export CSV" aria-label="Export CSV">
              <IconDownload size={16} />
            </button>
          </div>
        )}
        <button className="btn primary" disabled={!!busy} onClick={() => generate()}>
          <IconWand size={15} />
          <span>{roster ? 'Regenerate' : 'Generate roster'}</span>
        </button>
        {roster && (
          <MoreMenu
            disabled={!!busy}
            items={[
              ['Re-optimise from a date…', <IconRewind size={15} />, () => setReopt(true)],
              ['Publish roster…', <IconSend size={15} />, () => setPublishing(true)],
              ['Export CSV', <IconDownload size={15} />, () => exportCsv(store)],
            ]}
          />
        )}
      </header>

      <nav className="sidenav" aria-label="Sections">
        {['Plan', 'Operate', 'Configure'].map((g) => (
          <div key={g} className="navgroup">
            <div className="navlabel">{g}</div>
            {NAV.filter((n) => n.group === g).map((n) => (
              <button key={n.tab} className={tab === n.tab ? 'active' : ''} onClick={() => go(n.tab)} aria-current={tab === n.tab ? 'page' : undefined}>
                {n.icon}
                <span className="nl">{n.label}</span>
                <span className="ns">{n.short}</span>
                {n.tab === 'issues' && issueCount > 0 && <span className={`count ${s && s.errors ? 'err' : ''}`}>{issueCount}</span>}
              </button>
            ))}
          </div>
        ))}
        {s && (
          <div className="navcard">
            <div className="navlabel" style={{ padding: 0 }}>
              {monthLabel(month)}
            </div>
            <div className="ring-row">
              <Ring pct={s.coveragePct} bad={s.gapUnits > 0} />
              <div className="small">
                <div>
                  <b>{s.coveredUnits}</b>
                  <span className="muted"> / {s.requiredUnits} head-days</span>
                </div>
                <div className={s.errors ? 'err-text' : 'ok-text'}>{s.errors ? `${s.errors} must-fix issue${s.errors === 1 ? '' : 's'}` : 'All rules met'}</div>
              </div>
            </div>
          </div>
        )}
      </nav>

      <main className="main">
        <div className="pagehead">
          <h1>{tab === 'overview' ? monthLabel(month) : page.label}</h1>
          <p>{page.sub}</p>
        </div>
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
          <span className="toast-ico">
            <IconCheck size={13} />
          </span>
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

function Ring({ pct, bad }: { pct: number; bad: boolean }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <svg width="46" height="46" viewBox="0 0 44 44" className="ring" aria-hidden="true">
      <circle cx="22" cy="22" r={r} className="ring-bg" />
      <circle
        cx="22"
        cy="22"
        r={r}
        className={`ring-fg ${bad ? 'bad' : ''}`}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(100, pct) / 100)}
        transform="rotate(-90 22 22)"
      />
      <text x="22" y="25.5" textAnchor="middle">
        {Math.floor(pct)}%
      </text>
    </svg>
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
  const { roster, validation, setRoster, notify } = useStore();
  const errors = validation?.issues.filter((i) => i.severity === 'ERROR') ?? [];
  const [ack, setAck] = useState(false);
  if (!roster) return null;
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
            disabled={errors.length > 0 && !ack}
            onClick={() => {
              setRoster({
                ...roster,
                status: 'PUBLISHED',
                publishedAt: new Date().toISOString(),
                publishedCells: cloneCells(roster.cells),
                acknowledged: errors.map((e) => e.key),
                log: [
                  ...roster.log,
                  { at: new Date().toISOString(), text: `Published${errors.length ? ` with ${errors.length} acknowledged issue(s)` : ''}.` },
                ],
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
            {errors.length} must-fix issue(s) remain. You can still publish if they have been handled outside the tool (for example, a client agreed to reduced
            cover), but you need to acknowledge them.
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
        Days before the chosen date stay exactly as they are (they have happened or people have planned around them). From that date on, the engine re-plans weekly
        offs and cover. Cells you edited by hand stay locked.
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
