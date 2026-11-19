import { useRef, useState } from 'react';
import { CALENDAR_PRESETS, presetCalendar } from '../data/seed';
import { cloneCells } from '../engine/context';
import { fmtDate, WEEKDAY_SHORT } from '../engine/dates';
import type { Assignment, Brand, CalendarPreset, Dataset, Employee, ID, LeaveType, Requirement, Roster, Weekday } from '../engine/types';
import { uid, useStore, type AppState } from '../state';
import { downloadFile, ProcTag, WeekdayPicker } from '../ui/common';

type Sub = 'staffing' | 'employees' | 'pods' | 'calendar' | 'shifts' | 'data';

export function Setup() {
  const [sub, setSub] = useState<Sub>('staffing');
  const { roster, applyAvailability, generate, notify, busy } = useStore();
  return (
    <div className="stack">
      <div className="tabs">
        {(
          [
            ['staffing', 'Brands, processes & staffing'],
            ['employees', 'Employees'],
            ['pods', 'Pods & process types'],
            ['calendar', 'Holidays & leave'],
            ['shifts', 'Shifts & rules'],
            ['data', 'Data'],
          ] as [Sub, string][]
        ).map(([k, l]) => (
          <button key={k} className={sub === k ? 'active' : ''} onClick={() => setSub(k)}>
            {l}
          </button>
        ))}
      </div>
      {roster && (
        <div className="banner info row">
          <span style={{ flex: 1 }}>Changes here apply the next time you generate. To bring this month’s roster in line now:</span>
          <button className="btn sm" onClick={() => notify(`Roster re-checked: ${applyAvailability().length} edit(s).`)}>
            Minimal repair
          </button>
          <button className="btn sm primary" disabled={!!busy} onClick={() => generate()}>
            Regenerate
          </button>
        </div>
      )}
      {sub === 'staffing' && <Staffing />}
      {sub === 'employees' && <Employees />}
      {sub === 'pods' && <PodsAndProcesses />}
      {sub === 'calendar' && <CalendarSetup />}
      {sub === 'shifts' && <ShiftsAndPolicy />}
      {sub === 'data' && <DataTools />}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function Num({ value, onChange, min = 0, max, step = 1, width = 56 }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; width?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      style={{ width }}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

/** Remove references to requirements that no longer exist from every saved roster. */
function stripRosters(rosters: Record<string, Roster>, keep: Set<ID>): Record<string, Roster> {
  const out: Record<string, Roster> = {};
  for (const [m, r] of Object.entries(rosters)) {
    const cells = cloneCells(r.cells);
    for (const row of Object.values(cells))
      for (const c of Object.values(row)) c.duties = c.duties.filter((d) => keep.has(d.requirementId));
    out[m] = { ...r, cells };
  }
  return out;
}

function useDataEdit() {
  const { state, replaceState, updateData, notify } = useStore();
  /** Replace data and drop roster references to deleted requirements. */
  const commit = (data: Dataset, note?: string) => {
    const keep = new Set(data.requirements.map((r) => r.id));
    const s: AppState = { ...state, data, rosters: stripRosters(state.rosters, keep) };
    replaceState(s);
    if (note) notify(note);
  };
  return { commit, update: updateData };
}

// ── Brands, processes & staffing ────────────────────────────────────────────

function Staffing() {
  const { data } = useStore();
  const { update, commit } = useDataEdit();
  const [filter, setFilter] = useState('');
  const [nb, setNb] = useState({ name: '', code: '', podId: data.pods[0]?.id ?? '' });

  const addBrand = () => {
    if (!nb.name.trim() || !nb.podId) return;
    const id = uid('br');
    const code = (nb.code || nb.name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase();
    const req: Requirement = {
      id: `${id}-cs`,
      brandId: id,
      processId: data.processes[0].id,
      shiftId: data.shifts[0].id,
      calendar: presetCalendar('MON_SAT_NO_PH'),
      minStaff: 1,
      weekdayMin: {},
      dateMin: {},
      effort: 1,
    };
    update((d) => ({ ...d, brands: [...d.brands, { id, name: nb.name.trim(), code, podId: nb.podId }], requirements: [...d.requirements, req] }), `Brand ${nb.name} added with a ${data.processes[0].code} process. Assign staff below.`);
    setNb({ ...nb, name: '', code: '' });
    setFilter(nb.name.trim());
  };

  const brands = data.brands.filter((b) => !filter || b.name.toLowerCase().includes(filter.toLowerCase()) || b.code.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack">
      <div className="panel panel-pad row">
        <b>Add brand</b>
        <input placeholder="Brand name" value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
        <input placeholder="Code" value={nb.code} maxLength={4} style={{ width: 70 }} onChange={(e) => setNb({ ...nb, code: e.target.value })} />
        <select value={nb.podId} onChange={(e) => setNb({ ...nb, podId: e.target.value })}>
          {data.pods.map((p) => (
            <option key={p.id} value={p.id}>
              Pod {p.name}
            </option>
          ))}
        </select>
        <button className="btn primary sm" onClick={addBrand} disabled={!nb.name.trim()}>
          Add
        </button>
        <div className="spacer" />
        <input placeholder="Filter brands…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {brands.map((b) => (
        <BrandEditor key={b.id} b={b} commit={commit} update={update} />
      ))}
    </div>
  );
}

function BrandEditor({
  b,
  update,
  commit,
}: {
  b: Brand;
  update: (fn: (d: Dataset) => Dataset, note?: string) => void;
  commit: (d: Dataset, note?: string) => void;
}) {
  const { data } = useStore();
  const reqs = data.requirements.filter((r) => r.brandId === b.id);
  const primaries = new Set(data.assignments.filter((a) => a.role === 'PRIMARY' && reqs.some((r) => r.id === a.requirementId)).map((a) => a.employeeId));
  const setBrand = (patch: Partial<Brand>) => update((d) => ({ ...d, brands: d.brands.map((x) => (x.id === b.id ? { ...x, ...patch } : x)) }));
  const unused = data.processes.filter((p) => !reqs.some((r) => r.processId === p.id));

  return (
    <div className="panel panel-pad stack" style={{ gap: 8 }}>
      <div className="row">
        <input value={b.name} onChange={(e) => setBrand({ name: e.target.value })} style={{ fontWeight: 600, width: 180 }} />
        <input value={b.code} maxLength={4} style={{ width: 60 }} onChange={(e) => setBrand({ code: e.target.value.toUpperCase() })} />
        <select value={b.podId} onChange={(e) => setBrand({ podId: e.target.value })}>
          {data.pods.map((p) => (
            <option key={p.id} value={p.id}>
              Pod {p.name}
            </option>
          ))}
        </select>
        <span className={`badge ${primaries.size <= 1 ? 'neutral' : 'info'}`}>{primaries.size <= 1 ? 'single-resource' : `${primaries.size}-person team`}</span>
        <div className="spacer" />
        {unused.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const pid = e.target.value;
              if (!pid) return;
              const base = reqs[0];
              const r: Requirement = {
                id: `${b.id}-${pid.toLowerCase()}-${Math.random().toString(36).slice(2, 5)}`,
                brandId: b.id,
                processId: pid,
                shiftId: base?.shiftId ?? data.shifts[0].id,
                calendar: base ? { ...base.calendar, weekdays: [...base.calendar.weekdays] } : presetCalendar('MON_SAT_NO_PH'),
                minStaff: 1,
                weekdayMin: {},
                dateMin: {},
                effort: 0.5,
              };
              update((d) => ({ ...d, requirements: [...d.requirements, r] }), `Process added to ${b.name}.`);
            }}
          >
            <option value="">+ Add process…</option>
            {unused.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        )}
        <button
          className="btn sm danger"
          onClick={() => {
            if (!confirm(`Delete brand ${b.name} and its ${reqs.length} process(es)?`)) return;
            const ids = new Set(reqs.map((r) => r.id));
            commit(
              {
                ...data,
                brands: data.brands.filter((x) => x.id !== b.id),
                requirements: data.requirements.filter((r) => !ids.has(r.id)),
                assignments: data.assignments.filter((a) => !ids.has(a.requirementId)),
              },
              `Brand ${b.name} deleted.`,
            );
          }}
        >
          Delete
        </button>
      </div>
      <div className="table-wrap">
        <table className="data small">
          <thead>
            <tr>
              <th>Process</th>
              <th>Operating days</th>
              <th>Shift</th>
              <th title="Minimum people on a normal operating day">Min</th>
              <th title="Per-weekday minimum (blank = Min)">By weekday</th>
              <th title="Date-specific minimum; 0 = closed">Date overrides</th>
              <th title="Workload of one person-day in FTE">Effort</th>
              <th>Primary staff</th>
              <th>Backups</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reqs.map((r) => (
              <ReqRow key={r.id} r={r} update={update} commit={commit} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReqRow({ r, update, commit }: { r: Requirement; update: (fn: (d: Dataset) => Dataset, note?: string) => void; commit: (d: Dataset, note?: string) => void }) {
  const { data, ctx } = useStore();
  const [dd, setDd] = useState({ date: '', n: 2 });
  const set = (patch: Partial<Requirement>) => update((d) => ({ ...d, requirements: d.requirements.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) }));
  const asg = data.assignments.filter((a) => a.requirementId === r.id);
  const addAsg = (employeeId: ID, role: Assignment['role']) =>
    update((d) => ({
      ...d,
      assignments: [...d.assignments.filter((a) => !(a.requirementId === r.id && a.employeeId === employeeId)), { id: uid('as'), employeeId, requirementId: r.id, role }],
    }));
  const delAsg = (id: ID) => update((d) => ({ ...d, assignments: d.assignments.filter((a) => a.id !== id) }));
  const chip = (a: Assignment) => (
    <span key={a.id} className="chip">
      {ctx.emp.get(a.employeeId)?.name ?? data.employees.find((e) => e.id === a.employeeId)?.name ?? a.employeeId}
      <button onClick={() => delAsg(a.id)} aria-label="Remove">
        ✕
      </button>
    </span>
  );
  const others = data.employees.filter((e) => e.active && !asg.some((a) => a.employeeId === e.id));
  const pick = (role: Assignment['role']) => (
    <select value="" onChange={(e) => e.target.value && addAsg(e.target.value, role)} style={{ maxWidth: 110 }}>
      <option value="">+ add</option>
      {others.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );

  return (
    <tr>
      <td>
        <ProcTag ctx={ctx} reqId={r.id} /> <span className="faint">{data.processes.find((p) => p.id === r.processId)?.name}</span>
      </td>
      <td>
        <div className="stack" style={{ gap: 4 }}>
          <select
            value={r.calendar.preset}
            onChange={(e) => {
              const p = e.target.value as CalendarPreset;
              set({ calendar: p === 'CUSTOM' ? { ...r.calendar, preset: 'CUSTOM' } : presetCalendar(p) });
            }}
          >
            {(Object.keys(CALENDAR_PRESETS) as Exclude<CalendarPreset, 'CUSTOM'>[]).map((p) => (
              <option key={p} value={p}>
                {CALENDAR_PRESETS[p].label}
              </option>
            ))}
            <option value="CUSTOM">Custom…</option>
          </select>
          {r.calendar.preset === 'CUSTOM' && (
            <div className="row" style={{ gap: 6 }}>
              <WeekdayPicker value={r.calendar.weekdays} onChange={(w) => set({ calendar: { ...r.calendar, weekdays: w } })} />
              <label className="row" style={{ gap: 3 }}>
                <input type="checkbox" checked={r.calendar.publicHolidays} onChange={(e) => set({ calendar: { ...r.calendar, publicHolidays: e.target.checked } })} />
                PH
              </label>
            </div>
          )}
        </div>
      </td>
      <td>
        <select value={r.shiftId} onChange={(e) => set({ shiftId: e.target.value })}>
          {data.shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.start} to {s.end}
            </option>
          ))}
        </select>
      </td>
      <td>
        <Num value={r.minStaff} min={0} max={10} width={46} onChange={(n) => set({ minStaff: n })} />
      </td>
      <td>
        <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
          {([1, 2, 3, 4, 5, 6, 0] as Weekday[]).map((w) => (
            <input
              key={w}
              title={WEEKDAY_SHORT[w]}
              placeholder={WEEKDAY_SHORT[w][0]}
              value={r.weekdayMin[w] ?? ''}
              style={{ width: 24, padding: '2px', textAlign: 'center' }}
              onChange={(e) => {
                const wm = { ...r.weekdayMin };
                if (e.target.value === '') delete wm[w];
                else if (!Number.isNaN(Number(e.target.value))) wm[w] = Number(e.target.value);
                set({ weekdayMin: wm });
              }}
            />
          ))}
        </div>
      </td>
      <td>
        <div className="stack" style={{ gap: 3 }}>
          <div className="row" style={{ gap: 3 }}>
            {Object.entries(r.dateMin).map(([d, n]) => (
              <span key={d} className="chip">
                {fmtDate(d)}: {n === 0 ? 'closed' : n}
                <button
                  onClick={() => {
                    const m = { ...r.dateMin };
                    delete m[d];
                    set({ dateMin: m });
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="row" style={{ gap: 3, flexWrap: 'nowrap' }}>
            <input type="date" value={dd.date} onChange={(e) => setDd({ ...dd, date: e.target.value })} style={{ width: 130 }} />
            <Num value={dd.n} width={40} onChange={(n) => setDd({ ...dd, n })} />
            <button className="btn sm" disabled={!dd.date} onClick={() => (set({ dateMin: { ...r.dateMin, [dd.date]: dd.n } }), setDd({ ...dd, date: '' }))}>
              +
            </button>
          </div>
        </div>
      </td>
      <td>
        <Num value={r.effort} min={0.1} max={1} step={0.1} width={52} onChange={(n) => set({ effort: n })} />
      </td>
      <td>
        <div className="row" style={{ gap: 3 }}>
          {asg.filter((a) => a.role === 'PRIMARY').map(chip)}
          {pick('PRIMARY')}
        </div>
      </td>
      <td>
        <div className="row" style={{ gap: 3 }}>
          {asg.filter((a) => a.role === 'BACKUP').map(chip)}
          {pick('BACKUP')}
        </div>
      </td>
      <td>
        <button
          className="btn sm ghost"
          title="Remove this process from the brand"
          onClick={() => {
            if (!confirm('Remove this process from the brand?')) return;
            commit({ ...data, requirements: data.requirements.filter((x) => x.id !== r.id), assignments: data.assignments.filter((a) => a.requirementId !== r.id) }, 'Process removed.');
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

// ── Employees ───────────────────────────────────────────────────────────────

function Employees() {
  const { data, updateData: update } = useStore();
  const set = (id: ID, patch: Partial<Employee>) => update((d) => ({ ...d, employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const add = () => {
    const e: Employee = {
      id: uid('emp'),
      name: 'New employee',
      podId: data.pods[0].id,
      role: 'AGENT',
      offsPerWeek: 1,
      availableWeekdays: [true, true, true, true, true, true, true],
      preferredOffDays: [],
      maxLoad: 1,
      compOffOpening: 0,
      active: true,
    };
    update((d) => ({ ...d, employees: [...d.employees, e] }), 'Employee added. Assign them to processes under Brands.');
  };
  const nAssign = (id: ID) => data.assignments.filter((a) => a.employeeId === id);

  return (
    <div className="stack">
      <div className="row">
        <button className="btn primary sm" onClick={add}>
          + Add employee
        </button>
        <span className="small muted">{data.employees.filter((e) => e.active).length} active</span>
      </div>
      <div className="table-wrap">
        <table className="data small">
          <thead>
            <tr>
              <th>Name</th>
              <th>Pod</th>
              <th>Role</th>
              <th title="Weekly offs per Monday to Sunday week">Offs/wk</th>
              <th title="Days the person can work at all (hard)">Available days</th>
              <th title="Preferred weekly-off days (soft)">Prefers off</th>
              <th title="Max FTE load in one day">Max load</th>
              <th title="Comp-off days carried in">Comp-off bal.</th>
              <th>Assignments</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.employees.map((e) => {
              const as = nAssign(e.id);
              return (
                <tr key={e.id} style={e.active ? {} : { opacity: 0.55 }}>
                  <td>
                    <input value={e.name} onChange={(x) => set(e.id, { name: x.target.value })} style={{ width: 140 }} />
                  </td>
                  <td>
                    <select value={e.podId} onChange={(x) => set(e.id, { podId: x.target.value })}>
                      {data.pods.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={e.role} onChange={(x) => set(e.id, { role: x.target.value as Employee['role'] })}>
                      <option value="AGENT">Agent</option>
                      <option value="LEAD">Lead</option>
                      <option value="FLOATER">Floater</option>
                    </select>
                  </td>
                  <td>
                    <Num value={e.offsPerWeek} min={0} max={3} width={44} onChange={(n) => set(e.id, { offsPerWeek: n })} />
                  </td>
                  <td>
                    <WeekdayPicker value={e.availableWeekdays} onChange={(v) => set(e.id, { availableWeekdays: v })} />
                  </td>
                  <td>
                    <WeekdayPicker
                      value={[0, 1, 2, 3, 4, 5, 6].map((w) => e.preferredOffDays.includes(w as Weekday))}
                      onChange={(v) => set(e.id, { preferredOffDays: v.flatMap((on, w) => (on ? [w as Weekday] : [])) })}
                    />
                  </td>
                  <td>
                    <Num value={e.maxLoad} min={0.1} max={2} step={0.1} width={52} onChange={(n) => set(e.id, { maxLoad: n })} />
                  </td>
                  <td>
                    <Num value={e.compOffOpening} min={0} max={30} width={44} onChange={(n) => set(e.id, { compOffOpening: n })} />
                  </td>
                  <td className="muted">
                    {as.filter((a) => a.role === 'PRIMARY').length} primary, {as.filter((a) => a.role === 'BACKUP').length} backup
                  </td>
                  <td>
                    <input type="checkbox" checked={e.active} onChange={(x) => set(e.id, { active: x.target.checked })} />
                  </td>
                  <td>
                    <button
                      className="btn sm ghost"
                      title="Delete employee"
                      onClick={() => {
                        if (!confirm(`Delete ${e.name}? Their assignments and leave are removed too. (Untick Active to keep history instead.)`)) return;
                        update(
                          (d) => ({
                            ...d,
                            employees: d.employees.filter((x) => x.id !== e.id),
                            assignments: d.assignments.filter((a) => a.employeeId !== e.id),
                            leaves: d.leaves.filter((l) => l.employeeId !== e.id),
                            pods: d.pods.map((p) => (p.leadId === e.id ? { ...p, leadId: null } : p)),
                          }),
                          `${e.name} deleted.`,
                        );
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Pods & process types ────────────────────────────────────────────────────

function PodsAndProcesses() {
  const { data, updateData: update, notify } = useStore();
  const [pn, setPn] = useState('');
  const [np, setNp] = useState({ code: '', name: '', color: '#0d9488' });
  return (
    <div className="grid2">
      <div className="panel panel-pad stack">
        <h3>Pods</h3>
        <table className="data small">
          <thead>
            <tr>
              <th>Name</th>
              <th>Lead</th>
              <th>Brands</th>
              <th>People</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.pods.map((p) => {
              const nb = data.brands.filter((b) => b.podId === p.id).length;
              const ne = data.employees.filter((e) => e.podId === p.id).length;
              return (
                <tr key={p.id}>
                  <td>
                    <input value={p.name} onChange={(e) => update((d) => ({ ...d, pods: d.pods.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)) }))} style={{ width: 110 }} />
                  </td>
                  <td>
                    <select value={p.leadId ?? ''} onChange={(e) => update((d) => ({ ...d, pods: d.pods.map((x) => (x.id === p.id ? { ...x, leadId: e.target.value || null } : x)) }))}>
                      <option value="">None</option>
                      {data.employees
                        .filter((e) => e.podId === p.id)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>{nb}</td>
                  <td>{ne}</td>
                  <td>
                    <button
                      className="btn sm ghost"
                      onClick={() => (nb || ne ? notify('Move its brands and people to another pod first.') : update((d) => ({ ...d, pods: d.pods.filter((x) => x.id !== p.id) }), 'Pod deleted.'))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row">
          <input placeholder="New pod name" value={pn} onChange={(e) => setPn(e.target.value)} />
          <button
            className="btn sm primary"
            disabled={!pn.trim()}
            onClick={() => (update((d) => ({ ...d, pods: [...d.pods, { id: uid('pod'), name: pn.trim(), leadId: null }] }), `Pod ${pn} added.`), setPn(''))}
          >
            Add pod
          </button>
        </div>
      </div>
      <div className="panel panel-pad stack">
        <h3>Process types</h3>
        <table className="data small">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Colour</th>
              <th>Used by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.processes.map((p) => {
              const used = data.requirements.filter((r) => r.processId === p.id).length;
              const set = (patch: Partial<typeof p>) => update((d) => ({ ...d, processes: d.processes.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) }));
              return (
                <tr key={p.id}>
                  <td>
                    <input value={p.code} maxLength={4} style={{ width: 56 }} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
                  </td>
                  <td>
                    <input value={p.name} onChange={(e) => set({ name: e.target.value })} />
                  </td>
                  <td>
                    <input type="color" value={p.color} onChange={(e) => set({ color: e.target.value })} />
                  </td>
                  <td>{used} brand(s)</td>
                  <td>
                    <button
                      className="btn sm ghost"
                      onClick={() => (used ? notify('Remove it from brands first.') : update((d) => ({ ...d, processes: d.processes.filter((x) => x.id !== p.id) }), 'Process type deleted.'))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row">
          <input placeholder="Code" maxLength={4} style={{ width: 64 }} value={np.code} onChange={(e) => setNp({ ...np, code: e.target.value.toUpperCase() })} />
          <input placeholder="Name, e.g. Chat support" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
          <input type="color" value={np.color} onChange={(e) => setNp({ ...np, color: e.target.value })} />
          <button
            className="btn sm primary"
            disabled={!np.code || !np.name || data.processes.some((p) => p.id === np.code)}
            onClick={() => (update((d) => ({ ...d, processes: [...d.processes, { id: np.code, ...np }] }), `Process ${np.code} added. Add it to brands under Brands.`), setNp({ code: '', name: '', color: '#0d9488' }))}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Holidays & leave ────────────────────────────────────────────────────────

function CalendarSetup() {
  const { data, updateData: update, month } = useStore();
  const [h, setH] = useState({ date: '', name: '' });
  const [l, setL] = useState({ employeeId: data.employees[0]?.id ?? '', start: '', end: '', type: 'PLANNED' as LeaveType, status: 'APPROVED' as 'APPROVED' | 'PENDING' });
  const [all, setAll] = useState(false);
  const leaves = [...data.leaves].filter((x) => all || x.start.slice(0, 7) <= month && x.end.slice(0, 7) >= month).sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className="grid2">
      <div className="panel panel-pad stack">
        <h3>Public holidays</h3>
        <p className="small muted">Processes with “public holidays off” close on these days; 365-day processes stay open and the engine rotates who works them.</p>
        <div className="table-wrap" style={{ maxHeight: 380 }}>
          <table className="data small">
            <tbody>
              {[...data.holidays]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((x) => (
                  <tr key={x.date}>
                    <td>{fmtDate(x.date)} {x.date.slice(0, 4)}</td>
                    <td>{x.name}</td>
                    <td>
                      <button className="btn sm ghost" onClick={() => update((d) => ({ ...d, holidays: d.holidays.filter((y) => y.date !== x.date) }))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <input type="date" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} />
          <input placeholder="Name" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
          <button
            className="btn sm primary"
            disabled={!h.date || !h.name}
            onClick={() => (update((d) => ({ ...d, holidays: [...d.holidays.filter((y) => y.date !== h.date), { ...h }] }), 'Holiday added.'), setH({ date: '', name: '' }))}
          >
            Add
          </button>
        </div>
      </div>
      <div className="panel panel-pad stack">
        <div className="row">
          <h3>Leave & comp-offs</h3>
          <div className="spacer" />
          <label className="row small muted">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> all months
          </label>
        </div>
        <p className="small muted">Approved leave is a hard constraint. Pending leave is not rostered yet, but the engine warns where approving it would leave a gap.</p>
        <div className="table-wrap" style={{ maxHeight: 380 }}>
          <table className="data small">
            <tbody>
              {leaves.map((x) => (
                <tr key={x.id}>
                  <td>{data.employees.find((e) => e.id === x.employeeId)?.name}</td>
                  <td>
                    {fmtDate(x.start)}
                    {x.end !== x.start && ` – ${fmtDate(x.end)}`}
                  </td>
                  <td>{x.type.replace('_', '-').toLowerCase()}</td>
                  <td>
                    <span className={`badge ${x.status === 'APPROVED' ? 'ok' : 'warn'}`}>{x.status.toLowerCase()}</span>
                  </td>
                  <td>
                    <button className="btn sm ghost" onClick={() => update((d) => ({ ...d, leaves: d.leaves.filter((y) => y.id !== x.id) }))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {leaves.length === 0 && (
                <tr>
                  <td className="muted">No leave this month.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="row">
          <select value={l.employeeId} onChange={(e) => setL({ ...l, employeeId: e.target.value })}>
            {data.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <input type="date" value={l.start} onChange={(e) => setL({ ...l, start: e.target.value, end: l.end && l.end >= e.target.value ? l.end : e.target.value })} />
          <input type="date" value={l.end} min={l.start} onChange={(e) => setL({ ...l, end: e.target.value })} />
          <select value={l.type} onChange={(e) => setL({ ...l, type: e.target.value as LeaveType })}>
            <option value="PLANNED">Planned</option>
            <option value="SICK">Sick</option>
            <option value="COMP_OFF">Comp-off</option>
            <option value="UNAVAILABLE">Unavailable</option>
          </select>
          <select value={l.status} onChange={(e) => setL({ ...l, status: e.target.value as 'APPROVED' | 'PENDING' })}>
            <option value="APPROVED">Approved</option>
            <option value="PENDING">Pending</option>
          </select>
          <button
            className="btn sm primary"
            disabled={!l.start || !l.end || l.end < l.start}
            onClick={() => (update((d) => ({ ...d, leaves: [...d.leaves, { id: uid('lv'), ...l }] }), 'Leave recorded.'), setL({ ...l, start: '', end: '' }))}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shifts & rules ──────────────────────────────────────────────────────────

function ShiftsAndPolicy() {
  const { data, updateData: update, notify } = useStore();
  const [ns, setNs] = useState({ name: '', start: '09:00', end: '17:00' });
  return (
    <div className="grid2">
      <div className="panel panel-pad stack">
        <h3>Shifts</h3>
        <table className="data small">
          <tbody>
            {data.shifts.map((s) => {
              const set = (patch: Partial<typeof s>) => update((d) => ({ ...d, shifts: d.shifts.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) }));
              const used = data.requirements.filter((r) => r.shiftId === s.id).length;
              return (
                <tr key={s.id}>
                  <td>
                    <input value={s.name} onChange={(e) => set({ name: e.target.value })} style={{ width: 110 }} />
                  </td>
                  <td>
                    <input type="time" value={s.start} onChange={(e) => set({ start: e.target.value })} />
                  </td>
                  <td>
                    <input type="time" value={s.end} onChange={(e) => set({ end: e.target.value })} />
                  </td>
                  <td className="muted">{used} process(es)</td>
                  <td>
                    <button className="btn sm ghost" onClick={() => (used ? notify('Shift is in use.') : update((d) => ({ ...d, shifts: d.shifts.filter((x) => x.id !== s.id) })))}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row">
          <input placeholder="Name" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} style={{ width: 110 }} />
          <input type="time" value={ns.start} onChange={(e) => setNs({ ...ns, start: e.target.value })} />
          <input type="time" value={ns.end} onChange={(e) => setNs({ ...ns, end: e.target.value })} />
          <button className="btn sm primary" disabled={!ns.name} onClick={() => (update((d) => ({ ...d, shifts: [...d.shifts, { id: uid('sh'), ...ns }] }), 'Shift added.'), setNs({ ...ns, name: '' }))}>
            Add
          </button>
        </div>
      </div>
      <div className="panel panel-pad stack">
        <h3>Rules</h3>
        <label className="field">
          Max consecutive working days (warning above this)
          <Num value={data.policy.maxConsecutiveDays} min={3} max={13} onChange={(n) => update((d) => ({ ...d, policy: { ...d.policy, maxConsecutiveDays: n } }))} />
        </label>
        <label className="field">
          Max hours from first shift start to last shift end for one person in a day (decides whether a backup can cover a different shift)
          <Num value={data.policy.maxDaySpanHours} min={8} max={16} onChange={(n) => update((d) => ({ ...d, policy: { ...d.policy, maxDaySpanHours: n } }))} />
        </label>
        <div className="small muted">
          <b>Always mandatory:</b> client coverage on operating days, approved leave and availability, no clashing shifts, load within each person’s max, and
          their weekly-off entitlement. <b>Preferences:</b> preferred off-days, fair holiday rotation, spreading backup duty, consecutive-day limit.
        </div>
      </div>
    </div>
  );
}

// ── Data ────────────────────────────────────────────────────────────────────

function DataTools() {
  const { state, replaceState, resetAll, notify } = useStore();
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="panel panel-pad stack">
      <h3>Data</h3>
      <p className="small muted">
        Everything is stored in this browser. Export a backup to move it to another machine or share a scenario; import restores it exactly.
      </p>
      <div className="row">
        <button className="btn" onClick={() => downloadFile(`smart-roster-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json')}>
          Export JSON
        </button>
        <button className="btn" onClick={() => file.current?.click()}>
          Import JSON…
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const s = JSON.parse(await f.text()) as AppState;
              if (s?.data?.version !== 1 || !s.rosters || !s.month) throw new Error('not a Smart Roster export');
              replaceState(s);
              notify('Imported.');
            } catch (err) {
              notify('Import failed: ' + String(err));
            }
            e.target.value = '';
          }}
        />
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Replace everything with the sample dataset? Generated rosters are removed.')) {
              resetAll();
              notify('Sample data restored.');
            }
          }}
        >
          Reset to sample data
        </button>
      </div>
    </div>
  );
}
