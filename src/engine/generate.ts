import { buildContext, cloneCells, fixedUnavailable, load, reqLabel, shiftCompatible, empName, type Ctx } from './context';
import { fmtDate, weekday } from './dates';
import type { Cell, CellMap, Dataset, ID, ISODate, Roster, RosterLogEntry } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Roster generation
//
// Decision variables: WHICH days each employee takes their weekly off(s),
// planned per full Mon–Sun week (weeks that straddle two months are planned as
// one week, using the adjacent month's roster when it exists).
// Everything else follows deterministically from those choices:
//   leave / availability  →  fixed
//   weekly offs           →  chosen by search
//   public holidays       →  only as many primaries as the client needs work,
//                            rotated by who has worked the fewest holidays
//   primary duties        →  an available primary covers every one of their
//                            processes that operates that day
//   backup cover          →  gaps are filled from configured backups who are
//                            free, shift-compatible and under their load cap
//
// The search minimises a weighted cost:
//   uncovered head-days ×1000 (hard: client coverage)
//   consecutive days over the policy limit ×300
//   weekly off on a public holiday ×8 (the person loses a holiday)
//   idle agent days ×6 (a day an agent has nothing to cover should BE the off)
//   preferred off-day missed ×4 (soft preference; always loses to coverage)
//   backup usage ×3, stretched (>1.0 FTE) backup ×5
// Weekly-off entitlement is never traded away by the generator: it is a hard
// labour rule. When coverage is impossible without breaking it, the gap is
// left visible and explained instead of silently producing an invalid roster.
// ─────────────────────────────────────────────────────────────────────────────

export const COST = {
  GAP: 1000,
  CONSECUTIVE: 300,
  OFF_ON_HOLIDAY: 8,
  IDLE: 6,
  PREFERENCE: 4,
  BACKUP: 3,
  STRETCH: 5,
};

export interface GenerateOptions {
  /** Existing roster: its locked cells are kept as-is. */
  existing?: Roster;
  /** Keep every cell before this date unchanged (re-optimise the rest of the month). */
  freezeBefore?: ISODate;
  /** Adjacent months' rosters, so weeks that straddle months are planned as one week. */
  prev?: CellMap;
  next?: CellMap;
  maxRounds?: number;
}

export interface GenerateResult {
  roster: Roster;
  cost: number;
  gapUnits: number;
  evaluations: number;
  ms: number;
}

type Fixed = Map<ID, Map<ISODate, Cell>>;
type Offs = Map<ID, Set<ISODate>>;

interface Slot {
  empId: ID;
  /** Full Mon–Sun week (shared array reference from ctx.fullWeeks). */
  week: ISODate[];
  /** The week's dates that fall inside this month. */
  inMonth: ISODate[];
  options: ISODate[][];
}

export function generateRoster(data: Dataset, month: string, opts: GenerateOptions = {}): GenerateResult {
  const t0 = Date.now();
  const ctx = buildContext(data, month, { prev: opts.prev, next: opts.next });
  const fixed = buildFixed(ctx, opts);
  const slots = buildSlots(ctx, fixed);

  // Initial guess: heuristic per slot (natural off-days, preferences, avoid holidays).
  const offs: Offs = new Map(ctx.emps.map((e) => [e.id, new Set<ISODate>()]));
  for (const s of slots) {
    const best = [...s.options].sort((a, b) => heuristic(ctx, s.empId, a) - heuristic(ctx, s.empId, b))[0];
    for (const d of best ?? []) offs.get(s.empId)!.add(d);
  }

  const ev = new Evaluator(ctx, fixed, offs, opts.freezeBefore);
  ev.full();
  let cost = ev.total();

  // Move 1: re-place one employee-week's off(s); keep strict improvements.
  const singlePass = (): boolean => {
    let improved = false;
    for (const s of slots) {
      if (s.options.length <= 1) continue;
      const set = offs.get(s.empId)!;
      let bestOpt = s.week.filter((d) => set.has(d));
      for (const opt of s.options) {
        if (sameDays(opt, bestOpt)) continue;
        const snap = ev.snapshot(s.inMonth);
        setDays(set, s.week, opt);
        ev.evalDays(s.inMonth);
        const c = ev.total();
        if (c < cost - 1e-9) {
          cost = c;
          bestOpt = opt;
          improved = true;
        } else {
          setDays(set, s.week, bestOpt);
          ev.restore(snap);
        }
      }
    }
    return improved;
  };

  // Move 2: in "problem" weeks (a coverage gap or an over-long working run),
  // re-place the offs of TWO people from the affected pod at once — e.g. a
  // primary and the backup who must cover for them. When such a pair move
  // removes the problem but costs more elsewhere, also try re-placing the two
  // people's offs in the neighbouring weeks (a 3–4 slot compound move).
  const weekIndex = new Map(ctx.fullWeeks.map((w, i) => [w, i]));
  const slotOf = new Map<string, Slot>();
  for (const s of slots) slotOf.set(`${s.empId}|${weekIndex.get(s.week)}`, s);

  const saveState = (ids: ID[]) => ({
    sets: ids.map((id) => [id, new Set(offs.get(id)!)] as const),
    days: ev.snapshot(ctx.dates),
  });
  const loadState = (st: ReturnType<typeof saveState>) => {
    for (const [id, set] of st.sets) offs.set(id, new Set(set));
    ev.restore(st.days);
  };
  let budget = 6000;
  const greedySlot = (s: Slot) => {
    const set = offs.get(s.empId)!;
    let bestOpt = s.week.filter((d) => set.has(d));
    let bestC = ev.total();
    for (const opt of s.options) {
      if (sameDays(opt, bestOpt)) continue;
      budget--;
      const snap = ev.snapshot(s.inMonth);
      setDays(set, s.week, opt);
      ev.evalDays(s.inMonth);
      const c = ev.total();
      if (c < bestC - 1e-9) {
        bestC = c;
        bestOpt = opt;
      } else {
        setDays(set, s.week, bestOpt);
        ev.restore(snap);
      }
    }
  };

  /** People whose offs could fix a problem in this week. */
  const involvedIn = (week: ISODate[]): Set<ID> => {
    const out = new Set<ID>();
    const addReq = (r: ID) => {
      for (const id of ctx.primariesOf.get(r) ?? []) out.add(id);
      for (const id of ctx.backupsOf.get(r) ?? []) out.add(id);
    };
    for (const d of week) if (ctx.dateSet.has(d)) for (const r of ev.gapReqs(d)) addReq(r);
    for (const run of ev.runs())
      if (week.some((d) => d >= run.from && d <= run.to)) {
        out.add(run.empId);
        for (const r of ctx.primaryReqsOf.get(run.empId) ?? []) addReq(r);
      }
    return out;
  };

  const pairPass = (): boolean => {
    let improved = false;
    for (const week of ctx.fullWeeks) {
      const wi = weekIndex.get(week)!;
      const inMonth = week.filter((d) => ctx.dateSet.has(d));
      const involved = involvedIn(week);
      if (!involved.size) continue;
      const ws = slots.filter((s) => s.week === week && s.options.length > 1 && involved.has(s.empId));
      for (let i = 0; i < ws.length; i++) {
        for (let j = i + 1; j < ws.length; j++) {
          const A = ws[i];
          const B = ws[j];
          let bestA = week.filter((d) => offs.get(A.empId)!.has(d));
          let bestB = week.filter((d) => offs.get(B.empId)!.has(d));
          for (const oa of A.options) {
            for (const ob of B.options) {
              if (sameDays(oa, bestA) && sameDays(ob, bestB)) continue;
              if (--budget < 0) return improved;
              const before = ev.badness();
              const st = saveState([A.empId, B.empId]);
              setDays(offs.get(A.empId)!, week, oa);
              setDays(offs.get(B.empId)!, week, ob);
              ev.evalDays(inMonth);
              let c = ev.total();
              if (c >= cost - 1e-9 && ev.badness() < before) {
                for (const s of [A, B])
                  for (const k of [wi - 1, wi + 1]) {
                    const s2 = slotOf.get(`${s.empId}|${k}`);
                    if (s2 && s2.options.length > 1) greedySlot(s2);
                  }
                c = ev.total();
              }
              if (c < cost - 1e-9) {
                cost = c;
                bestA = oa;
                bestB = ob;
                improved = true;
              } else loadState(st);
            }
          }
        }
      }
    }
    return improved;
  };

  const maxRounds = opts.maxRounds ?? 6;
  for (let round = 0; round < maxRounds; round++) {
    const a = singlePass();
    const b = pairPass();
    if (!a && !b) break;
  }

  ev.full(); // exact final pass (holiday rotation and backup fairness in date order)
  const cells = ev.cells();
  const gapUnits = ev.gapUnits();
  const finalCost = ev.total();

  const log: RosterLogEntry[] = [
    ...(opts.existing?.log ?? []),
    {
      at: new Date().toISOString(),
      text: opts.freezeBefore
        ? `Re-optimised from ${fmtDate(opts.freezeBefore)} (earlier days and locked cells kept). ${gapUnits} uncovered shift(s) remain.`
        : `Generated roster (${ev.evaluations} plans evaluated). ${gapUnits} uncovered shift(s) remain.`,
    },
  ];

  const roster: Roster = {
    month,
    cells,
    generatedAt: new Date().toISOString(),
    status: opts.existing?.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
    publishedCells: opts.existing?.publishedCells,
    publishedAt: opts.existing?.publishedAt,
    acknowledged: opts.existing?.acknowledged,
    log,
  };
  return { roster, cost: finalCost, gapUnits, evaluations: ev.evaluations, ms: Date.now() - t0 };
}

function buildFixed(ctx: Ctx, opts: GenerateOptions): Fixed {
  const fixed: Fixed = new Map();
  for (const e of ctx.emps) {
    const m = new Map<ISODate, Cell>();
    for (const d of ctx.dates) {
      const ex = opts.existing?.cells[e.id]?.[d];
      if (ex && (ex.locked || (opts.freezeBefore && d < opts.freezeBefore))) {
        m.set(d, { ...ex, duties: ex.duties.map((x) => ({ ...x })) });
        continue;
      }
      const u = fixedUnavailable(ctx, e.id, d);
      if (u) m.set(d, u);
    }
    fixed.set(e.id, m);
  }
  return fixed;
}

function buildSlots(ctx: Ctx, fixed: Fixed): Slot[] {
  const slots: Slot[] = [];
  for (const e of ctx.emps) {
    const f = fixed.get(e.id)!;
    for (const week of ctx.fullWeeks) {
      let already = 0;
      const free: ISODate[] = [];
      for (const d of week) {
        if (ctx.dateSet.has(d)) {
          const c = f.get(d);
          if (!c) free.push(d);
          else if (c.status === 'WO' || (c.status === 'NA' && !ctx.leaveOn.get(e.id)?.has(d))) already++;
        } else {
          const a = ctx.adj[e.id]?.[d];
          if (!a) free.push(d); // adjacent month not rostered yet: the off may land there
          else if (a.status === 'WO' || a.status === 'NA') already++;
        }
      }
      const k = Math.max(0, Math.min(e.offsPerWeek - already, free.length));
      if (k === 0) continue;
      slots.push({ empId: e.id, week, inMonth: week.filter((d) => ctx.dateSet.has(d)), options: combinations(free, k) });
    }
  }
  // Most constrained first: fewest options.
  return slots.sort((a, b) => a.options.length - b.options.length);
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

function setDays(set: Set<ISODate>, week: ISODate[], days: ISODate[]) {
  for (const d of week) set.delete(d);
  for (const d of days) set.add(d);
}

function sameDays(a: ISODate[], b: ISODate[]) {
  return a.length === b.length && a.every((d) => b.includes(d));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function operatingPrimaries(ctx: Ctx, empId: ID, d: ISODate): ID[] {
  return (ctx.primaryReqsOf.get(empId) ?? []).filter((r) => (ctx.required.get(r)!.get(d) ?? 0) > 0);
}

function heuristic(ctx: Ctx, empId: ID, days: ISODate[]): number {
  const e = ctx.emp.get(empId)!;
  let s = 0;
  for (const d of days) {
    if (!ctx.dateSet.has(d)) {
      s += 1 + hash(empId + d);
      continue;
    }
    const hasPrimaries = (ctx.primaryReqsOf.get(empId) ?? []).length > 0;
    if (hasPrimaries && operatingPrimaries(ctx, empId, d).length === 0) s -= 10;
    if (e.preferredOffDays.includes(weekday(d))) s -= 3;
    if (ctx.holidays.has(d)) s += 8;
    s += hash(empId + d);
  }
  return s;
}

interface DayResult {
  cells: CellMap; // cells[emp][d] for this one day
  cost: number;
  gaps: number;
  gapReqs: ID[];
}

/**
 * Caches one materialised day per date so a search move only re-computes the
 * days of the week it touched, plus cheap person-level costs.
 */
class Evaluator {
  private day = new Map<ISODate, DayResult>();
  private phWorked = new Map<ID, number>();
  private backupDays = new Map<ID, number>();
  evaluations = 0;

  constructor(
    private ctx: Ctx,
    private fixed: Fixed,
    private offs: Offs,
    private freezeBefore?: ISODate,
  ) {}

  full() {
    const ph = new Map<ID, number>();
    const bd = new Map<ID, number>();
    for (const d of this.ctx.dates) this.day.set(d, materialiseDay(this.ctx, this.fixed, this.offs, d, ph, bd, this.freezeBefore));
    this.phWorked = ph;
    this.backupDays = bd;
    this.evaluations++;
  }

  evalDays(ds: ISODate[]) {
    for (const d of ds)
      this.day.set(d, materialiseDay(this.ctx, this.fixed, this.offs, d, new Map(this.phWorked), new Map(this.backupDays), this.freezeBefore));
    this.evaluations++;
  }

  snapshot(ds: ISODate[]): [ISODate, DayResult][] {
    return ds.map((d) => [d, this.day.get(d)!]);
  }

  restore(snap: [ISODate, DayResult][]) {
    for (const [d, r] of snap) this.day.set(d, r);
  }

  gapReqs(d: ISODate): ID[] {
    return this.day.get(d)?.gapReqs ?? [];
  }

  /** Working runs longer than the policy allows. */
  runs(): { empId: ID; from: ISODate; to: ISODate; extra: number }[] {
    const out: { empId: ID; from: ISODate; to: ISODate; extra: number }[] = [];
    const max = this.ctx.data.policy.maxConsecutiveDays;
    for (const e of this.ctx.emps) {
      let run = this.ctx.prevTrail.get(e.id) ?? 0;
      let from = this.ctx.dates[0];
      const ds = this.ctx.dates;
      for (let i = 0; i <= ds.length; i++) {
        const working = i < ds.length && this.day.get(ds[i])!.cells[e.id][ds[i]].status === 'WORK';
        if (working) {
          if (run === 0) from = ds[i];
          run++;
        } else {
          if (run > max) out.push({ empId: e.id, from, to: ds[i - 1], extra: run - max });
          run = 0;
        }
      }
    }
    return out;
  }

  /** Hard-ish problems only: uncovered head-days + days over the consecutive limit. */
  badness(): number {
    return this.gapUnits() + this.runs().reduce((s, r) => s + r.extra, 0);
  }

  gapUnits(): number {
    let n = 0;
    for (const r of this.day.values()) n += r.gaps;
    return n;
  }

  total(): number {
    let cost = 0;
    for (const r of this.day.values()) cost += r.cost;
    const ctx = this.ctx;
    for (const e of ctx.emps) {
      let run = ctx.prevTrail.get(e.id) ?? 0;
      for (const d of ctx.dates) {
        const c = this.day.get(d)!.cells[e.id][d];
        if (c.status === 'WORK') {
          run++;
          if (run > ctx.data.policy.maxConsecutiveDays) cost += COST.CONSECUTIVE;
        } else run = 0;
        if (c.status === 'IDLE') cost += COST.IDLE;
        if (c.status === 'WO' && e.preferredOffDays.length && !e.preferredOffDays.includes(weekday(d))) cost += COST.PREFERENCE;
      }
    }
    return cost;
  }

  cells(): CellMap {
    const out: CellMap = {};
    for (const e of this.ctx.emps) {
      out[e.id] = {};
      for (const d of this.ctx.dates) out[e.id][d] = this.day.get(d)!.cells[e.id][d];
    }
    return out;
  }
}

/** Turn the weekly-off decisions into one day of roster and score it. */
function materialiseDay(
  ctx: Ctx,
  fixed: Fixed,
  offs: Offs,
  d: ISODate,
  phWorked: Map<ID, number>,
  backupDays: Map<ID, number>,
  freezeBefore?: ISODate,
): DayResult {
  const cells: CellMap = {};
  let cost = 0;
  const isPH = ctx.holidays.has(d);
  const avail = new Set<ID>();
  for (const e of ctx.emps) {
    const f = fixed.get(e.id)!.get(d);
    if (f) {
      cells[e.id] = { [d]: { ...f, duties: f.duties.map((x) => ({ ...x })) } };
      continue;
    }
    if (offs.get(e.id)!.has(d)) {
      cells[e.id] = { [d]: { status: 'WO', duties: [] } };
      if (isPH) cost += COST.OFF_ON_HOLIDAY;
      continue;
    }
    avail.add(e.id);
  }

  if (!isPH) {
    for (const id of avail) cells[id] = { [d]: baseWorkingCell(ctx, id, d) };
  } else {
    // Public holiday: only as many primaries as the client needs, fairly rotated.
    const working = new Set<ID>();
    const opReqs = ctx.reqs
      .filter((r) => (ctx.required.get(r.id)!.get(d) ?? 0) > 0)
      .map((r) => ({ r, n: (ctx.primariesOf.get(r.id) ?? []).filter((p) => avail.has(p)).length }))
      .sort((a, b) => a.n - b.n);
    for (const { r } of opReqs) {
      const need = ctx.required.get(r.id)!.get(d)!;
      let have = 0;
      for (const e of ctx.emps) if (cells[e.id]?.[d]?.duties.some((x) => x.requirementId === r.id)) have++;
      const cands = (ctx.primariesOf.get(r.id) ?? [])
        .filter((p) => avail.has(p) && !working.has(p))
        .sort((a, b) => (phWorked.get(a) ?? 0) - (phWorked.get(b) ?? 0) || hash(a + d) - hash(b + d));
      while (have < need && cands.length) {
        const p = cands.shift()!;
        working.add(p);
        cells[p] = { [d]: { status: 'WORK', duties: operatingPrimaries(ctx, p, d).map((id) => ({ requirementId: id, backup: false })) } };
        phWorked.set(p, (phWorked.get(p) ?? 0) + 1);
        have++;
      }
    }
    for (const id of avail) if (!working.has(id)) cells[id] = { [d]: { status: 'PH', duties: [] } };
  }

  if (freezeBefore && d < freezeBefore) return { cells, cost, gaps: 0, gapReqs: [] };
  const r = fillGaps(ctx, cells, d, backupDays);
  cost += r.gapUnits * COST.GAP + r.backupsUsed * COST.BACKUP + r.stretched * COST.STRETCH;
  return { cells, cost, gaps: r.gapUnits, gapReqs: r.gapReqs };
}

/** The cell for an available person on a normal (non-holiday) day. */
export function baseWorkingCell(ctx: Ctx, empId: ID, d: ISODate): Cell {
  const prim = ctx.primaryReqsOf.get(empId) ?? [];
  const ops = operatingPrimaries(ctx, empId, d);
  if (ops.length) return { status: 'WORK', duties: ops.map((id) => ({ requirementId: id, backup: false })) };
  if (prim.length === 0) return { status: 'WORK', duties: [] }; // lead / floater on standby
  return { status: 'IDLE', duties: [] };
}

export interface FillResult {
  gapUnits: number;
  backupsUsed: number;
  stretched: number;
  added: { empId: ID; requirementId: ID }[];
  gapReqs: ID[];
}

/**
 * Fill every coverage shortfall on a date from configured backups.
 * Never touches locked cells, people on leave/weekly off, or anyone whose
 * shift or load cap would be broken. Scarcest requirement is filled first.
 */
export function fillGaps(ctx: Ctx, cells: CellMap, d: ISODate, backupDays = new Map<ID, number>()): FillResult {
  const res: FillResult = { gapUnits: 0, backupsUsed: 0, stretched: 0, added: [], gapReqs: [] };
  const staffed = new Map<ID, number>();
  for (const e of ctx.emps)
    for (const du of cells[e.id]?.[d]?.duties ?? []) staffed.set(du.requirementId, (staffed.get(du.requirementId) ?? 0) + 1);

  const short = ctx.reqs
    .filter((r) => (ctx.required.get(r.id)!.get(d) ?? 0) > (staffed.get(r.id) ?? 0))
    .map((r) => ({ r, n: candidates(ctx, cells, d, r.id, backupDays).length }))
    .sort((a, b) => a.n - b.n);

  for (const { r } of short) {
    const need = ctx.required.get(r.id)!.get(d)!;
    let have = staffed.get(r.id) ?? 0;
    while (have < need) {
      const c = candidates(ctx, cells, d, r.id, backupDays)[0];
      if (!c) break;
      const cell = cells[c][d];
      cell.duties.push({ requirementId: r.id, backup: !(ctx.primariesOf.get(r.id) ?? []).includes(c) });
      cell.status = 'WORK';
      backupDays.set(c, (backupDays.get(c) ?? 0) + 1);
      res.backupsUsed++;
      if (load(ctx, cell) > 1 + 1e-9) res.stretched++;
      res.added.push({ empId: c, requirementId: r.id });
      have++;
    }
    if (need > have) {
      res.gapUnits += need - have;
      res.gapReqs.push(r.id);
    }
  }
  return res;
}

/** Ranked backup candidates for a requirement on a date. */
export function candidates(ctx: Ctx, cells: CellMap, d: ISODate, reqId: ID, backupDays = new Map<ID, number>()): ID[] {
  const r = ctx.req.get(reqId)!;
  const podId = ctx.brand.get(r.brandId)?.podId;
  const out: { id: ID; key: number[] }[] = [];
  const pool = new Set([...(ctx.backupsOf.get(reqId) ?? []), ...(ctx.primariesOf.get(reqId) ?? [])]);
  for (const id of pool) {
    const e = ctx.emp.get(id);
    const cell = cells[id]?.[d];
    if (!e || !cell || cell.locked) continue;
    const tier = cell.status === 'WORK' || cell.status === 'IDLE' ? 0 : cell.status === 'PH' ? 1 : -1;
    if (tier < 0) continue;
    const ids = cell.duties.map((x) => x.requirementId);
    if (ids.includes(reqId)) continue;
    if (!shiftCompatible(ctx, ids, reqId)) continue;
    const newLoad = load(ctx, cell) + r.effort;
    if (newLoad > e.maxLoad + 1e-9) continue;
    out.push({
      id,
      key: [tier, e.podId === podId ? 0 : 1, newLoad > 1 + 1e-9 ? 1 : 0, backupDays.get(id) ?? 0, newLoad, hash(id + d)],
    });
  }
  out.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    return 0;
  });
  return out.map((x) => x.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Incremental change handling: apply availability changes (new/changed leave)
// to an EXISTING roster with the minimum number of edits, instead of
// regenerating everything. Only the affected person-days change, and gaps on
// those days are re-filled from backups.
// ─────────────────────────────────────────────────────────────────────────────

export interface RepairResult {
  roster: Roster;
  changes: string[];
}

export function applyAvailabilityChanges(data: Dataset, roster: Roster): RepairResult {
  const ctx = buildContext(data, roster.month);
  const cells = cloneCells(roster.cells);
  const changes: string[] = [];
  const touched = new Set<ISODate>();

  for (const e of ctx.emps) {
    if (!cells[e.id]) {
      cells[e.id] = {};
      for (const d of ctx.dates) cells[e.id][d] = fixedUnavailable(ctx, e.id, d) ?? baseWorkingCell(ctx, e.id, d);
      changes.push(`${e.name} added to roster`);
      ctx.dates.forEach((d) => touched.add(d));
      continue;
    }
    for (const d of ctx.dates) {
      const cur = cells[e.id][d];
      if (!cur || cur.locked) continue;
      const u = fixedUnavailable(ctx, e.id, d);
      if (u && (cur.status !== u.status || cur.duties.length > 0)) {
        const was = describe(ctx, cur);
        cells[e.id][d] = u;
        changes.push(`${e.name}, ${fmtDate(d)}: ${was} → ${describe(ctx, u)}`);
        touched.add(d);
      } else if (!u && (cur.status === 'LEAVE' || cur.status === 'COMP_OFF' || cur.status === 'NA')) {
        const next = ctx.holidays.has(d) ? { status: 'PH' as const, duties: [] } : baseWorkingCell(ctx, e.id, d);
        changes.push(`${e.name}, ${fmtDate(d)}: ${describe(ctx, cur)} → ${describe(ctx, next)} (leave withdrawn)`);
        cells[e.id][d] = next;
        touched.add(d);
      }
    }
  }
  // Drop rows of removed/inactive employees.
  for (const id of Object.keys(cells)) if (!ctx.emp.has(id)) delete cells[id];

  for (const d of [...touched].sort()) {
    const r = fillGaps(ctx, cells, d);
    for (const a of r.added) changes.push(`${empName(ctx, a.empId)}, ${fmtDate(d)}: covers ${reqLabel(ctx, a.requirementId)} as backup`);
    if (r.gapUnits) changes.push(`Gap on ${fmtDate(d)}: ${r.gapUnits} shift(s) could not be covered automatically`);
  }

  return {
    roster: {
      ...roster,
      cells,
      log: [
        ...roster.log,
        {
          at: new Date().toISOString(),
          text: changes.length ? `Applied availability changes: ${changes.length} edit(s).` : 'Availability re-checked: no changes needed.',
        },
      ],
    },
    changes,
  };
}

export function describe(ctx: Ctx, c: Cell): string {
  if (c.status !== 'WORK') return STATUS_LABEL[c.status];
  if (!c.duties.length) return 'Working (standby)';
  return 'Working: ' + c.duties.map((x) => reqLabel(ctx, x.requirementId) + (x.backup ? ' (backup)' : '')).join(', ');
}

export const STATUS_LABEL: Record<Cell['status'], string> = {
  WORK: 'Working',
  WO: 'Weekly off',
  PH: 'Public holiday',
  LEAVE: 'Leave',
  COMP_OFF: 'Comp-off',
  NA: 'Not available',
  IDLE: 'No duty (processes closed)',
};
