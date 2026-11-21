import type { Dataset, Roster } from '../../src/engine/types';
import { VersionConflict } from './db.js';

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function readBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

const LIST_KEYS = ['pods', 'processes', 'shifts', 'brands', 'requirements', 'employees', 'assignments', 'holidays', 'leaves'] as const;

/** Shape check for a public endpoint: right collections, sane sizes. The database enforces the references. */
export function datasetProblem(d: unknown): string | null {
  if (!d || typeof d !== 'object') return 'data must be an object';
  const x = d as Record<string, unknown>;
  for (const k of LIST_KEYS) {
    if (!Array.isArray(x[k])) return `data.${k} must be a list`;
    if ((x[k] as unknown[]).length > 5000) return `data.${k} is too long`;
  }
  if (!x.policy || typeof x.policy !== 'object') return 'data.policy is required';
  return null;
}

export function rosterProblem(r: unknown): string | null {
  if (!r || typeof r !== 'object') return 'roster must be an object';
  const x = r as Partial<Roster>;
  if (typeof x.month !== 'string' || !/^\d{4}-\d{2}$/.test(x.month)) return 'roster.month must be yyyy-mm';
  if (!x.cells || typeof x.cells !== 'object') return 'roster.cells is required';
  if (x.status !== 'DRAFT' && x.status !== 'PUBLISHED') return 'roster.status must be DRAFT or PUBLISHED';
  return null;
}

/** Map database errors to a response the app can act on. */
export function fail(err: unknown): Response {
  if (err instanceof VersionConflict) return json(409, { error: 'Someone else saved a newer version. Reload to get it.' });
  const code = (err as { code?: string })?.code;
  // 23xxx: integrity constraint (missing pod, unknown process, bad role…)
  if (code && code.startsWith('23')) return json(400, { error: 'The change breaks a data rule: ' + String((err as Error).message) });
  console.error(err);
  return json(500, { error: 'Database error' });
}

export type DatasetBody = { data?: Dataset; baseVersion?: number };
export type RosterBody = { roster?: Roster; baseVersion?: number };
