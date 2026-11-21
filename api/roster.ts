import { deleteRoster, hasDatabase, saveRoster } from './_lib/db.js';
import { fail, json, readBody, rosterProblem, type RosterBody } from './_lib/http.js';

// PUT    /api/roster             save one month { roster, baseVersion }  → { version } | 409
// DELETE /api/roster?month=yyyy-mm

export async function PUT(request: Request): Promise<Response> {
  if (!hasDatabase()) return json(503, { error: 'DATABASE_URL is not set on the server' });
  const body = await readBody<RosterBody>(request);
  const problem = rosterProblem(body?.roster);
  if (problem) return json(400, { error: problem });
  if (typeof body?.baseVersion !== 'number') return json(400, { error: 'baseVersion is required' });
  try {
    return json(200, { version: await saveRoster(body.roster!, body.baseVersion) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!hasDatabase()) return json(503, { error: 'DATABASE_URL is not set on the server' });
  const month = new URL(request.url).searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month)) return json(400, { error: 'month must be yyyy-mm' });
  try {
    await deleteRoster(month);
    return json(200, { ok: true });
  } catch (e) {
    return fail(e);
  }
}
