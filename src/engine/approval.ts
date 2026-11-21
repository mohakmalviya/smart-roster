import type { Ctx } from './context';
import type { CellMap, ID, Roster } from './types';

// Pod lead approval. A lead signs off on their pod's part of the month; the
// approval stores a hash of those cells, so any later edit, regeneration or
// availability change to someone in the pod voids it without extra bookkeeping.

export type ApprovalState = 'approved' | 'changed' | 'waiting';

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Everyone in the pod, every day of the month: status and duties. Notes and locks don't count. */
export function podFingerprint(ctx: Ctx, cells: CellMap, podId: ID): string {
  const parts: string[] = [];
  for (const e of ctx.emps) {
    if (e.podId !== podId) continue;
    for (const d of ctx.dates) {
      const c = cells[e.id]?.[d];
      parts.push(`${e.id}|${d}|${c ? c.status + ':' + c.duties.map((x) => x.requirementId + (x.backup ? '*' : '')).join(',') : '-'}`);
    }
  }
  return fnv1a(parts.join(';'));
}

export function approvalState(ctx: Ctx, roster: Roster, podId: ID): ApprovalState {
  const a = roster.approvals?.[podId];
  if (!a) return 'waiting';
  return a.fingerprint === podFingerprint(ctx, roster.cells, podId) ? 'approved' : 'changed';
}

/** The roster with the pod approved by its lead as it stands now. */
export function approvePod(ctx: Ctx, roster: Roster, podId: ID, lead: { id: ID | null; name: string }, at = new Date().toISOString()): Roster {
  const pod = ctx.data.pods.find((p) => p.id === podId);
  return {
    ...roster,
    approvals: { ...roster.approvals, [podId]: { by: lead.id, byName: lead.name, at, fingerprint: podFingerprint(ctx, roster.cells, podId) } },
    log: [...roster.log, { at, text: `${lead.name} approved pod ${pod?.name ?? podId}.` }],
  };
}

export function withdrawApproval(ctx: Ctx, roster: Roster, podId: ID, at = new Date().toISOString()): Roster {
  if (!roster.approvals?.[podId]) return roster;
  const { [podId]: gone, ...rest } = roster.approvals;
  const pod = ctx.data.pods.find((p) => p.id === podId);
  return { ...roster, approvals: rest, log: [...roster.log, { at, text: `${gone.byName} withdrew approval for pod ${pod?.name ?? podId}.` }] };
}
