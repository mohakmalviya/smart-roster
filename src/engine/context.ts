import { fullWeeks, inRange, minutes, monthDates, monthWeeks, weekday } from './dates';
import type {
  Brand,
  Cell,
  CellMap,
  Dataset,
  Employee,
  ID,
  ISODate,
  Leave,
  ProcessType,
  Requirement,
  Shift,
} from './types';

/**
 * Pre-computed, read-only view of the dataset for one month. Everything the
 * generator and validator need is looked up from here in O(1).
 */
export interface Ctx {
  data: Dataset;
  month: string;
  dates: ISODate[];
  dateSet: Set<ISODate>;
  /** Mon–Sun weeks clipped to the month (for display / suggestions). */
  weeks: ISODate[][];
  /** Full Mon–Sun weeks touching the month, incl. days of adjacent months. */
  fullWeeks: ISODate[][];
  /** Cells of the adjacent months' rosters (if they exist), for cross-month rules. */
  adj: CellMap;
  /** Consecutive working days at the end of the previous month's roster. */
  prevTrail: Map<ID, number>;
  holidays: Map<ISODate, string>;
  emps: Employee[]; // active only, stable order
  emp: Map<ID, Employee>;
  req: Map<ID, Requirement>;
  reqs: Requirement[];
  brand: Map<ID, Brand>;
  process: Map<ID, ProcessType>;
  shift: Map<ID, Shift>;
  primariesOf: Map<ID, ID[]>; // reqId → empIds
  backupsOf: Map<ID, ID[]>;
  primaryReqsOf: Map<ID, ID[]>; // empId → reqIds
  backupReqsOf: Map<ID, ID[]>;
  /** required[reqId][date] */
  required: Map<ID, Map<ISODate, number>>;
  /** approved leave per employee per date */
  leaveOn: Map<ID, Map<ISODate, Leave>>;
  pendingLeaves: Leave[];
}

export interface Adjacent {
  prev?: CellMap;
  next?: CellMap;
}

export function buildContext(data: Dataset, month: string, adjacent: Adjacent = {}): Ctx {
  const dates = monthDates(month);
  const adj: CellMap = {};
  for (const src of [adjacent.prev, adjacent.next]) {
    if (!src) continue;
    for (const [e, row] of Object.entries(src)) adj[e] = { ...(adj[e] ?? {}), ...row };
  }
  const prevTrail = new Map<ID, number>();
  if (adjacent.prev) {
    for (const [e, row] of Object.entries(adjacent.prev)) {
      const ds = Object.keys(row).sort();
      let n = 0;
      for (let i = ds.length - 1; i >= 0 && row[ds[i]].status === 'WORK'; i--) n++;
      prevTrail.set(e, n);
    }
  }
  const holidays = new Map(data.holidays.map((h) => [h.date, h.name]));
  const emps = data.employees.filter((e) => e.active);
  const emp = new Map(emps.map((e) => [e.id, e]));
  const reqs = data.requirements.filter((r) => data.brands.some((b) => b.id === r.brandId));
  const req = new Map(reqs.map((r) => [r.id, r]));

  const primariesOf = new Map<ID, ID[]>();
  const backupsOf = new Map<ID, ID[]>();
  const primaryReqsOf = new Map<ID, ID[]>();
  const backupReqsOf = new Map<ID, ID[]>();
  for (const r of reqs) {
    primariesOf.set(r.id, []);
    backupsOf.set(r.id, []);
  }
  for (const e of emps) {
    primaryReqsOf.set(e.id, []);
    backupReqsOf.set(e.id, []);
  }
  for (const a of data.assignments) {
    if (!emp.has(a.employeeId) || !req.has(a.requirementId)) continue;
    if (a.role === 'PRIMARY') {
      push(primariesOf, a.requirementId, a.employeeId);
      push(primaryReqsOf, a.employeeId, a.requirementId);
    } else {
      push(backupsOf, a.requirementId, a.employeeId);
      push(backupReqsOf, a.employeeId, a.requirementId);
    }
  }

  const required = new Map<ID, Map<ISODate, number>>();
  for (const r of reqs) {
    const m = new Map<ISODate, number>();
    for (const d of dates) m.set(d, requiredOn(r, d, holidays.has(d)));
    required.set(r.id, m);
  }

  const leaveOn = new Map<ID, Map<ISODate, Leave>>();
  const pendingLeaves: Leave[] = [];
  for (const l of data.leaves) {
    if (!emp.has(l.employeeId)) continue;
    if (l.status === 'PENDING') {
      if (dates.some((d) => inRange(d, l.start, l.end))) pendingLeaves.push(l);
      continue;
    }
    for (const d of dates) {
      if (inRange(d, l.start, l.end)) {
        if (!leaveOn.has(l.employeeId)) leaveOn.set(l.employeeId, new Map());
        leaveOn.get(l.employeeId)!.set(d, l);
      }
    }
  }

  return {
    data,
    month,
    dates,
    dateSet: new Set(dates),
    weeks: monthWeeks(month),
    fullWeeks: fullWeeks(month),
    adj,
    prevTrail,
    holidays,
    emps,
    emp,
    req,
    reqs,
    brand: new Map(data.brands.map((b) => [b.id, b])),
    process: new Map(data.processes.map((p) => [p.id, p])),
    shift: new Map(data.shifts.map((s) => [s.id, s])),
    primariesOf,
    backupsOf,
    primaryReqsOf,
    backupReqsOf,
    required,
    leaveOn,
    pendingLeaves,
  };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

/** The client's need: how many people a requirement needs on a date (0 = not operating). */
export function requiredOn(r: Requirement, d: ISODate, isHoliday: boolean): number {
  if (d in r.dateMin) return r.dateMin[d];
  const wd = weekday(d);
  const operates = r.calendar.weekdays[wd] && (!isHoliday || r.calendar.publicHolidays);
  if (!operates) return 0;
  return r.weekdayMin[wd] ?? r.minStaff;
}

export function req(ctx: Ctx, id: ID): Requirement {
  return ctx.req.get(id)!;
}

export function reqLabel(ctx: Ctx, id: ID): string {
  const r = ctx.req.get(id);
  if (!r) return id;
  return `${ctx.brand.get(r.brandId)?.name ?? r.brandId} ${ctx.process.get(r.processId)?.code ?? r.processId}`;
}

export function empName(ctx: Ctx, id: ID): string {
  return ctx.emp.get(id)?.name ?? ctx.data.employees.find((e) => e.id === id)?.name ?? id;
}

/** Hard unavailability that does not depend on roster decisions. */
export function fixedUnavailable(ctx: Ctx, empId: ID, d: ISODate): Cell | null {
  const lv = ctx.leaveOn.get(empId)?.get(d);
  if (lv) {
    const status = lv.type === 'COMP_OFF' ? 'COMP_OFF' : lv.type === 'UNAVAILABLE' ? 'NA' : 'LEAVE';
    return { status, duties: [], note: lv.note };
  }
  const e = ctx.emp.get(empId)!;
  if (!e.availableWeekdays[weekday(d)]) return { status: 'NA', duties: [], note: 'Not available on this weekday' };
  return null;
}

export function load(ctx: Ctx, cell: Cell | undefined): number {
  if (!cell) return 0;
  let s = 0;
  for (const du of cell.duties) s += ctx.req.get(du.requirementId)?.effort ?? 0;
  return Math.round(s * 100) / 100;
}

/** Earliest start → latest end (minutes) across a set of requirement shifts. */
export function shiftSpan(ctx: Ctx, reqIds: ID[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of reqIds) {
    const s = ctx.shift.get(ctx.req.get(id)?.shiftId ?? '');
    if (!s) continue;
    const a = minutes(s.start);
    let b = minutes(s.end);
    if (b <= a) b += 24 * 60; // overnight shift
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  return hi === -Infinity ? 0 : hi - lo;
}

export function shiftCompatible(ctx: Ctx, existing: ID[], adding: ID): boolean {
  if (existing.length === 0) return true;
  return shiftSpan(ctx, [...existing, adding]) <= ctx.data.policy.maxDaySpanHours * 60;
}

export function cloneCells(cells: CellMap): CellMap {
  const out: CellMap = {};
  for (const [e, row] of Object.entries(cells)) {
    out[e] = {};
    for (const [d, c] of Object.entries(row)) out[e][d] = { ...c, duties: c.duties.map((x) => ({ ...x })) };
  }
  return out;
}
