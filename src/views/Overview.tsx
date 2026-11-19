import { useState, type ReactNode } from 'react';
import { fmtDate, monthLabel, weekday, WEEKDAY_LETTER } from '../engine/dates';
import { useStore } from '../state';
import { IssueCard, ProcTag } from '../ui/common';
import { IconChevronLeft, IconChevronRight } from '../ui/icons';
import type { Lens } from './RosterView';

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub: ReactNode; tone?: 'ok' | 'bad' }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

export function Overview({ openRoster, goIssues }: { openRoster: (l: Lens, v?: string) => void; goIssues: () => void }) {
  const { ctx, roster, validation, data, generate, busy, month } = useStore();
  const [day, setDay] = useState<string>(() => {
    const t = new Date().toISOString().slice(0, 10);
    return ctx.dates.includes(t) ? t : ctx.dates[0];
  });
  const single = data.brands.filter((b) => {
    const reqs = ctx.reqs.filter((r) => r.brandId === b.id).map((r) => r.id);
    return new Set(reqs.flatMap((r) => ctx.primariesOf.get(r) ?? [])).size <= 1;
  }).length;
  const floaters = ctx.emps.filter((e) => e.role === 'FLOATER').length;
  const singlePct = Math.round((single / Math.max(1, data.brands.length)) * 100);

  if (!roster || !validation) {
    const inMonth = (from: string, to: string) => from <= ctx.dates[ctx.dates.length - 1] && to >= ctx.dates[0];
    const leaves = data.leaves.filter((l) => inMonth(l.start, l.end));
    const approved = leaves.filter((l) => l.status === 'APPROVED').length;
    return (
      <div className="panel emptyplan">
        <div>
          <h2>No roster for {monthLabel(month)} yet</h2>
          <p>
            Generating plans weekly offs and holiday duty for everyone, then fills gaps from each process's backups. Anything it can't cover shows up under
            Issues with the reason.
          </p>
          <button className="btn primary lg" disabled={!!busy} onClick={() => generate()}>
            {busy ? busy : `Generate ${monthLabel(month)}`}
          </button>
        </div>
        <dl className="inputs">
          <div className="caption">Inputs from Setup</div>
          <dt>People</dt>
          <dd>
            {ctx.emps.length} <span className="faint">({floaters} floaters)</span>
          </dd>
          <dt>Pods</dt>
          <dd>{data.pods.length}</dd>
          <dt>Brands</dt>
          <dd>
            {data.brands.length} <span className="faint">({singlePct}% single-person)</span>
          </dd>
          <dt>Brand processes</dt>
          <dd>{ctx.reqs.length}</dd>
          <dt>Public holidays</dt>
          <dd>{ctx.dates.filter((d) => ctx.holidays.has(d)).length}</dd>
          <dt>Leave requests</dt>
          <dd>
            {leaves.length} <span className="faint">({approved} approved)</span>
          </dd>
        </dl>
      </div>
    );
  }

  const s = validation.summary;
  const top = validation.issues.filter((i) => i.severity === 'ERROR').slice(0, 4);
  const pods = data.pods;
  const di = ctx.dates.indexOf(day);

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Coverage" value={`${s.coveragePct.toFixed(1)}%`} tone={s.gapUnits ? 'bad' : 'ok'} sub={`${s.gapUnits} of ${s.requiredUnits} head-days uncovered`} />
        <Stat label="Must fix" value={s.errors} tone={s.errors ? 'bad' : 'ok'} sub={`${s.warnings} warnings, ${s.infos} info`} />
        <Stat label="People" value={ctx.emps.length} sub={`${data.pods.length} pods, ${floaters} floaters`} />
        <Stat label="Brands" value={data.brands.length} sub={`${single} run by one person`} />
        <Stat label="Brand processes" value={ctx.reqs.length} sub={`${data.processes.length} process types`} />
      </div>

      <section className="panel panel-pad stack" style={{ gap: 12 }}>
        <div className="sect-head">
          <h3>Coverage by brand process</h3>
          <HeatLegend />
        </div>
        <Heatmap day={day} onDay={setDay} onBrand={(b) => openRoster('brand', b)} />
      </section>

      {top.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <div className="sect-head">
            <h3>
              Must fix <span className="faint">({s.errors})</span>
            </h3>
            <button className="btn sm" onClick={goIssues}>
              All issues
            </button>
          </div>
          {top.map((i) => (
            <IssueCard key={i.key} issue={i} />
          ))}
        </section>
      )}

      <section className="panel panel-pad stack" style={{ gap: 14 }}>
        <div className="sect-head">
          <h3>Who's working</h3>
          <div className="daypick">
            <button className="btn icon sm" disabled={di <= 0} onClick={() => setDay(ctx.dates[di - 1])} aria-label="Previous day">
              <IconChevronLeft size={15} />
            </button>
            <select value={day} onChange={(e) => setDay(e.target.value)}>
              {ctx.dates.map((d) => (
                <option key={d} value={d}>
                  {fmtDate(d)}
                  {ctx.holidays.get(d) ? ` (${ctx.holidays.get(d)})` : ''}
                </option>
              ))}
            </select>
            <button className="btn icon sm" disabled={di >= ctx.dates.length - 1} onClick={() => setDay(ctx.dates[di + 1])} aria-label="Next day">
              <IconChevronRight size={15} />
            </button>
            {s.gapDays.has(day) && <span className="badge err">gap</span>}
          </div>
        </div>
        {pods.map((p) => {
          const brands = data.brands.filter((b) => b.podId === p.id);
          const lead = p.leadId ? ctx.emp.get(p.leadId) : undefined;
          const leadIn = lead && roster.cells[lead.id]?.[day]?.status === 'WORK';
          return (
            <div key={p.id} className="stack" style={{ gap: 8 }}>
              <div className="podhead">
                <button className="linkbtn" onClick={() => openRoster('pod', p.id)}>
                  Pod {p.name}
                </button>
                {lead && (
                  <span className="small muted">
                    lead {lead.name}, <span className={leadIn ? '' : 'faint'}>{leadIn ? 'in' : 'off'}</span>
                  </span>
                )}
              </div>
              <div className="dayboard">
                {brands.map((b) => {
                  const reqs = ctx.reqs.filter((r) => r.brandId === b.id);
                  const short = reqs.some((r) => validation.coverage[r.id][day].staffed < validation.coverage[r.id][day].required);
                  return (
                    <div key={b.id} className={`brandcard ${short ? 'short' : ''}`}>
                      <div className="brandcard-head">
                        <button className="linkbtn" onClick={() => openRoster('brand', b.id)}>
                          {b.name}
                        </button>
                        <span className="code">{b.code}</span>
                      </div>
                      {reqs.map((r) => {
                        const c = validation.coverage[r.id][day];
                        return (
                          <div key={r.id} className="procline">
                            <ProcTag ctx={ctx} reqId={r.id} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              {c.required === 0 && c.staffed === 0 ? (
                                <span className="faint">closed</span>
                              ) : (
                                <>
                                  {c.primaries.map((x) => ctx.emp.get(x)?.name.split(' ')[0]).join(', ')}
                                  {c.backups.length > 0 && (
                                    <span className="backup-text">
                                      {c.primaries.length ? ', ' : ''}
                                      {c.backups.map((x) => ctx.emp.get(x)?.name.split(' ')[0] + ' (backup)').join(', ')}
                                    </span>
                                  )}
                                  {c.staffed === 0 && <span className="err-text">nobody</span>}
                                </>
                              )}
                            </span>
                            {c.required > 0 && <span className={`ratio ${c.staffed < c.required ? 'bad' : ''}`}>{c.staffed}/{c.required}</span>}
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
      </section>
    </div>
  );
}

function HeatLegend() {
  return (
    <div className="legend">
      <span>
        <span className="hsw ok" />
        covered
      </span>
      <span>
        <span className="hsw backup" />
        by a backup
      </span>
      <span>
        <span className="hsw short" />
        short
      </span>
      <span>
        <span className="hsw closed" />
        closed
      </span>
    </div>
  );
}

function Heatmap({ day, onDay, onBrand }: { day: string; onDay: (d: string) => void; onBrand: (b: string) => void }) {
  const { ctx, validation } = useStore();
  if (!validation) return null;
  const gap = validation.summary.gapDays;
  let prevBrand = '';
  return (
    <div className="heat-wrap">
      <div className="heat" style={{ gridTemplateColumns: `minmax(132px, 180px) repeat(${ctx.dates.length}, minmax(11px, 1fr))`, minWidth: 150 + ctx.dates.length * 15 }}>
        <div className="hcorner" />
        {ctx.dates.map((d) => {
          const wd = weekday(d);
          const cls = ['hd', wd === 0 || wd === 6 ? 'we' : '', gap.has(d) ? 'gap' : '', d === day ? 'sel' : '', ctx.holidays.get(d) ? 'hol' : ''].join(' ');
          return (
            <button key={d} className={cls} onClick={() => onDay(d)} title={`${fmtDate(d)}${ctx.holidays.get(d) ? ', ' + ctx.holidays.get(d) : ''}`}>
              <span>{Number(d.slice(8))}</span>
              <span className="wd">{WEEKDAY_LETTER[wd]}</span>
            </button>
          );
        })}
        {ctx.reqs.map((r) => {
          const first = r.brandId !== prevBrand;
          prevBrand = r.brandId;
          const brand = ctx.brand.get(r.brandId);
          const proc = ctx.process.get(r.processId);
          return (
            <div key={r.id} style={{ display: 'contents' }}>
              <button className={`hl ${first ? 'first' : ''}`} onClick={() => onBrand(r.brandId)} title={`${brand?.name} · ${proc?.name}`}>
                <span className="hl-b">{first ? brand?.name : ''}</span>
                <span className="hl-p">{proc?.code}</span>
              </button>
              {ctx.dates.map((d) => {
                const c = validation.coverage[r.id][d];
                const cls = c.required === 0 ? (c.staffed ? 'backup' : 'closed') : c.staffed < c.required ? 'short' : c.backups.length ? 'backup' : 'ok';
                return (
                  <div
                    key={d}
                    className={`hc ${cls} ${first ? 'first' : ''} ${d === day ? 'sel' : ''}`}
                    title={`${brand?.name} · ${proc?.code} · ${fmtDate(d)}\n${c.required === 0 ? 'closed' : `${c.staffed}/${c.required} staffed`}${c.backups.length ? ' (backup cover)' : ''}`}
                    onClick={() => onDay(d)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
