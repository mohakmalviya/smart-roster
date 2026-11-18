import { useState } from 'react';
import { fmtDate, weekday, WEEKDAY_LETTER } from '../engine/dates';
import { useStore } from '../state';
import { Empty, IssueCard, ProcTag } from '../ui/common';
import type { Lens } from './RosterView';

export function Overview({ openRoster, goIssues }: { openRoster: (l: Lens, v?: string) => void; goIssues: () => void }) {
  const { ctx, roster, validation, data, generate, busy } = useStore();
  const [day, setDay] = useState<string>(() => {
    const t = new Date().toISOString().slice(0, 10);
    return ctx.dates.includes(t) ? t : ctx.dates[0];
  });
  const single = data.brands.filter((b) => {
    const reqs = ctx.reqs.filter((r) => r.brandId === b.id).map((r) => r.id);
    return new Set(reqs.flatMap((r) => ctx.primariesOf.get(r) ?? [])).size <= 1;
  }).length;

  const kpisStatic = (
    <>
      <div className="panel kpi">
        <div className="label">Employees</div>
        <div className="value">{ctx.emps.length}</div>
        <div className="sub">{data.pods.length} pods · {ctx.emps.filter((e) => e.role === 'FLOATER').length} floaters</div>
      </div>
      <div className="panel kpi">
        <div className="label">Brands</div>
        <div className="value">{data.brands.length}</div>
        <div className="sub">{single} single-resource ({Math.round((single / Math.max(1, data.brands.length)) * 100)}%)</div>
      </div>
      <div className="panel kpi">
        <div className="label">Brand processes</div>
        <div className="value">{ctx.reqs.length}</div>
        <div className="sub">{data.processes.length} process types</div>
      </div>
    </>
  );

  if (!roster || !validation)
    return (
      <div className="stack">
        <div className="kpis">{kpisStatic}</div>
        <Empty>
          <h3>No roster for this month yet</h3>
          <p className="small">The engine plans weekly offs, rotates public holidays and assigns backup cover from the rules in Setup, then lists anything it could not solve.</p>
          <button className="btn primary" disabled={!!busy} onClick={() => generate()}>
            Generate roster
          </button>
        </Empty>
      </div>
    );

  const s = validation.summary;
  const top = validation.issues.filter((i) => i.severity === 'ERROR').slice(0, 4);
  const pods = data.pods;

  return (
    <div className="stack">
      <div className="kpis">
        <div className="panel kpi">
          <div className="label">Coverage</div>
          <div className="value" style={{ color: s.gapUnits ? 'var(--err)' : 'var(--ok)' }}>
            {s.coveragePct.toFixed(1)}%
          </div>
          <div className="sub">
            {s.coveredUnits}/{s.requiredUnits} head-days · {s.gapUnits} uncovered
          </div>
        </div>
        <div className="panel kpi">
          <div className="label">Must-fix issues</div>
          <div className="value" style={{ color: s.errors ? 'var(--err)' : 'var(--ok)' }}>
            {s.errors}
          </div>
          <div className="sub">
            {s.warnings} warnings · {s.infos} info
          </div>
        </div>
        {kpisStatic}
      </div>

      <div className="panel panel-pad stack" style={{ gap: 8 }}>
        <div className="row">
          <h3>Coverage heatmap</h3>
          <span className="small muted">Each cell is one brand process on one day. Click a row to open the brand.</span>
        </div>
        <Heatmap onDay={setDay} onBrand={(b) => openRoster('brand', b)} />
      </div>

      {top.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <h3>Needs attention</h3>
            <div className="spacer" />
            <button className="btn sm ghost" onClick={goIssues}>
              All issues →
            </button>
          </div>
          {top.map((i) => (
            <IssueCard key={i.key} issue={i} />
          ))}
        </div>
      )}

      <div className="panel panel-pad stack" style={{ gap: 10 }}>
        <div className="row">
          <h3>Who is working on</h3>
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {ctx.dates.map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)}
                {ctx.holidays.get(d) ? ` — ${ctx.holidays.get(d)}` : ''}
              </option>
            ))}
          </select>
          {s.gapDays.has(day) && <span className="badge err">coverage gap</span>}
        </div>
        {pods.map((p) => {
          const brands = data.brands.filter((b) => b.podId === p.id);
          const lead = p.leadId ? ctx.emp.get(p.leadId) : undefined;
          return (
            <div key={p.id} className="stack" style={{ gap: 6 }}>
              <div className="row">
                <button className="btn sm ghost" onClick={() => openRoster('pod', p.id)}>
                  <b>Pod {p.name}</b>
                </button>
                {lead && (
                  <span className="small muted">
                    lead {lead.name} — {roster.cells[lead.id]?.[day]?.status === 'WORK' ? 'in' : 'off'}
                  </span>
                )}
              </div>
              <div className="dayboard">
                {brands.map((b) => {
                  const reqs = ctx.reqs.filter((r) => r.brandId === b.id);
                  const short = reqs.some((r) => validation.coverage[r.id][day].staffed < validation.coverage[r.id][day].required);
                  return (
                    <div key={b.id} className={`brandcard ${short ? 'short' : ''}`}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <button className="btn sm ghost" style={{ padding: 0 }} onClick={() => openRoster('brand', b.id)}>
                          <b>{b.name}</b>
                        </button>
                        <span className="faint small">{b.code}</span>
                      </div>
                      {reqs.map((r) => {
                        const c = validation.coverage[r.id][day];
                        return (
                          <div key={r.id} className="procline">
                            <ProcTag ctx={ctx} reqId={r.id} />
                            <span style={{ flex: 1 }}>
                              {c.required === 0 && c.staffed === 0 ? (
                                <span className="faint">closed</span>
                              ) : (
                                <>
                                  {c.primaries.map((x) => ctx.emp.get(x)?.name.split(' ')[0]).join(', ')}
                                  {c.backups.length > 0 && (
                                    <span style={{ color: 'var(--accent)' }}>
                                      {c.primaries.length ? ', ' : ''}
                                      {c.backups.map((x) => ctx.emp.get(x)?.name.split(' ')[0] + ' ↺').join(', ')}
                                    </span>
                                  )}
                                  {c.staffed === 0 && <span style={{ color: 'var(--err)' }}>nobody</span>}
                                </>
                              )}
                            </span>
                            {c.required > 0 && (
                              <span className={`small ${c.staffed < c.required ? '' : 'faint'}`} style={c.staffed < c.required ? { color: 'var(--err)', fontWeight: 600 } : {}}>
                                {c.staffed}/{c.required}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="small faint">↺ = covering as backup</div>
      </div>
    </div>
  );
}

function Heatmap({ onDay, onBrand }: { onDay: (d: string) => void; onBrand: (b: string) => void }) {
  const { ctx, validation } = useStore();
  if (!validation) return null;
  const color = (req: number, st: number) =>
    req === 0 ? (st ? 'var(--st-backup)' : 'var(--panel-2)') : st < req ? 'var(--err)' : st > req ? 'var(--ok-soft, #86efac)' : 'var(--ok)';
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="heat" style={{ gridTemplateColumns: `140px repeat(${ctx.dates.length}, minmax(12px, 1fr))`, minWidth: 140 + ctx.dates.length * 14 }}>
        <div />
        {ctx.dates.map((d) => (
          <button
            key={d}
            className="faint"
            style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', fontWeight: validation.summary.gapDays.has(d) ? 700 : 400, color: validation.summary.gapDays.has(d) ? 'var(--err)' : undefined }}
            onClick={() => onDay(d)}
            title={fmtDate(d)}
          >
            {WEEKDAY_LETTER[weekday(d)]}
          </button>
        ))}
        {ctx.reqs.map((r) => (
          <div key={r.id} style={{ display: 'contents' }}>
            <button
              className="small"
              style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: 0, color: 'var(--text)' }}
              onClick={() => onBrand(r.brandId)}
              title={`${ctx.brand.get(r.brandId)?.name} · ${ctx.process.get(r.processId)?.name}`}
            >
              {ctx.brand.get(r.brandId)?.name} · {ctx.process.get(r.processId)?.code}
            </button>
            {ctx.dates.map((d) => {
              const c = validation.coverage[r.id][d];
              return (
                <div
                  key={d}
                  className="hc"
                  style={{ background: color(c.required, c.staffed), opacity: c.required === 0 ? 1 : c.backups.length ? 0.65 : 1, cursor: 'pointer' }}
                  title={`${ctx.brand.get(r.brandId)?.name} · ${ctx.process.get(r.processId)?.code} · ${fmtDate(d)}\n${c.staffed}/${c.required}${c.backups.length ? ' (backup cover)' : ''}`}
                  onClick={() => onDay(d)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span><span className="sw" style={{ background: 'var(--ok)' }} />covered</span>
        <span><span className="sw" style={{ background: 'var(--ok)', opacity: 0.65 }} />covered by a backup</span>
        <span><span className="sw" style={{ background: 'var(--err)' }} />short</span>
        <span><span className="sw" style={{ background: 'var(--panel-2)' }} />closed</span>
      </div>
    </div>
  );
}
