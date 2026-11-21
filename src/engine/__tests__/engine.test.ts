import { describe, expect, it } from 'vitest';
import { createSampleDataset, presetCalendar } from '../../data/seed';
import { applyAvailabilityChanges, generateRoster } from '../generate';
import { applySuggestion, setCell } from '../actions';
import { buildContext } from '../context';
import { validate } from '../validate';
import { approvalState, approvePod, withdrawApproval } from '../approval';
import type { Dataset } from '../types';

const data = createSampleDataset();
const dec = generateRoster(data, '2026-12');
const decCtx = buildContext(data, '2026-12');
const decVal = validate(decCtx, dec.roster.cells);
const jan = generateRoster(data, '2027-01', { prev: dec.roster.cells });
const janVal = validate(buildContext(data, '2027-01', { prev: dec.roster.cells }), jan.roster.cells);

const ofType = (v: ReturnType<typeof validate>, t: string) => v.issues.filter((i) => i.type === t);
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();

describe('sample dataset shape', () => {
  it('has >=30 employees, ~80% single-resource brands, shared and split processes', () => {
    expect(data.employees.length).toBeGreaterThanOrEqual(30);
    const peoplePerBrand = data.brands.map((b) => {
      const ids = new Set(data.requirements.filter((r) => r.brandId === b.id).flatMap((r) => decCtx.primariesOf.get(r.id) ?? []));
      return ids.size;
    });
    const single = peoplePerBrand.filter((n) => n === 1).length;
    expect(single / data.brands.length).toBe(0.8);
    expect(peoplePerBrand.every((n) => n >= 1 && n <= 3)).toBe(true);
    expect(data.requirements.some((r) => (decCtx.primariesOf.get(r.id) ?? []).length >= 2)).toBe(true);
  });
});

describe('generated roster: hard rules', () => {
  for (const [name, v] of [
    ['Dec', decVal],
    ['Jan', janVal],
  ] as const) {
    it(`${name}: never rosters anyone on leave, no shift clash, no overload, no closed-day duty`, () => {
      expect(ofType(v, 'ASSIGNED_WHILE_UNAVAILABLE')).toHaveLength(0);
      expect(ofType(v, 'SHIFT_CONFLICT')).toHaveLength(0);
      expect(ofType(v, 'OVERLOAD')).toHaveLength(0);
      expect(ofType(v, 'DUTY_ON_CLOSED_DAY')).toHaveLength(0);
      expect(ofType(v, 'NOT_QUALIFIED')).toHaveLength(0);
    });
    it(`${name}: everyone gets their weekly off entitlement`, () => {
      expect(ofType(v, 'WEEKLY_OFF_SHORTFALL')).toHaveLength(0);
    });
  }

  it('January (no seeded clashes) is fully covered', () => {
    expect(janVal.summary.gapUnits).toBe(0);
    expect(janVal.summary.coveragePct).toBe(100);
  });

  it('does not hide infeasible days: Kaya Threads on 24 Dec is flagged and explained', () => {
    const gaps = ofType(decVal, 'COVERAGE_GAP').filter((i) => i.requirementId === 'kt-cs' && i.date === '2026-12-24');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].detail).toMatch(/Gaurav Pillai, planned leave/);
    expect(gaps[0].detail).toMatch(/Simran Kaur, planned leave/);
    expect(gaps[0].suggestions.length).toBeGreaterThan(0);
  });

  it('respects operating calendars: Mon-Sat processes have nobody on Sundays', () => {
    for (const d of decCtx.dates.filter((x) => dow(x) === 0)) expect(decVal.coverage['spr-cs'][d].staffed).toBe(0);
  });

  it('public holiday: only the needed number of a shared process works (UrbanKicks CS on Christmas)', () => {
    const cov = decVal.coverage['uk-cs']['2026-12-25'];
    expect(cov.required).toBe(1);
    expect(cov.staffed).toBe(1);
    expect(decVal.coverage['uk-ndr']['2026-12-25'].staffed).toBe(0);
  });

  it('honours minimum staffing on specific days (UrbanKicks Monday = 2, PetPal sale day = 2)', () => {
    expect(decVal.coverage['uk-cs']['2026-12-07'].staffed).toBe(2);
    expect(decVal.coverage['pp-cs']['2026-12-12'].staffed).toBe(2);
  });

  it('single-resource 365-day brand: each weekly off is covered by a backup', () => {
    const offs = decCtx.dates.filter((d) => dec.roster.cells.arjun[d].status === 'WO');
    expect(offs.length).toBeGreaterThan(0);
    for (const d of offs) {
      expect(decVal.coverage['lum-cs'][d].staffed).toBe(1);
      expect(decVal.coverage['lum-cs'][d].backups.length).toBe(1);
    }
  });

  it('availability pattern: Ayesha never works Saturdays and Tara Pods is covered by backup', () => {
    for (const d of decCtx.dates.filter((x) => dow(x) === 6)) {
      expect(dec.roster.cells.ayesha[d].status).toBe('NA');
      expect(decVal.coverage['tp-cs'][d].staffed).toBe(1);
    }
  });

  it('a day-shift agent is never double-booked onto an evening-shift brand', () => {
    for (const d of decCtx.dates) {
      const ids = dec.roster.cells.tanvi[d].duties.map((x) => x.requirementId);
      expect(ids.includes('aqp-cs') && ids.some((x) => x.startsWith('vv-'))).toBe(false);
    }
  });
});

describe('changes after generation', () => {
  it('sick leave on a single-resource brand is repaired by a backup without regenerating', () => {
    const d = '2027-01-13';
    expect(jan.roster.cells.nikhil[d].status).toBe('WORK');
    const changed: Dataset = { ...data, leaves: [...data.leaves, { id: 't1', employeeId: 'nikhil', start: d, end: d, type: 'SICK', status: 'APPROVED' }] };
    const before = jan.roster.cells;
    const { roster, changes } = applyAvailabilityChanges(changed, jan.roster);
    expect(roster.cells.nikhil[d].status).toBe('LEAVE');
    expect(changes.some((c) => c.includes('Nikhil Verma'))).toBe(true);
    const v = validate(buildContext(changed, '2027-01'), roster.cells);
    expect(v.coverage['peb-cs'][d].staffed).toBe(1);
    // minimal change: nothing on other days moves
    let diff = 0;
    for (const e of Object.keys(before))
      for (const day of Object.keys(before[e])) if (day !== d && JSON.stringify(before[e][day]) !== JSON.stringify(roster.cells[e][day])) diff++;
    expect(diff).toBe(0);
  });

  it('one of three people on a brand unavailable: the others and backups keep coverage', () => {
    const d = '2027-01-12';
    const changed: Dataset = { ...data, leaves: [...data.leaves, { id: 't2', employeeId: 'sneha', start: d, end: d, type: 'SICK', status: 'APPROVED' }] };
    const { roster } = applyAvailabilityChanges(changed, jan.roster);
    const v = validate(buildContext(changed, '2027-01'), roster.cells);
    expect(v.coverage['uk-acc'][d].staffed).toBe(1);
    expect(v.coverage['uk-ndr'][d].staffed).toBe(1);
    expect(v.coverage['uk-cs'][d].staffed).toBeGreaterThanOrEqual(1);
  });

  it('manual edits are validated, suggestions fix them, and locked cells survive regeneration', () => {
    const d = '2027-01-12';
    const edited = setCell(jan.roster, 'arjun', d, { status: 'WO', duties: [] });
    const v = validate(buildContext(data, '2027-01'), edited.cells);
    expect(v.coverage['lum-cs'][d].staffed).toBe(0);
    const gap = v.issues.find((i) => i.type === 'COVERAGE_GAP' && i.requirementId === 'lum-cs' && i.date === d)!;
    expect(gap).toBeTruthy();
    const fix = gap.suggestions.find((s) => s.action)!;
    const fixed = applySuggestion(data, edited, fix.action!);
    const v2 = validate(buildContext(data, '2027-01'), fixed.cells);
    expect(v2.coverage['lum-cs'][d].staffed).toBe(1);

    const regen = generateRoster(data, '2027-01', { existing: fixed, prev: dec.roster.cells });
    expect(regen.roster.cells.arjun[d].status).toBe('WO');
    expect(regen.roster.cells.arjun[d].locked).toBe(true);
  });
});

describe('small hand-built scenarios', () => {
  function mini(): Dataset {
    return {
      version: 1,
      pods: [{ id: 'p', name: 'P', leadId: null }],
      processes: [{ id: 'CS', code: 'CS', name: 'CS', color: '#000' }],
      shifts: [{ id: 'GEN', name: 'General', start: '09:00', end: '18:00' }],
      brands: [{ id: 'b', name: 'Solo', code: 'SO', podId: 'p' }],
      requirements: [
        { id: 'b-cs', brandId: 'b', processId: 'CS', shiftId: 'GEN', calendar: presetCalendar('ALL_365'), minStaff: 1, weekdayMin: {}, dateMin: {}, effort: 1 },
      ],
      employees: [
        {
          id: 'a',
          name: 'Solo Agent',
          podId: 'p',
          role: 'AGENT',
          offsPerWeek: 1,
          availableWeekdays: [true, true, true, true, true, true, true],
          preferredOffDays: [],
          maxLoad: 1.5,
          compOffOpening: 0,
          active: true,
        },
      ],
      assignments: [{ id: 'x', employeeId: 'a', requirementId: 'b-cs', role: 'PRIMARY' }],
      holidays: [],
      leaves: [],
      policy: { maxConsecutiveDays: 6, maxDaySpanHours: 10 },
    };
  }

  it('365-day brand, one person, no backup: every weekly off becomes a flagged gap (never a skipped off)', () => {
    const ds = mini();
    const r = generateRoster(ds, '2027-02');
    const v = validate(buildContext(ds, '2027-02'), r.roster.cells);
    const wo = Object.values(r.roster.cells.a).filter((c) => c.status === 'WO').length;
    expect(wo).toBe(4); // Feb 2027 = exactly 4 Mon-Sun weeks
    expect(ofType(v, 'COVERAGE_GAP')).toHaveLength(4);
    expect(ofType(v, 'WEEKLY_OFF_SHORTFALL')).toHaveLength(0);
  });

  it('adding a backup closes the gaps, and preference decides the off-day', () => {
    const ds = mini();
    ds.employees.push({ ...ds.employees[0], id: 'b2', name: 'Backup', role: 'FLOATER' });
    ds.employees[0].preferredOffDays = [3];
    ds.assignments.push({ id: 'y', employeeId: 'b2', requirementId: 'b-cs', role: 'BACKUP' });
    const r = generateRoster(ds, '2027-02');
    const v = validate(buildContext(ds, '2027-02'), r.roster.cells);
    expect(v.summary.gapUnits).toBe(0);
    for (const [d, c] of Object.entries(r.roster.cells.a)) if (c.status === 'WO') expect(dow(d)).toBe(3);
  });
});

describe('pod lead approval', () => {
  it('holds until a cell in that pod changes, and only for that pod', () => {
    const [podA, podB] = data.pods;
    const lead = decCtx.emp.get(podA.leadId!)!;
    let r = approvePod(decCtx, dec.roster, podA.id, { id: lead.id, name: lead.name });
    r = approvePod(decCtx, r, podB.id, { id: podB.leadId, name: 'B lead' });
    expect(approvalState(decCtx, r, podA.id)).toBe('approved');
    expect(approvalState(decCtx, r, podB.id)).toBe('approved');
    const emp = decCtx.emps.find((e) => e.podId === podA.id && e.role === 'AGENT')!;
    const day = decCtx.dates[10];
    const cur = r.cells[emp.id][day];
    r = setCell(r, emp.id, day, cur.status === 'WO' ? { status: 'LEAVE', duties: [] } : { status: 'WO', duties: [] });
    expect(approvalState(decCtx, r, podA.id)).toBe('changed');
    expect(approvalState(decCtx, r, podB.id)).toBe('approved');
    expect(approvalState(decCtx, withdrawApproval(decCtx, r, podB.id), podB.id)).toBe('waiting');
  });
});
