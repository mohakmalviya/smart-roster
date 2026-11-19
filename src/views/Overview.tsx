import { useState, type ReactNode } from 'react';
import { fmtDate, monthLabel, weekday, WEEKDAY_LETTER } from '../engine/dates';
import { useStore } from '../state';
import { IssueCard, ProcTag } from '../ui/common';
import { IconAlert, IconCalendar, IconChevronLeft, IconChevronRight, IconLayers, IconShield, IconTag, IconTarget, IconUsers, IconWand } from '../ui/icons';
import type { Lens } from './RosterView';

function Kpi({ icon, tone, label, value, sub, children }: { icon: ReactNode; tone: string; label: string; value: ReactNode; sub: ReactNode; children?: ReactNode }) {
  return (
    <div className="panel kpi">
      <div className="kpi-head">
        <span className={`kpi-ico ${tone}`}>{icon}</span>
        <span className="label">{label}</span>
      </div>
      <div className="value">{value}</div>
      {children}
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

  const kpisStatic = (
    <>
      <Kpi icon={<IconUsers size={16} />} tone="violet" label="Employees" value={ctx.emps.length} sub={`${data.pods.length} pods · ${floaters} floaters`} />
      <Kpi
        icon={<IconTag size={16} />}
        tone="amber"
        label="Brands"
        value={data.brands.length}
        sub={`${single} single-resource (${Math.round((single / Math.max(1, data.brands.length)) * 100)}%)`}
      />
      <Kpi icon={<IconLayers size={16} />} tone="teal" label="Brand processes" value={ctx.reqs.length} sub={`${data.processes.length} process types`} />
    </>
  );

  if (!roster || !validation)
    return (
      <div className="stack">
        <div className="hero panel">
          <div className="hero-body">
            <span className="hero-ico">
              <IconCalendar size={26} />
            </span>
            <h2>Plan {monthLabel(month)} in one click</h2>
            <p>
              The engine reads every rule in Setup, plans weekly offs, rotates public holidays and assigns backup cover. Anything it cannot solve is listed with
              the reason and a suggested fix — it never hands you a roster that only looks valid.
            </p>
            <button className="btn primary lg" disabled={!!busy} onClick={() => generate()}>
              <IconWand size={17} /> {busy ? busy : 'Generate roster'}
            </button>
          </div>
          <ol className="hero-steps">
            <li>
              <b>Fixed facts first</b>
              <span>Approved leave, comp-offs, unavailability and locked cells.</span>
            </li>
            <li>
              <b>Plan offs and holidays</b>
              <span>Weekly offs placed where cover exists; holidays rotated fairly.</span>
            </li>
            <li>
              <b>Cover and explain</b>
              <span>Backups fill gaps; what is left becomes an explained issue.</span>
            </li>
          </ol>
        </div>
        <div className="kpis">{kpisStatic}</div>
      </div>
    );

  const s = validation.summary;
  const top = validation.issues.filter((i) => i.severity === 'ERROR').slice(0, 4);
  const pods = data.pods;
  const di = ctx.dates.indexOf(day);

  return (
    <div className="stack">
      <div className="kpis">
        <Kpi
          icon={<IconTarget size={16} />}
          tone={s.gapUnits ? 'red' : 'green'}
          label="Coverage"
          value={<span style={{ color: s.gapUnits ? 'var(--err)' : 'var(--ok)' }}>{s.coveragePct.toFixed(1)}%</span>}
          sub={`${s.coveredUnits}/${s.requiredUnits} head-days · ${s.gapUnits} uncovered`}
        >
          <div className="meter">
            <span style={{ width: `${Math.min(100, s.coveragePct)}%` }} className={s.gapUnits ? 'has-gap' : ''} />
          </div>
        </Kpi>
        <Kpi
          icon={s.errors ? <IconAlert size={16} /> : <IconShield size={16} />}
          tone={s.errors ? 'red' : 'green'}
          label="Must-fix issues"
          value={<span style={{ color: s.errors ? 'var(--err)' : 'var(--ok)' }}>{s.errors}</span>}
          sub={`${s.warnings} warnings · ${s.infos} info`}
        />
        {kpisStatic}
      </div>

      <section className="panel panel-pad stack" style={{ gap: 12 }}>
        <div className="sect-head">
          <div>
            <h3>Coverage heatmap</h3>
            <p className="small muted">Each row is one brand process; each square one day. Click a brand to open it, a day to see who works.</p>
          </div>
          <HeatLegend />
        </div>
        <Heatmap day={day} onDay={setDay} onBrand={(b) => openRoster('brand', b)} />
      </section>

      {top.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <div className="sect-head">
            <div>
              <h3>Needs attention</h3>
              <p className="small muted">Mandatory rules the engine could not satisfy, with the reason and the options.</p>
            </div>
            <button className="btn sm" onClick={goIssues}>
              All issues →
            </button>
          </div>
          {top.map((i) => (
            <IssueCard key={i.key} issue={i} />
          ))}
        </section>
      )}

      <section className="panel panel-pad stack" style={{ gap: 14 }}>
        <div className="sect-head">
          <div>
            <h3>Who is working</h3>
            <p className="small muted">Every brand process and the people on it for one day. ↺ marks backup cover.</p>
          </div>
          <div className="daypick">
            <button className="btn icon sm" disabled={di <= 0} onClick={() => setDay(ctx.dates[di - 1])} aria-label="Previous day">
              <IconChevronLeft size={15} />
            </button>
            <select value={day} onChange={(e) => setDay(e.target.value)}>
              {ctx.dates.map((d) => (
                <option key={d} value={d}>
                  {fmtDate(d)}
                  {ctx.holidays.get(d) ? ` — ${ctx.holidays.get(d)}` : ''}
                </option>
              ))}
            </select>
            <button className="btn icon sm" disabled={di >= ctx.dates.length - 1} onClick={() => setDay(ctx.dates[di + 1])} aria-label="Next day">
              <IconChevronRight size={15} />
            </button>
            {s.gapDays.has(day) ? <span className="badge err">coverage gap</span> : <span className="badge ok">fully covered</span>}
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
                    Lead {lead.name} · <span className={leadIn ? 'ok-text' : 'faint'}>{leadIn ? 'in today' : 'off today'}</span>
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
                                      {c.backups.map((x) => ctx.emp.get(x)?.name.split(' ')[0] + ' ↺').join(', ')}
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
            <button key={d} className={cls} onClick={() => onDay(d)} title={`${fmtDate(d)}${ctx.holidays.get(d) ? ' — ' + ctx.holidays.get(d) : ''}`}>
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
                <span className="hl-p" style={{ color: proc?.color }}>
                  {proc?.code}
                </span>
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
