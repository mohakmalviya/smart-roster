import { hasDatabase, loadAll, resetAll, saveDataset } from './_lib/db.js';
import { datasetProblem, fail, json, readBody, type DatasetBody } from './_lib/http.js';

// GET  /api/state           everything: setup tables, every month's roster, their versions
// PUT  /api/state           save the setup { data, baseVersion }  → { version } | 409
// POST /api/state?reset=1   put the sample company back and delete all rosters

export async function GET(): Promise<Response> {
  if (!hasDatabase()) return json(503, { error: 'DATABASE_URL is not set on the server' });
  try {
    return json(200, await loadAll());
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (!hasDatabase()) return json(503, { error: 'DATABASE_URL is not set on the server' });
  const body = await readBody<DatasetBody>(request);
  const problem = datasetProblem(body?.data);
  if (problem) return json(400, { error: problem });
  if (typeof body?.baseVersion !== 'number') return json(400, { error: 'baseVersion is required' });
  try {
    return json(200, { version: await saveDataset(body.data!, body.baseVersion) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!hasDatabase()) return json(503, { error: 'DATABASE_URL is not set on the server' });
  if (new URL(request.url).searchParams.get('reset') !== '1') return json(400, { error: 'unknown action' });
  try {
    return json(200, await resetAll());
  } catch (e) {
    return fail(e);
  }
}
