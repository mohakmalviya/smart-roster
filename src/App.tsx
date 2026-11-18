import { useState } from 'react';
import { reqLabel } from './engine/context';
import { monthLabel, shiftMonth } from './engine/dates';
import { cloneCells } from './engine/context';
import { useStore } from './state';
import { downloadFile, Modal, SevBadge } from './ui/common';
import { Changes } from './views/Changes';
import { Guide } from './views/Guide';
import { Issues } from './views/Issues';
import { Overview } from './views/Overview';
import { RosterView, type Lens } from './views/RosterView';
import { Setup } from './views/Setup';

type Tab = 'overview' | 'roster' | 'issues' | 'changes' | 'setup' | 'guide';

export function App() {
  const store = useStore();
  const { month, roster, validation, busy, toast, setMonth, generate } = store;
  const [tab, setTab] = useState<Tab>('overview');
  const [lens, setLens] = useState<Lens>('company');
  const [sel, setSelState] = useState<Record<Lens, string>>({ company: '', pod: '', brand: '', process: '', employee: '' });
  const [publishing, setPublishing] = useState(false);
  const [reopt, setReopt] = useState(false);

  const openRoster = (l: Lens, v?: string) => {
    setLens(l);
    if (v) setSelState((s) => ({ ...s, [l]: v }));
    setTab('roster');
  };

  const s = validation?.summary;
  const nav: [Tab, string, string?][] = [
    ['overview', 'Overview'],
    ['roster', 'Roster'],
    ['issues', 'Issues', s ? String(s.errors + s.warnings) : undefined],
    ['changes', 'Changes & approvals'],
    ['setup', 'Setup'],
    ['guide', 'How it works'],
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brandmark">
          <span className="logo">SR</span>
          Smart Roster
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            ‹
          </button>
          <b style={{ minWidth: 120, textAlign: 'center' }}>{monthLabel(month)}</b>
          <button className="btn sm ghost" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            ›
          </button>
        </div>
        {roster && (
          <span className={`badge ${roster.status === 'PUBLISHED' ? 'ok' : 'neutral'}`}>
            {roster.status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </span>
        )}
        {s && (
          <span className="small muted">
            {s.coveragePct.toFixed(1)}% covered · {s.errors} must-fix · {s.warnings} warnings
          </span>
        )}
        <div className="spacer" />
        {busy && <span className="small muted">⏳ {busy}</span>}
        <button className="btn primary" disabled={!!busy} onClick={() => generate()}>
          {roster ? 'Regenerate' : 'Generate roster'}
        </button>
        {roster && (
          <>
            <button className="btn" disabled={!!busy} onClick={() => setReopt(true)}>
              Re-optimise from…
            </button>
            <button className="btn" disabled={!!busy} onClick={() => setPublishing(true)}>
              Publish
            </button>
            <button className="btn ghost" onClick={() => exportCsv(store)}>
              CSV
            </button>
          </>
        )}
      </header>

      <nav className="sidenav">
        {nav.map(([t, label, count]) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
            {count && count !== '0' && (
              <span className="badge neutral" style={{ marginLeft: 6 }}>
                {count}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === 'overview' && <Overview openRoster={openRoster} goIssues={() => setTab('issues')} />}
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
