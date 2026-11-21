import { useMemo, useState } from 'react';
import { publishedDiff, setCell, unlockCell } from '../engine/actions';
import { load, reqLabel, shiftCompatible } from '../engine/context';
import { fmtDate, WEEKDAY_SHORT, weekday, plural } from '../engine/dates';
import type { Cell, CellStatus, Duty, ID, ISODate } from '../engine/types';
import { diffIssues, validate } from '../engine/validate';
import { useStore } from '../state';
import { cellCode, cellTitle, Drawer, Empty, IssueCard, Legend, ProcTag, statusText } from '../ui/common';
import { IconLock } from '../ui/icons';

const CAL_SHORT: Record<string, string> = {
  ALL_365: '365 days',
  DAILY_NO_PH: 'daily, PH off',
  MON_SAT_NO_PH: 'Mon to Sat, PH off',
  MON_FRI_NO_PH: 'Mon to Fri, PH off',
  CUSTOM: 'custom days',
};

export type Lens = 'company' | 'pod' | 'brand' | 'process' | 'employee';

interface Group {
  label: string;
  empIds: ID[];
}

export function RosterView({
  lens,
  setLens,
  sel,
  setSel,
}: {
  lens: Lens;
  setLens: (l: Lens) => void;
  sel: Record<Lens, string>;
  setSel: (l: Lens, v: string) => void;
}) {
  const { ctx, roster, data } = useStore();
  const [editing, setEditing] = useState<{ empId: ID; date: ISODate } | null>(null);

  if (!roster)
    return (
      <Empty>
        <p>No roster for this month yet.</p>
        <p className="small">Use “Generate roster” at the top. The engine plans weekly offs, holidays and backup cover from the rules in Setup.</p>
      </Empty>
    );

  const pods = data.pods;
  const podId = sel.pod || pods[0]?.id;
  const brandId = sel.brand || data.brands[0]?.id;
  const processId = sel.process || data.processes[0]?.id;
  const empId = sel.employee || ctx.emps[0]?.id;

  const sortEmps = (ids: ID[]) => {
    const rank = { LEAD: 0, AGENT: 1, FLOATER: 2 } as const;
    return [...ids].sort((a, b) => rank[ctx.emp.get(a)!.role] - rank[ctx.emp.get(b)!.role] || ctx.emp.get(a)!.name.localeCompare(ctx.emp.get(b)!.name));
  };
  const podGroup = (pid: ID): Group => {
    const p = pods.find((x) => x.id === pid);
    const lead = p?.leadId ? ctx.emp.get(p.leadId)?.name : undefined;
    return { label: `Pod ${p?.name ?? pid}${lead ? `, lead ${lead}` : ''}`, empIds: sortEmps(ctx.emps.filter((e) => e.podId === pid).map((e) => e.id)) };
  };

  let body: JSX.Element;
  if (lens === 'company') {
    body = <RosterGrid groups={pods.map((p) => podGroup(p.id))} covReqs={[]} summaryRow onEdit={setEditing} />;
  } else if (lens === 'pod') {
    const reqs = ctx.reqs.filter((r) => ctx.brand.get(r.brandId)?.podId === podId).map((r) => r.id);
    body = (
      <>
        <Picker label="Pod" value={podId} onChange={(v) => setSel('pod', v)} options={pods.map((p) => [p.id, p.name])} />
        <RosterGrid groups={[podGroup(podId)]} covReqs={reqs} onEdit={setEditing} />
      </>
    );
  } else if (lens === 'brand') {
    const reqs = ctx.reqs.filter((r) => r.brandId === brandId).map((r) => r.id);
    const primaries = new Set(reqs.flatMap((r) => ctx.primariesOf.get(r) ?? []));
    const backups = new Set<ID>();
    for (const r of reqs) for (const b of ctx.backupsOf.get(r) ?? []) if (!primaries.has(b)) backups.add(b);
    for (const e of ctx.emps)
      if (!primaries.has(e.id) && ctx.dates.some((d) => roster.cells[e.id]?.[d]?.duties.some((x) => reqs.includes(x.requirementId)))) backups.add(e.id);
    const b = ctx.brand.get(brandId);
    body = (
      <>
        <div className="row">
          <Picker
            label="Brand"
            value={brandId}
            onChange={(v) => setSel('brand', v)}
            options={data.brands.map((x) => {
              const n = new Set(ctx.reqs.filter((r) => r.brandId === x.id).flatMap((r) => ctx.primariesOf.get(r.id) ?? [])).size;
              return [x.id, `${x.name} (${n} ${n === 1 ? 'person' : 'people'})`];
            })}
          />
          <span className="small muted">
            Pod {pods.find((p) => p.id === b?.podId)?.name}. Processes:{' '}
            {reqs.map((r) => (
              <span key={r} style={{ marginRight: 6 }}>
                <ProcTag ctx={ctx} reqId={r} /> {CAL_SHORT[ctx.req.get(r)!.calendar.preset]}
              </span>
            ))}
          </span>
        </div>
        <RosterGrid
          groups={[
            { label: primaries.size === 1 ? 'Dedicated (single-resource) employee' : 'Brand team', empIds: sortEmps([...primaries]) },
            { label: 'Backups / cross-cover', empIds: sortEmps([...backups]) },
          ]}
          covReqs={reqs}
          brandId={brandId}
          onEdit={setEditing}
        />
      </>
    );
  } else if (lens === 'process') {
    const reqs = ctx.reqs.filter((r) => r.processId === processId).map((r) => r.id);
    const staff = new Set(reqs.flatMap((r) => ctx.primariesOf.get(r) ?? []));
    body = (
      <>
        <Picker label="Process" value={processId} onChange={(v) => setSel('process', v)} options={data.processes.map((p) => [p.id, `${p.name} (${p.code})`])} />
        <RosterGrid
          groups={[{ label: `Primary staff for ${ctx.process.get(processId)?.code}`, empIds: sortEmps([...staff]) }]}
          covReqs={reqs}
          covFirst
          onEdit={setEditing}
        />
      </>
    );
  } else {
    body = (
      <>
        <Picker
          label="Employee"
          value={empId}
          onChange={(v) => setSel('employee', v)}
          options={ctx.emps.map((e) => [e.id, `${e.name} (${pods.find((p) => p.id === e.podId)?.name})`])}
        />
        <EmployeeCalendar empId={empId} onEdit={setEditing} />
      </>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <div className="seg" role="tablist">
          {(['company', 'pod', 'brand', 'process', 'employee'] as Lens[]).map((l) => (
            <button key={l} className={lens === l ? 'active' : ''} onClick={() => setLens(l)}>
              {l[0].toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
        <span className="small muted">Edits are checked against every rule before you apply them.</span>
      </div>
      {body}
      <Legend />
      {editing && <CellEditor empId={editing.empId} date={editing.date} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Picker({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="row small muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function useCellFlags() {
  const { validation, roster } = useStore();
  return useMemo(() => {
    const err = new Set<string>();
    const warn = new Set<string>();
    for (const i of validation?.issues ?? []) {
      if (!i.employeeId || !i.date) continue;
      if (i.type === 'WEEKLY_OFF_SHORTFALL' || i.type === 'MAX_CONSECUTIVE' || i.type === 'PENDING_LEAVE_RISK' || i.type === 'MULTI_BRAND_IMPACT') continue;
      const k = `${i.employeeId}|${i.date}`;
      if (i.severity === 'ERROR') err.add(k);
      else if (i.severity === 'WARNING') warn.add(k);
    }
    const changed = new Set(roster ? publishedDiff(roster).map((x) => `${x.empId}|${x.date}`) : []);
    return { err, warn, changed };
  }, [validation, roster]);
}

function RosterGrid({
  groups,
  covReqs,
  brandId,
  summaryRow,
  covFirst,
  onEdit,
}: {
  groups: Group[];
  covReqs: ID[];
  brandId?: ID;
  summaryRow?: boolean;
  covFirst?: boolean;
  onEdit: (x: { empId: ID; date: ISODate }) => void;
}) {
  const { ctx, roster, validation } = useStore();
  const flags = useCellFlags();
  if (!roster || !validation) return null;
  const gapDays = validation.summary.gapDays;

  const covRows = covReqs.length > 0 && (
    <>
      <tr className="group">
        <td colSpan={ctx.dates.length + 1}>
          <span className="glabel">Coverage (scheduled / required)</span>
        </td>
      </tr>
      {covReqs.map((r) => (
        <tr key={r} className="covrow">
          <td className="namecol" title={reqLabel(ctx, r)}>
            <ProcTag ctx={ctx} reqId={r} /> {ctx.brand.get(ctx.req.get(r)!.brandId)?.name}
          </td>
          {ctx.dates.map((d) => {
            const c = validation.coverage[r][d];
            const cls = c.required === 0 ? (c.staffed ? 'over' : 'closed') : c.staffed < c.required ? 'short' : c.staffed > c.required ? 'over' : 'ok';
            const names = [...c.primaries, ...c.backups.map((b) => b + '*')].map((x) =>
              x.endsWith('*') ? ctx.emp.get(x.slice(0, -1))?.name + ' (backup)' : ctx.emp.get(x)?.name,
            );
            return (
              <td key={d}>
                <div className={`cov ${cls}`} title={`${reqLabel(ctx, r)}, ${fmtDate(d)}\nneeds ${c.required}, scheduled ${c.staffed}\n${names.join('\n')}`}>
                  {c.required === 0 && !c.staffed ? '–' : `${c.staffed}/${c.required}`}
                </div>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );

  return (
    <div className="grid-wrap">
      <table className="roster">
        <thead>
          <tr>
            <th className="namecol">Employee</th>
            {ctx.dates.map((d) => {
              const wd = weekday(d);
              const hol = ctx.holidays.get(d);
              return (
                <th
                  key={d}
                  className={[hol ? 'hol' : '', wd === 0 || wd === 6 ? 'we' : '', gapDays.has(d) ? 'gapday' : ''].join(' ')}
                  title={`${fmtDate(d)}${hol ? ', ' + hol : ''}${gapDays.has(d) ? '\nCoverage gap on this day' : ''}`}
                >
                  <span className="dn">{Number(d.slice(8))}</span>
                  <span className="dw">{WEEKDAY_SHORT[wd].slice(0, 2)}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {covFirst && covRows}
          {groups.map((g) => (g.empIds.length === 0 ? null : <GroupRows key={g.label} g={g} brandId={brandId} flags={flags} onEdit={onEdit} />))}
          {!covFirst && covRows}
          {summaryRow && (
            <tr className="covrow">
              <td className="namecol">Processes short</td>
              {ctx.dates.map((d) => {
                const n = ctx.reqs.filter((r) => validation.coverage[r.id][d].staffed < validation.coverage[r.id][d].required).length;
                return (
                  <td key={d}>
                    <div className={`cov ${n ? 'short' : 'ok'}`}>{n || '✓'}</div>
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  g,
  brandId,
  flags,
  onEdit,
}: {
  g: Group;
  brandId?: ID;
  flags: { err: Set<string>; warn: Set<string>; changed: Set<string> };
  onEdit: (x: { empId: ID; date: ISODate }) => void;
}) {
  const { ctx, roster } = useStore();
  return (
    <>
      <tr className="group">
        <td colSpan={ctx.dates.length + 1}>
          <span className="glabel">
            {g.label} <span className="gcount">{g.empIds.length}</span>
          </span>
        </td>
      </tr>
      {g.empIds.map((id) => {
        const e = ctx.emp.get(id)!;
        return (
          <tr key={id}>
            <td className="namecol" title={`${e.name} (${e.role.toLowerCase()}, ${e.offsPerWeek} off/week)`}>
              {e.name}
              {e.role !== 'AGENT' && <span className="role">{e.role === 'LEAD' ? 'lead' : 'floater'}</span>}
            </td>
            {ctx.dates.map((d) => {
              const c = roster!.cells[id]?.[d];
              const k = `${id}|${d}`;
              const backupOnly = c?.status === 'WORK' && c.duties.length > 0 && c.duties.every((x) => x.backup);
              const cls = [
                'cell',
                `s-${c?.status}`,
                backupOnly ? 'backup' : '',
                c?.status === 'WORK' && !c.duties.length ? 'standby' : '',
                flags.err.has(k) ? 'has-issue' : flags.warn.has(k) ? 'has-warn' : '',
                flags.changed.has(k) ? 'changed' : '',
              ].join(' ');
              return (
                <td key={d}>
                  <button className={cls} title={cellTitle(ctx, e.name, fmtDate(d), c)} onClick={() => onEdit({ empId: id, date: d })}>
                    {cellCode(ctx, c, brandId)}
                    {c?.locked && (
                      <span className="lock" title="Locked by manager">
                        <IconLock size={9} />
                      </span>
                    )}
                  </button>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

function EmployeeCalendar({ empId, onEdit }: { empId: ID; onEdit: (x: { empId: ID; date: ISODate }) => void }) {
  const { ctx, roster, validation, data } = useStore();
  const e = ctx.emp.get(empId);
  if (!e || !roster || !validation) return null;
  const st = validation.empStats.get(empId)!;
  const lead = data.pods.find((p) => p.id === e.podId);
  const first = ctx.dates[0];
  const pad = (weekday(first) + 6) % 7;
  const issues = validation.issues.filter((i) => i.employeeId === empId);
  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
      <div className="panel panel-pad">
        <div className="cal">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="hd">
              {d}
            </div>
          ))}
          {Array.from({ length: pad }).map((_, i) => (
            <div key={'p' + i} />
          ))}
          {ctx.dates.map((d) => {
            const c = roster.cells[empId]?.[d];
            return (
              <button key={d} className={`day s-${c?.status}`} onClick={() => onEdit({ empId, date: d })} title={cellTitle(ctx, e.name, fmtDate(d), c)}>
                <span className="n">
                  {Number(d.slice(8))} {c?.locked && <IconLock size={11} />}
                </span>
                {ctx.holidays.get(d) && (
                  <span className="small" style={{ color: 'var(--st-ph-fg)' }}>
                    {ctx.holidays.get(d)}
                  </span>
                )}
                {c?.status === 'WORK' ? (
                  c.duties.length ? (
                    c.duties.map((du) => (
                      <span key={du.requirementId} className="small">
                        <ProcTag ctx={ctx} reqId={du.requirementId} /> {ctx.brand.get(ctx.req.get(du.requirementId)!.brandId)?.code}
                        {du.backup ? ' ↺' : ''}
                      </span>
                    ))
                  ) : (
                    <span className="small faint">Standby</span>
                  )
                ) : (
                  <span className="small muted">{c ? statusText(c) : ''}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="stack">
        <div className="panel panel-pad stack" style={{ gap: 6 }}>
          <h3>{e.name}</h3>
          <div className="small muted">
            {e.role.toLowerCase()}, Pod {lead?.name}, {e.offsPerWeek} weekly {plural(e.offsPerWeek, 'off')}, prefers{' '}
            {e.preferredOffDays.length ? e.preferredOffDays.map((w) => WEEKDAY_SHORT[w]).join('/') : 'no particular day'} off
          </div>
          <table className="data small">
            <tbody>
              <tr>
                <td>Working days</td>
                <td>
                  <b>{st.work}</b> ({st.backupDays} with backup cover)
                </td>
              </tr>
              <tr>
                <td>Weekly offs</td>
                <td>
                  <b>{st.wo}</b> ({st.weekendOffs} on weekends)
                </td>
              </tr>
              <tr>
                <td>Holidays off / worked</td>
                <td>
                  <b>{st.ph}</b> / <b>{st.phWorked}</b>
                </td>
              </tr>
              <tr>
                <td>Leave / comp-off taken</td>
                <td>
                  <b>{st.leave}</b> / <b>{st.compOff}</b>
                </td>
              </tr>
              <tr>
                <td>Comp-off balance</td>
                <td>
                  <b>{st.compOffBalance}</b> <span className="faint">(opening {e.compOffOpening} + worked holidays − taken)</span>
                </td>
              </tr>
              <tr>
                <td>Preferred off-day met</td>
                <td>{st.prefTotal ? `${st.prefMet}/${st.prefTotal}` : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel panel-pad stack" style={{ gap: 6 }}>
          <h4>Assignments</h4>
          {(ctx.primaryReqsOf.get(empId) ?? []).map((r) => (
            <div key={r} className="small">
              <ProcTag ctx={ctx} reqId={r} /> {reqLabel(ctx, r)} <span className="badge ok">primary</span>
            </div>
          ))}
          {(ctx.backupReqsOf.get(empId) ?? []).map((r) => (
            <div key={r} className="small">
              <ProcTag ctx={ctx} reqId={r} /> {reqLabel(ctx, r)} <span className="badge neutral">backup</span>
            </div>
          ))}
        </div>
        {issues.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <h4>Issues for {e.name.split(' ')[0]}</h4>
            {issues.map((i) => (
              <IssueCard key={i.key} issue={i} compact />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUSES: CellStatus[] = ['WORK', 'WO', 'PH', 'LEAVE', 'COMP_OFF', 'NA', 'IDLE'];

function CellEditor({ empId, date, onClose }: { empId: ID; date: ISODate; onClose: () => void }) {
  const { ctx, roster, validation, setRoster, notify } = useStore();
  const cur = roster!.cells[empId][date];
  const [status, setStatus] = useState<CellStatus>(cur.status);
  const [duties, setDuties] = useState<Duty[]>(cur.duties);
  const [extra, setExtra] = useState('');
  const e = ctx.emp.get(empId)!;

  const draft: Cell = { status, duties: status === 'WORK' ? duties : [] };
  const preview = useMemo(() => {
    const cells = { ...roster!.cells, [empId]: { ...roster!.cells[empId], [date]: draft } };
    return diffIssues(validation!.issues, validate(ctx, cells).issues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, duties, roster, validation, ctx]);

  const prim = ctx.primaryReqsOf.get(empId) ?? [];
  const back = ctx.backupReqsOf.get(empId) ?? [];
  const listed = [...new Set([...prim, ...back, ...duties.map((d) => d.requirementId)])];
  const toggle = (r: ID) => {
    setStatus('WORK');
    setDuties((ds) =>
      ds.some((x) => x.requirementId === r) ? ds.filter((x) => x.requirementId !== r) : [...ds, { requirementId: r, backup: !prim.includes(r) }],
    );
  };
  const lv = ctx.leaveOn.get(empId)?.get(date);
  const ids = duties.map((x) => x.requirementId);
  const newLoad = load(ctx, { status: 'WORK', duties });

  return (
    <Drawer
      title={
        <>
          {e.name}, {fmtDate(date)} {ctx.holidays.get(date) && <span className="badge info">{ctx.holidays.get(date)}</span>}
        </>
      }
      onClose={onClose}
    >
      <div className="small muted">
        Currently: <b>{statusText(cur)}</b>
        {cur.duties.length > 0 && `: ${cur.duties.map((d) => reqLabel(ctx, d.requirementId) + (d.backup ? ' (backup)' : '')).join(', ')}`}
        {cur.locked && ', locked by manager'}
        {lv && `, approved ${lv.type.toLowerCase().replace('_', '-')} ${lv.type === 'COMP_OFF' ? '' : 'leave'}`}
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <h4>Status</h4>
        <div className="row">
          {STATUSES.map((s) => (
            <button key={s} className={`btn sm ${status === s ? 'primary' : ''}`} onClick={() => setStatus(s)}>
              {statusText({ status: s, duties: [] }).replace(' (their processes are closed)', '')}
            </button>
          ))}
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <h4>Duties on {fmtDate(date)}</h4>
        <table className="data small">
          <thead>
            <tr>
              <th />
              <th>Brand and process</th>
              <th>Role</th>
              <th>Today</th>
              <th>Shift</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((r) => {
              const cov = validation!.coverage[r]?.[date];
              const on = duties.some((x) => x.requirementId === r) && status === 'WORK';
              const req = ctx.req.get(r)!;
              const sh = ctx.shift.get(req.shiftId);
              const clash = !on && !shiftCompatible(ctx, ids, r);
              return (
                <tr key={r}>
                  <td>
                    <input type="checkbox" checked={on} onChange={() => toggle(r)} />
                  </td>
                  <td>
                    <ProcTag ctx={ctx} reqId={r} /> {reqLabel(ctx, r)}
                  </td>
                  <td>{prim.includes(r) ? 'primary' : back.includes(r) ? 'backup' : <span style={{ color: 'var(--warn)' }}>not assigned</span>}</td>
                  <td>{cov ? cov.required === 0 ? <span className="faint">closed</span> : `${cov.staffed}/${cov.required}` : '—'}</td>
                  <td>
                    {sh?.name} {sh?.start} to {sh?.end} {clash && <span className="badge warn">clash</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row small">
          <select value={extra} onChange={(ev) => setExtra(ev.target.value)}>
            <option value="">Cross-cover another process…</option>
            {ctx.reqs
              .filter((r) => !listed.includes(r.id) && (ctx.required.get(r.id)!.get(date) ?? 0) > 0)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {reqLabel(ctx, r.id)}
                </option>
              ))}
          </select>
          <button className="btn sm" disabled={!extra} onClick={() => (toggle(extra), setExtra(''))}>
            Add
          </button>
          <span className="faint">
            Load {(status === 'WORK' ? newLoad : 0).toFixed(1)} / {e.maxLoad} FTE
          </span>
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <h4>Impact of this change</h4>
        {preview.added.length === 0 && preview.resolved.length === 0 && <div className="small muted">No new problems, nothing resolved.</div>}
        {preview.resolved.map((i) => (
          <div key={i.key} className="banner ok">
            ✓ Resolves: {i.title}
          </div>
        ))}
        {preview.added.map((i) => (
          <div key={i.key} className={`banner ${i.severity === 'ERROR' ? 'err' : i.severity === 'WARNING' ? 'warn' : 'info'}`}>
            {i.severity === 'ERROR' ? '✕' : '!'} Creates: {i.title}
          </div>
        ))}
      </div>

      <div className="row">
        <button
          className="btn primary"
          onClick={() => {
            setRoster(setCell(roster!, empId, date, draft, `Manual edit: ${e.name} on ${fmtDate(date)} → ${statusText(draft)}`));
            notify(preview.added.some((i) => i.severity === 'ERROR') ? 'Change applied. It created issues that need attention.' : 'Change applied and locked.');
            onClose();
          }}
        >
          Apply &amp; lock
        </button>
        {cur.locked && (
          <button
            className="btn"
            onClick={() => {
              setRoster(unlockCell(roster!, empId, date));
              notify('Lock removed. Regenerating may change this cell.');
              onClose();
            }}
          >
            Remove lock
          </button>
        )}
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="small faint">Edited cells are locked: regeneration and re-optimisation keep them exactly as you set them.</p>
    </Drawer>
  );
}
