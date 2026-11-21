import { candidates, STATUS_LABEL } from './generate';
import { empName, fixedUnavailable, load, reqLabel, shiftCompatible, shiftSpan, type Ctx } from './context';
import { fmtDate, inRange, WEEKDAY_SHORT, weekday, plural } from './dates';
import type { Cell, CellMap, CoverageMap, ID, ISODate, Issue, Suggestion } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Validation is a pure function of (dataset, roster cells). It runs after
// generation AND after every manual edit, so the manager always sees the
// consequences of a change before publishing.
//
// Hard constraints (ERROR): client coverage, availability/leave, shift clash,
//   load cap, weekly-off entitlement, missing staff configuration.
// Soft / advisory (WARNING / INFO): consecutive-day limit, unqualified cover,
//   pending-leave risk, comp-off balance, preferences, stretched backups.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmpStats {
  work: number;
  wo: number;
  ph: number;
  leave: number;
  compOff: number;
  na: number;
  idle: number;
  phWorked: number;
  backupDays: number;
  compOffBalance: number;
  prefMet: number;
  prefTotal: number;
  weekendOffs: number;
}

export interface Validation {
  issues: Issue[];
  coverage: CoverageMap;
  empStats: Map<ID, EmpStats>;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    requiredUnits: number;
    coveredUnits: number;
    gapUnits: number;
    coveragePct: number;
    gapDays: Set<ISODate>;
  };
}

export function validate(ctx: Ctx, cells: CellMap): Validation {
  const issues: Issue[] = [];
  const add = (i: Omit<Issue, 'key'> & { key?: string }) =>
    issues.push({ ...i, key: i.key ?? [i.type, i.employeeId ?? '', i.requirementId ?? '', i.date ?? ''].join('|') });

  const coverage = computeCoverage(ctx, cells);
  const cell = (e: ID, d: ISODate): Cell | undefined => cells[e]?.[d];

  // ── Configuration problems ───────────────────────────────────────────────
  const unstaffed = new Set<ID>();
  for (const r of ctx.reqs) {
    const days = ctx.dates.filter((d) => (ctx.required.get(r.id)!.get(d) ?? 0) > 0);
    if (days.length && (ctx.primariesOf.get(r.id) ?? []).length === 0) {
      unstaffed.add(r.id);
      add({
        type: 'NO_STAFF_CONFIGURED',
        severity: 'ERROR',
        hard: true,
        requirementId: r.id,
        brandId: r.brandId,
        title: `${reqLabel(ctx, r.id)} has no primary employee`,
        detail: `This process operates on ${days.length} ${plural(days.length, 'day')} this month but nobody is assigned as primary. ${
          (ctx.backupsOf.get(r.id) ?? []).length ? 'Only backups are configured, so it is covered ad hoc at best.' : 'No backups are configured either.'
        }`,
        suggestions: [{ kind: 'CONFIG', text: 'Assign a primary employee in Setup → Brands, processes & staffing.' }],
      });
    }
  }

  // ── Coverage gaps ────────────────────────────────────────────────────────
  for (const r of ctx.reqs) {
    for (const d of ctx.dates) {
      const cov = coverage[r.id][d];
      if (cov.required <= cov.staffed) continue;
      add({
        type: 'COVERAGE_GAP',
        severity: 'ERROR',
        hard: true,
        date: d,
        requirementId: r.id,
        brandId: r.brandId,
        title: `${reqLabel(ctx, r.id)} short by ${cov.required - cov.staffed} on ${fmtDate(d)}`,
        detail: explainGap(ctx, cells, r.id, d, cov.required, cov.staffed),
        suggestions: suggestForGap(ctx, cells, coverage, r.id, d),
      });
    }
  }

  // ── Multi-brand impact of one person's absence ───────────────────────────
  for (const d of ctx.dates) {
    for (const e of ctx.emps) {
      const c = cell(e.id, d);
      if (!c || c.status === 'WORK') continue;
      const short = (ctx.primaryReqsOf.get(e.id) ?? []).filter((r) => coverage[r][d].staffed < coverage[r][d].required);
      const brands = [...new Set(short.map((r) => ctx.req.get(r)!.brandId))];
      if (brands.length >= 2) {
        add({
          type: 'MULTI_BRAND_IMPACT',
          severity: 'WARNING',
          hard: false,
          date: d,
          employeeId: e.id,
          title: `${e.name}'s ${STATUS_LABEL[c.status].toLowerCase()} leaves ${brands.length} brands short on ${fmtDate(d)}`,
          detail: `${e.name} is the primary for ${brands.map((b) => ctx.brand.get(b)?.name).join(' and ')}. Uncovered: ${short.map((r) => reqLabel(ctx, r)).join(', ')}.`,
          suggestions: [],
        });
      }
    }
  }

  // ── Per-cell checks ──────────────────────────────────────────────────────
  const stretchedDays = new Map<ID, ISODate[]>();
  for (const e of ctx.emps) {
    for (const d of ctx.dates) {
      const c = cell(e.id, d);
      if (!c) continue;
      const u = fixedUnavailable(ctx, e.id, d);
      if (u && c.status === 'WORK') {
        add({
          type: 'ASSIGNED_WHILE_UNAVAILABLE',
          severity: 'ERROR',
          hard: true,
          date: d,
          employeeId: e.id,
          title: `${e.name} is rostered to work on ${fmtDate(d)} but is ${{ LEAVE: 'on leave', COMP_OFF: 'on comp-off', NA: 'not available' }[u.status as 'LEAVE'] ?? STATUS_LABEL[u.status].toLowerCase()}`,
          detail: `${u.note ?? 'Approved leave / availability says this person cannot work this day.'} Rostered: ${c.duties.map((x) => reqLabel(ctx, x.requirementId)).join(', ') || 'standby'}.`,
          suggestions: [
            { kind: 'CONFIG', text: 'Set this cell back to the leave status, or use Setup → Minimal repair to re-apply all leave and availability.' },
          ],
        });
      }
      if (c.status !== 'WORK' && c.duties.length) {
        add({
          type: 'ASSIGNED_WHILE_UNAVAILABLE',
          severity: 'ERROR',
          hard: true,
          date: d,
          employeeId: e.id,
          key: `INCONSISTENT|${e.id}|${d}`,
          title: `${e.name} has duties on ${fmtDate(d)} while marked ${STATUS_LABEL[c.status]}`,
          detail: 'A non-working day cannot carry duties. Edit the cell.',
          suggestions: [],
        });
      }
      if (c.duties.length > 1) {
        const ids = c.duties.map((x) => x.requirementId);
        const span = shiftSpan(ctx, ids);
        if (span > ctx.data.policy.maxDaySpanHours * 60) {
          add({
            type: 'SHIFT_CONFLICT',
            severity: 'ERROR',
            hard: true,
            date: d,
            employeeId: e.id,
            title: `${e.name} has incompatible shifts on ${fmtDate(d)}`,
            detail: `${c.duties
              .map((x) => {
                const s = ctx.shift.get(ctx.req.get(x.requirementId)!.shiftId);
                return `${reqLabel(ctx, x.requirementId)} (${s?.name} ${s?.start}–${s?.end})`;
              })
              .join(', ')} span ${(span / 60).toFixed(1)}h, above the ${ctx.data.policy.maxDaySpanHours}h limit.`,
            suggestions: [],
          });
        }
      }
      const l = load(ctx, c);
      if (l > e.maxLoad + 1e-9) {
        add({
          type: 'OVERLOAD',
          severity: 'ERROR',
          hard: true,
          date: d,
          employeeId: e.id,
          title: `${e.name} overloaded on ${fmtDate(d)} (${l.toFixed(1)} FTE)`,
          detail: `Duties add up to ${l.toFixed(2)} FTE; this person's cap is ${e.maxLoad}.`,
          suggestions: [],
        });
      } else if (l > 1 + 1e-9) {
        const arr = stretchedDays.get(e.id) ?? [];
        arr.push(d);
        stretchedDays.set(e.id, arr);
      }
      for (const du of c.duties) {
        const isP = (ctx.primariesOf.get(du.requirementId) ?? []).includes(e.id);
        const isB = (ctx.backupsOf.get(du.requirementId) ?? []).includes(e.id);
        if (!isP && !isB) {
          add({
            type: 'NOT_QUALIFIED',
            severity: 'WARNING',
            hard: false,
            date: d,
            employeeId: e.id,
            requirementId: du.requirementId,
            title: `${e.name} covers ${reqLabel(ctx, du.requirementId)} without being assigned to it`,
            detail:
              'Allowed as a manual decision, but this person is neither primary nor configured backup for this brand process. Confirm they have product knowledge, or add them as a backup.',
            suggestions: [],
          });
        }
        if ((ctx.required.get(du.requirementId)?.get(d) ?? 0) === 0) {
          add({
            type: 'DUTY_ON_CLOSED_DAY',
            severity: 'WARNING',
            hard: false,
            date: d,
            employeeId: e.id,
            requirementId: du.requirementId,
            title: `${reqLabel(ctx, du.requirementId)} is closed on ${fmtDate(d)}`,
            detail: `${e.name} is rostered on a process that does not operate this day (operating calendar / holiday).`,
            suggestions: [],
          });
        }
      }
    }
  }
  for (const [id, days] of stretchedDays) {
    add({
      type: 'STRETCHED',
      severity: 'INFO',
      hard: false,
      employeeId: id,
      title: `${empName(ctx, id)} is stretched above 1.0 FTE on ${days.length} ${plural(days.length, 'day')}`,
      detail: `Within their cap, but heavier than a normal day because of backup cover: ${days.map(fmtDate).join(', ')}.`,
      suggestions: [],
    });
  }

  // ── Weekly offs, consecutive days, preferences, comp-off ────────────────
  const empStats = new Map<ID, EmpStats>();
  for (const e of ctx.emps) {
    const row = cells[e.id] ?? {};
    const st: EmpStats = {
      work: 0,
      wo: 0,
      ph: 0,
      leave: 0,
      compOff: 0,
      na: 0,
      idle: 0,
      phWorked: 0,
      backupDays: 0,
      compOffBalance: 0,
      prefMet: 0,
      prefTotal: 0,
      weekendOffs: 0,
    };
    for (const d of ctx.dates) {
      const c = row[d];
      if (!c) continue;
      if (c.status === 'WORK') st.work++;
      if (c.status === 'WO') st.wo++;
      if (c.status === 'PH') st.ph++;
      if (c.status === 'LEAVE') st.leave++;
      if (c.status === 'COMP_OFF') st.compOff++;
      if (c.status === 'NA') st.na++;
      if (c.status === 'IDLE') st.idle++;
      if (c.status === 'WORK' && ctx.holidays.has(d)) st.phWorked++;
      if (c.duties.some((x) => x.backup)) st.backupDays++;
      if (c.status === 'WO') {
        const wd = weekday(d);
        if (wd === 0 || wd === 6) st.weekendOffs++;
        if (e.preferredOffDays.length) {
          st.prefTotal++;
          if (e.preferredOffDays.includes(wd)) st.prefMet++;
        }
      }
    }
    st.compOffBalance = e.compOffOpening + st.phWorked - st.compOff;
    empStats.set(e.id, st);

    for (const week of ctx.fullWeeks) {
      // Weeks straddling months count offs in the adjacent month's roster; days
      // of a month not rostered yet could still receive the off.
      let got = 0;
      let possible = 0;
      let unknown = 0;
      for (const d of week) {
        if (ctx.dateSet.has(d)) {
          const c = row[d];
          if (!c) continue;
          const onLeave = ctx.leaveOn.get(e.id)?.has(d);
          if (!onLeave) possible++;
          if (c.status === 'WO' || (c.status === 'NA' && !onLeave)) got++;
        } else {
          const a = ctx.adj[e.id]?.[d];
          if (!a) unknown++;
          else {
            if (a.status !== 'LEAVE' && a.status !== 'COMP_OFF') possible++;
            if (a.status === 'WO' || a.status === 'NA') got++;
          }
        }
      }
      const need = Math.min(e.offsPerWeek, possible + unknown);
      if (got + unknown < need) {
        const first = week.find((d) => ctx.dateSet.has(d))!;
        add({
          type: 'WEEKLY_OFF_SHORTFALL',
          severity: 'ERROR',
          hard: true,
          employeeId: e.id,
          date: first,
          title: `${e.name} gets ${got} of ${need} weekly ${plural(need, 'off')} in week of ${fmtDate(week[0])}`,
          detail: `Contract: ${e.offsPerWeek} weekly ${plural(e.offsPerWeek, 'off')} per Monday to Sunday week. Weekly offs are mandatory. If one is cancelled to protect coverage, give a comp-off.`,
          suggestions: [{ kind: 'CONFIG', text: "Set one of this week's days to Weekly off, or record an approved comp-off later." }],
        });
      }
    }

    let run: ISODate[] = [];
    let carry = ctx.prevTrail.get(e.id) ?? 0;
    const flush = () => {
      if (run.length + carry > ctx.data.policy.maxConsecutiveDays && run.length) {
        add({
          type: 'MAX_CONSECUTIVE',
          severity: 'WARNING',
          hard: false,
          employeeId: e.id,
          date: run[0],
          title: `${e.name} works ${run.length + carry} days in a row (${carry ? `${carry} from last month + ` : ''}${fmtDate(run[0])} – ${fmtDate(run[run.length - 1])})`,
          detail: `Policy limit is ${ctx.data.policy.maxConsecutiveDays} consecutive working days. With ${e.offsPerWeek} off per week, moving someone's off-day later in the week (or across a month boundary) stretches the run; fix by moving an off earlier or granting an extra off/comp-off.`,
          suggestions: [],
        });
      }
      run = [];
      carry = 0;
    };
    for (const d of ctx.dates) {
      if (row[d]?.status === 'WORK') run.push(d);
      else {
        flush();
        carry = 0;
      }
    }
    flush();

    if (st.compOffBalance < 0) {
      add({
        type: 'COMP_OFF_BALANCE',
        severity: 'WARNING',
        hard: false,
        employeeId: e.id,
        title: `${e.name} takes more comp-offs than earned`,
        detail: `Opening balance ${e.compOffOpening} + ${st.phWorked} ${plural(st.phWorked, 'holiday')} worked − ${st.compOff} taken = ${st.compOffBalance}.`,
        suggestions: [],
      });
    }
    if (st.prefTotal && st.prefMet < st.prefTotal) {
      add({
        type: 'PREFERENCE_NOT_MET',
        severity: 'INFO',
        hard: false,
        employeeId: e.id,
        title: `${e.name}: preferred off-day met ${st.prefMet}/${st.prefTotal} weeks`,
        detail: `Prefers ${e.preferredOffDays.map((w) => WEEKDAY_SHORT[w]).join('/')} off. Preferences yield to client coverage, holidays and leave of colleagues sharing the same backups.`,
        suggestions: [],
      });
    }
  }

  // ── Pending leave: what would approving it do? ───────────────────────────
  for (const lv of ctx.pendingLeaves) {
    const risky: string[] = [];
    const fine: string[] = [];
    for (const d of ctx.dates) {
      if (!inRange(d, lv.start, lv.end)) continue;
      const c = cell(lv.employeeId, d);
      if (!c || c.status !== 'WORK') continue;
      for (const du of c.duties) {
        const cov = coverage[du.requirementId][d];
        if (cov.staffed - 1 >= cov.required) continue;
        const sim = { ...cells, [lv.employeeId]: { ...cells[lv.employeeId], [d]: { status: 'LEAVE' as const, duties: [] } } };
        const who = candidates(ctx, sim, d, du.requirementId)[0];
        if (who) fine.push(`${fmtDate(d)} ${reqLabel(ctx, du.requirementId)} → ${empName(ctx, who)}`);
        else risky.push(`${fmtDate(d)} ${reqLabel(ctx, du.requirementId)}`);
      }
    }
    add({
      type: 'PENDING_LEAVE_RISK',
      severity: risky.length ? 'WARNING' : 'INFO',
      hard: false,
      employeeId: lv.employeeId,
      date: lv.start,
      key: `PENDING|${lv.id}`,
      title: `Pending leave: ${empName(ctx, lv.employeeId)} ${fmtDate(lv.start)}${lv.end !== lv.start ? ' – ' + fmtDate(lv.end) : ''}`,
      detail: risky.length
        ? `Approving would leave uncovered: ${risky.join('; ')}.${fine.length ? ' Coverable: ' + fine.join('; ') + '.' : ''}`
        : fine.length
          ? `Can be approved. Backups available: ${fine.join('; ')}.`
          : 'Can be approved with no coverage impact.',
      suggestions: [],
    });
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  let requiredUnits = 0;
  let coveredUnits = 0;
  const gapDays = new Set<ISODate>();
  for (const r of ctx.reqs)
    for (const d of ctx.dates) {
      const c = coverage[r.id][d];
      requiredUnits += c.required;
      coveredUnits += Math.min(c.required, c.staffed);
      if (c.staffed < c.required) gapDays.add(d);
    }
  const order = { ERROR: 0, WARNING: 1, INFO: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.date ?? '').localeCompare(b.date ?? '') || a.title.localeCompare(b.title));
  return {
    issues,
    coverage,
    empStats,
    summary: {
      errors: issues.filter((i) => i.severity === 'ERROR').length,
      warnings: issues.filter((i) => i.severity === 'WARNING').length,
      infos: issues.filter((i) => i.severity === 'INFO').length,
      requiredUnits,
      coveredUnits,
      gapUnits: requiredUnits - coveredUnits,
      coveragePct: requiredUnits ? (100 * coveredUnits) / requiredUnits : 100,
      gapDays,
    },
  };
}

export function computeCoverage(ctx: Ctx, cells: CellMap): CoverageMap {
  const cov: CoverageMap = {};
  for (const r of ctx.reqs) {
    cov[r.id] = {};
    for (const d of ctx.dates) cov[r.id][d] = { required: ctx.required.get(r.id)!.get(d) ?? 0, staffed: 0, primaries: [], backups: [] };
  }
  for (const e of ctx.emps) {
    const row = cells[e.id];
    if (!row) continue;
    for (const d of ctx.dates) {
      const c = row[d];
      if (!c || c.status !== 'WORK') continue;
      for (const du of c.duties) {
        const x = cov[du.requirementId]?.[d];
        if (!x) continue;
        x.staffed++;
        (du.backup ? x.backups : x.primaries).push(e.id);
      }
    }
  }
  return cov;
}

function explainGap(ctx: Ctx, cells: CellMap, reqId: ID, d: ISODate, need: number, have: number): string {
  const r = ctx.req.get(reqId)!;
  const parts: string[] = [`Needs ${need}, ${have} scheduled.`];
  const prim = ctx.primariesOf.get(reqId) ?? [];
  if (!prim.length) parts.push('No primary is assigned to this process.');
  else
    parts.push(
      'Primary: ' +
        prim
          .map((p) => {
            const c = cells[p]?.[d];
            return `${empName(ctx, p)}, ${c ? statusReason(ctx, p, d, c) : 'not in roster'}`;
          })
          .join('; ') +
        '.',
    );
  const backs = ctx.backupsOf.get(reqId) ?? [];
  if (!backs.length) parts.push('No backup is configured for this process.');
  else
    parts.push(
      'Backups: ' +
        backs
          .map((b) => {
            const c = cells[b]?.[d];
            const e = ctx.emp.get(b)!;
            if (!c) return `${empName(ctx, b)}, not in roster`;
            if (c.duties.some((x) => x.requirementId === reqId)) return `${e.name}, already covering`;
            if (c.locked) return `${e.name}, cell locked by manager`;
            if (c.status !== 'WORK' && c.status !== 'IDLE' && c.status !== 'PH') return `${e.name}, ${statusReason(ctx, b, d, c)}`;
            const ids = c.duties.map((x) => x.requirementId);
            if (!shiftCompatible(ctx, ids, reqId)) {
              const s = ctx.shift.get(r.shiftId);
              return `${e.name}, shift clash (already on ${ids.map((i) => reqLabel(ctx, i)).join(', ')}; this needs ${s?.name} ${s?.start}–${s?.end})`;
            }
            const nl = load(ctx, c) + r.effort;
            if (nl > e.maxLoad + 1e-9) return `${e.name}, load cap (${load(ctx, c).toFixed(1)} + ${r.effort} > ${e.maxLoad} FTE)`;
            return `${e.name}, free (not yet assigned)`;
          })
          .join('; ') +
        '.',
    );
  return parts.join(' ');
}

function statusReason(ctx: Ctx, empId: ID, d: ISODate, c: Cell): string {
  if (c.status === 'LEAVE' || c.status === 'COMP_OFF' || c.status === 'NA') {
    const lv = ctx.leaveOn.get(empId)?.get(d);
    if (lv) return `${lv.type === 'COMP_OFF' ? 'comp-off' : lv.type.toLowerCase() + ' leave'}${lv.note ? ` (${lv.note})` : ''}`;
    return STATUS_LABEL[c.status].toLowerCase();
  }
  if (c.status === 'WORK') return c.duties.length ? `working on ${c.duties.map((x) => reqLabel(ctx, x.requirementId)).join(', ')}` : 'working (standby)';
  return STATUS_LABEL[c.status].toLowerCase();
}

function suggestForGap(ctx: Ctx, cells: CellMap, coverage: CoverageMap, reqId: ID, d: ISODate): Suggestion[] {
  const out: Suggestion[] = [];
  const r = ctx.req.get(reqId)!;
  const podId = ctx.brand.get(r.brandId)?.podId;

  // 1. Configured backups / primaries who can still take it.
  for (const id of candidates(ctx, cells, d, reqId).slice(0, 3)) {
    const c = cells[id][d];
    const nl = load(ctx, c) + r.effort;
    out.push({
      kind: 'ASSIGN_BACKUP',
      text: `Assign ${empName(ctx, id)} (configured ${(ctx.primariesOf.get(reqId) ?? []).includes(id) ? 'primary' : 'backup'}; load → ${nl.toFixed(1)} FTE${c.status === 'PH' ? '; works the holiday and earns a comp-off' : ''})`,
      action: { type: 'ADD_DUTY', employeeId: id, date: d, requirementId: reqId },
    });
  }

  // 2. Move someone's weekly off to another day of the same week.
  const week = ctx.weeks.find((w) => w.includes(d)) ?? [];
  const pool = [...new Set([...(ctx.primariesOf.get(reqId) ?? []), ...(ctx.backupsOf.get(reqId) ?? [])])];
  let moves = 0;
  for (const id of pool) {
    const c = cells[id]?.[d];
    const e = ctx.emp.get(id);
    if (!e || !c || c.status !== 'WO' || c.locked) continue;
    // Would they be able to take this duty on d if they worked?
    const baseIds = (ctx.primaryReqsOf.get(id) ?? []).filter((x) => (ctx.required.get(x)!.get(d) ?? 0) > 0);
    const dutyIds = baseIds.includes(reqId) ? baseIds : [...baseIds, reqId];
    if (dutyIds.length > 1 && shiftSpan(ctx, dutyIds) > ctx.data.policy.maxDaySpanHours * 60) continue;
    const effort = dutyIds.reduce((s, x) => s + (ctx.req.get(x)?.effort ?? 0), 0);
    if (effort > e.maxLoad + 1e-9) continue;
    for (const t of week) {
      if (t === d) continue;
      const tc = cells[id]?.[t];
      if (!tc || tc.locked || (tc.status !== 'WORK' && tc.status !== 'IDLE')) continue;
      // Taking the off on t must not open a new gap there.
      const safe = tc.duties.every((du) => {
        const cov = coverage[du.requirementId][t];
        if (cov.staffed - 1 >= cov.required) return true;
        const sim = { ...cells, [id]: { ...cells[id], [t]: { status: 'WO' as const, duties: [] } } };
        return candidates(ctx, sim, t, du.requirementId).length > 0;
      });
      if (!safe) continue;
      out.push({
        kind: 'MOVE_WEEKLY_OFF',
        text: `Move ${e.name}'s weekly off from ${fmtDate(d)} to ${fmtDate(t)}${tc.duties.length ? ' (their cover that day can be filled by backup)' : ''}${e.preferredOffDays.includes(weekday(d)) ? ', which overrides their preferred day' : ''}`,
        action: { type: 'MOVE_OFF', employeeId: id, fromDate: d, toDate: t, requirementId: reqId },
      });
      if (++moves >= 3) break;
    }
    if (moves >= 3) break;
  }

  // 3. Cross-cover by someone who knows the same process in the same pod.
  let cross = 0;
  for (const e of ctx.emps) {
    if (pool.includes(e.id) || e.podId !== podId) continue;
    const knows = [...(ctx.primaryReqsOf.get(e.id) ?? []), ...(ctx.backupReqsOf.get(e.id) ?? [])].some((x) => ctx.req.get(x)?.processId === r.processId);
    if (!knows) continue;
    const c = cells[e.id]?.[d];
    if (!c || c.locked || (c.status !== 'WORK' && c.status !== 'IDLE' && c.status !== 'PH')) continue;
    const ids = c.duties.map((x) => x.requirementId);
    if (!shiftCompatible(ctx, ids, reqId)) continue;
    const nl = load(ctx, c) + r.effort;
    if (nl > e.maxLoad + 1e-9) continue;
    out.push({
      kind: 'ASSIGN_BACKUP',
      text: `Cross-cover with ${e.name} (knows ${ctx.process.get(r.processId)?.code} for another brand but isn't a configured backup here; load → ${nl.toFixed(1)} FTE)`,
      action: { type: 'ADD_DUTY', employeeId: e.id, date: d, requirementId: reqId },
    });
    if (++cross >= 2) break;
  }

  // 4. Leave review
  for (const p of ctx.primariesOf.get(reqId) ?? []) {
    const lv = ctx.leaveOn.get(p)?.get(d);
    if (lv && lv.type === 'PLANNED')
      out.push({
        kind: 'CANCEL_LEAVE_REVIEW',
        text: `Discuss moving ${empName(ctx, p)}'s planned leave (${fmtDate(lv.start)}${lv.end !== lv.start ? '–' + fmtDate(lv.end) : ''}). It was approved without cover.`,
      });
  }

  if (!out.some((s) => s.action))
    out.push({
      kind: 'CONFIG',
      text: `No automatic fix: every qualified person is off, on leave, on a clashing shift or at their load cap. Options: add a backup for ${reqLabel(ctx, reqId)} in Setup, approve overtime, or agree reduced coverage with the client.`,
    });
  return out;
}

export function diffIssues(before: Issue[], after: Issue[]): { added: Issue[]; resolved: Issue[] } {
  const b = new Set(before.map((i) => i.key));
  const a = new Set(after.map((i) => i.key));
  return { added: after.filter((i) => !b.has(i.key)), resolved: before.filter((i) => !a.has(i.key)) };
}
