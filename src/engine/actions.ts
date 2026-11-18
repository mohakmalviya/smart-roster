import { baseWorkingCell, fillGaps } from './generate';
import { buildContext, cloneCells, reqLabel, empName } from './context';
import { fmtDate } from './dates';
import type { Cell, Dataset, ID, ISODate, Roster, SuggestedAction } from './types';

/** Manager edit of one cell. Edited cells are locked so regeneration keeps them. */
export function setCell(roster: Roster, empId: ID, date: ISODate, cell: Cell, note?: string): Roster {
  const cells = cloneCells(roster.cells);
  cells[empId] = { ...cells[empId], [date]: { ...cell, locked: true } };
  return { ...roster, cells, log: note ? [...roster.log, { at: new Date().toISOString(), text: note }] : roster.log };
}

export function unlockCell(roster: Roster, empId: ID, date: ISODate): Roster {
  const cells = cloneCells(roster.cells);
  const c = cells[empId]?.[date];
  if (c) delete c.locked;
  return { ...roster, cells };
}

/** Apply a machine-generated suggestion (from validation) to the roster. */
export function applySuggestion(data: Dataset, roster: Roster, a: SuggestedAction): Roster {
  const ctx = buildContext(data, roster.month);
  const cells = cloneCells(roster.cells);
  let text = '';
  if (a.type === 'ADD_DUTY') {
    const c = cells[a.employeeId][a.date];
    const isPrimary = (ctx.primariesOf.get(a.requirementId) ?? []).includes(a.employeeId);
    c.status = 'WORK';
    if (!c.duties.some((d) => d.requirementId === a.requirementId)) c.duties.push({ requirementId: a.requirementId, backup: !isPrimary });
    c.locked = true;
    text = `${empName(ctx, a.employeeId)} assigned to ${reqLabel(ctx, a.requirementId)} on ${fmtDate(a.date)}`;
  } else {
    const from = baseWorkingCell(ctx, a.employeeId, a.fromDate);
    if (!from.duties.some((d) => d.requirementId === a.requirementId)) {
      from.duties.push({ requirementId: a.requirementId, backup: !(ctx.primariesOf.get(a.requirementId) ?? []).includes(a.employeeId) });
    }
    from.status = 'WORK';
    cells[a.employeeId][a.fromDate] = { ...from, locked: true };
    cells[a.employeeId][a.toDate] = { status: 'WO', duties: [], locked: true };
    // The day they now take off may need backup cover.
    fillGaps(ctx, cells, a.toDate);
    text = `${empName(ctx, a.employeeId)}'s weekly off moved ${fmtDate(a.fromDate)} → ${fmtDate(a.toDate)}`;
  }
  return { ...roster, cells, log: [...roster.log, { at: new Date().toISOString(), text }] };
}

/** Cells that differ from the published snapshot. */
export function publishedDiff(roster: Roster): { empId: ID; date: ISODate; before: Cell; after: Cell }[] {
  if (!roster.publishedCells) return [];
  const out: { empId: ID; date: ISODate; before: Cell; after: Cell }[] = [];
  for (const [empId, row] of Object.entries(roster.cells)) {
    for (const [date, after] of Object.entries(row)) {
      const before = roster.publishedCells[empId]?.[date];
      if (!before) continue;
      const k = (c: Cell) => c.status + ':' + c.duties.map((d) => d.requirementId + (d.backup ? '*' : '')).sort().join(',');
      if (k(before) !== k(after)) out.push({ empId, date, before, after });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
