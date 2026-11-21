import { Pool, type PoolClient } from '@neondatabase/serverless';
import { createSampleDataset } from '../../src/data/seed.js';
import type { Dataset, Roster } from '../../src/engine/types';

// ─────────────────────────────────────────────────────────────────────────────
// Central database (Neon Postgres).
//
// One table per entity, mirroring the domain model in src/engine/types.ts:
//   pods ─< employees          brands ─< requirements ─< assignments >─ employees
//   process_types, shifts      holidays, leaves >─ employees      rosters (one per month)
//
// Rules that are naturally nested (a calendar, per-weekday minimums, a roster's
// cells) are stored as JSONB columns on their row instead of more join tables.
//
// Concurrency: workspace.version and rosters.version are optimistic locks.
// A save names the version it started from; if someone saved in between, the
// save is refused (409) and the client reloads the latest copy.
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version    bigint NOT NULL DEFAULT 1,
  policy     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pods (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  lead_id  text,
  position int NOT NULL
);
CREATE TABLE IF NOT EXISTS process_types (
  id       text PRIMARY KEY,
  code     text NOT NULL,
  name     text NOT NULL,
  color    text NOT NULL,
  position int NOT NULL
);
CREATE TABLE IF NOT EXISTS shifts (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  start_time text NOT NULL,
  end_time   text NOT NULL,
  position   int NOT NULL
);
CREATE TABLE IF NOT EXISTS brands (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  code     text NOT NULL,
  pod_id   text NOT NULL REFERENCES pods(id),
  position int NOT NULL
);
CREATE TABLE IF NOT EXISTS requirements (
  id          text PRIMARY KEY,
  brand_id    text NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  process_id  text NOT NULL REFERENCES process_types(id),
  shift_id    text NOT NULL REFERENCES shifts(id),
  calendar    jsonb NOT NULL,
  min_staff   int NOT NULL,
  weekday_min jsonb NOT NULL DEFAULT '{}',
  date_min    jsonb NOT NULL DEFAULT '{}',
  effort      numeric NOT NULL,
  position    int NOT NULL
);
CREATE TABLE IF NOT EXISTS employees (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  pod_id             text NOT NULL REFERENCES pods(id),
  role               text NOT NULL CHECK (role IN ('AGENT', 'LEAD', 'FLOATER')),
  offs_per_week      int NOT NULL,
  available_weekdays jsonb NOT NULL,
  preferred_off_days jsonb NOT NULL,
  max_load           numeric NOT NULL,
  comp_off_opening   numeric NOT NULL DEFAULT 0,
  active             boolean NOT NULL DEFAULT true,
  position           int NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  id             text PRIMARY KEY,
  employee_id    text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  requirement_id text NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('PRIMARY', 'BACKUP'))
);
CREATE TABLE IF NOT EXISTS holidays (
  date date PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS leaves (
  id          text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  type        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('APPROVED', 'PENDING')),
  note        text
);
CREATE TABLE IF NOT EXISTS rosters (
  month      text PRIMARY KEY,
  version    bigint NOT NULL DEFAULT 1,
  body       jsonb NOT NULL,
  status     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignments_requirement ON assignments(requirement_id);
CREATE INDEX IF NOT EXISTS assignments_employee ON assignments(employee_id);
CREATE INDEX IF NOT EXISTS leaves_employee ON leaves(employee_id);
`;

let pool: Pool | null = null;
let migrated = false;

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    if (!migrated) {
      await c.query(SCHEMA);
      migrated = true;
    }
    return await fn(c);
  } finally {
    c.release();
  }
}

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (c) => {
    await c.query('BEGIN');
    try {
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  });
}

export class VersionConflict extends Error {}

// ── Dataset ──────────────────────────────────────────────────────────────────

/** Replace every setup table with `data` in one transaction. */
async function writeDataset(c: PoolClient, data: Dataset) {
  await c.query('DELETE FROM assignments; DELETE FROM leaves; DELETE FROM requirements; DELETE FROM employees; DELETE FROM brands;');
  await c.query('DELETE FROM shifts; DELETE FROM process_types; DELETE FROM pods; DELETE FROM holidays;');
  const rows = <T>(xs: T[]) => JSON.stringify(xs.map((x, position) => ({ ...x, position })));
  await c.query(
    `INSERT INTO pods (id, name, lead_id, position)
     SELECT id, name, "leadId", position FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, "leadId" text, position int)`,
    [rows(data.pods)],
  );
  await c.query(
    `INSERT INTO process_types (id, code, name, color, position)
     SELECT id, code, name, color, position FROM jsonb_to_recordset($1::jsonb) AS x(id text, code text, name text, color text, position int)`,
    [rows(data.processes)],
  );
  await c.query(
    `INSERT INTO shifts (id, name, start_time, end_time, position)
     SELECT id, name, start, "end", position FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, start text, "end" text, position int)`,
    [rows(data.shifts)],
  );
  await c.query(
    `INSERT INTO brands (id, name, code, pod_id, position)
     SELECT id, name, code, "podId", position FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, code text, "podId" text, position int)`,
    [rows(data.brands)],
  );
  await c.query(
    `INSERT INTO requirements (id, brand_id, process_id, shift_id, calendar, min_staff, weekday_min, date_min, effort, position)
     SELECT id, "brandId", "processId", "shiftId", calendar, "minStaff", COALESCE("weekdayMin", '{}'), COALESCE("dateMin", '{}'), effort, position
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, "brandId" text, "processId" text, "shiftId" text, calendar jsonb, "minStaff" int,
       "weekdayMin" jsonb, "dateMin" jsonb, effort numeric, position int)`,
    [rows(data.requirements)],
  );
  await c.query(
    `INSERT INTO employees (id, name, pod_id, role, offs_per_week, available_weekdays, preferred_off_days, max_load, comp_off_opening, active, position)
     SELECT id, name, "podId", role, "offsPerWeek", "availableWeekdays", "preferredOffDays", "maxLoad", COALESCE("compOffOpening", 0), COALESCE(active, true), position
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, "podId" text, role text, "offsPerWeek" int, "availableWeekdays" jsonb,
       "preferredOffDays" jsonb, "maxLoad" numeric, "compOffOpening" numeric, active boolean, position int)`,
    [rows(data.employees)],
  );
  await c.query(
    `INSERT INTO assignments (id, employee_id, requirement_id, role)
     SELECT id, "employeeId", "requirementId", role FROM jsonb_to_recordset($1::jsonb) AS x(id text, "employeeId" text, "requirementId" text, role text)`,
    [JSON.stringify(data.assignments)],
  );
  await c.query(`INSERT INTO holidays (date, name) SELECT date, name FROM jsonb_to_recordset($1::jsonb) AS x(date date, name text)`, [
    JSON.stringify(data.holidays),
  ]);
  await c.query(
    `INSERT INTO leaves (id, employee_id, start_date, end_date, type, status, note)
     SELECT id, "employeeId", start, "end", type, status, note
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, "employeeId" text, start date, "end" date, type text, status text, note text)`,
    [JSON.stringify(data.leaves)],
  );
}

async function readDataset(c: PoolClient): Promise<{ data: Dataset; version: number } | null> {
  const ws = await c.query('SELECT version, policy FROM workspace WHERE id = 1');
  if (!ws.rows.length) return null;
  const q = (sql: string) => c.query(sql).then((r) => r.rows);
  const [pods, processes, shifts, brands, requirements, employees, assignments, holidays, leaves] = await Promise.all([
    q(`SELECT id, name, lead_id AS "leadId" FROM pods ORDER BY position`),
    q(`SELECT id, code, name, color FROM process_types ORDER BY position`),
    q(`SELECT id, name, start_time AS start, end_time AS "end" FROM shifts ORDER BY position`),
    q(`SELECT id, name, code, pod_id AS "podId" FROM brands ORDER BY position`),
    q(`SELECT id, brand_id AS "brandId", process_id AS "processId", shift_id AS "shiftId", calendar, min_staff AS "minStaff",
         weekday_min AS "weekdayMin", date_min AS "dateMin", effort::float8 AS effort FROM requirements ORDER BY position`),
    q(`SELECT id, name, pod_id AS "podId", role, offs_per_week AS "offsPerWeek", available_weekdays AS "availableWeekdays",
         preferred_off_days AS "preferredOffDays", max_load::float8 AS "maxLoad", comp_off_opening::float8 AS "compOffOpening", active
       FROM employees ORDER BY position`),
    q(`SELECT id, employee_id AS "employeeId", requirement_id AS "requirementId", role FROM assignments ORDER BY id`),
    q(`SELECT to_char(date, 'YYYY-MM-DD') AS date, name FROM holidays ORDER BY date`),
    q(`SELECT id, employee_id AS "employeeId", to_char(start_date, 'YYYY-MM-DD') AS start, to_char(end_date, 'YYYY-MM-DD') AS "end",
         type, status, note FROM leaves ORDER BY start_date, id`),
  ]);
  for (const l of leaves) if (l.note === null) delete l.note;
  const data = { version: 1, pods, processes, shifts, brands, requirements, employees, assignments, holidays, leaves, policy: ws.rows[0].policy } as Dataset;
  return { data, version: Number(ws.rows[0].version) };
}

export interface Snapshot {
  data: Dataset;
  version: number;
  rosters: Record<string, Roster>;
  rosterVersions: Record<string, number>;
}

async function readAll(c: PoolClient): Promise<Snapshot | null> {
  const ds = await readDataset(c);
  if (!ds) return null;
  const rs = await c.query('SELECT month, version, body FROM rosters ORDER BY month');
  const rosters: Record<string, Roster> = {};
  const rosterVersions: Record<string, number> = {};
  for (const r of rs.rows) {
    rosters[r.month] = r.body;
    rosterVersions[r.month] = Number(r.version);
  }
  return { ...ds, rosters, rosterVersions };
}

/** Everything the app needs. Seeds the sample company the first time. */
export async function loadAll(): Promise<Snapshot> {
  const existing = await withClient(readAll);
  if (existing) return existing;
  return resetAll();
}

/** Wipe rosters and put the sample company back. */
export async function resetAll(): Promise<Snapshot> {
  return tx(async (c) => {
    const data = createSampleDataset();
    await c.query('DELETE FROM rosters');
    await writeDataset(c, data);
    await c.query(
      `INSERT INTO workspace (id, version, policy, updated_at) VALUES (1, 1, $1, now())
       ON CONFLICT (id) DO UPDATE SET version = workspace.version + 1, policy = EXCLUDED.policy, updated_at = now()`,
      [JSON.stringify(data.policy)],
    );
    return (await readAll(c))!;
  });
}

/** Save the setup. Refused with VersionConflict if someone saved since `baseVersion`. */
export async function saveDataset(data: Dataset, baseVersion: number): Promise<number> {
  return tx(async (c) => {
    const lock = await c.query('SELECT version FROM workspace WHERE id = 1 FOR UPDATE');
    if (!lock.rows.length || Number(lock.rows[0].version) !== baseVersion) throw new VersionConflict();
    await writeDataset(c, data);
    const r = await c.query('UPDATE workspace SET version = version + 1, policy = $1, updated_at = now() WHERE id = 1 RETURNING version', [
      JSON.stringify(data.policy),
    ]);
    return Number(r.rows[0].version);
  });
}

/** Save one month's roster. `baseVersion` 0 means "new month". */
export async function saveRoster(roster: Roster, baseVersion: number): Promise<number> {
  return tx(async (c) => {
    const cur = await c.query('SELECT version FROM rosters WHERE month = $1 FOR UPDATE', [roster.month]);
    const have = cur.rows.length ? Number(cur.rows[0].version) : 0;
    if (have !== baseVersion) throw new VersionConflict();
    const r = await c.query(
      `INSERT INTO rosters (month, version, body, status, updated_at) VALUES ($1, 1, $2, $3, now())
       ON CONFLICT (month) DO UPDATE SET version = rosters.version + 1, body = EXCLUDED.body, status = EXCLUDED.status, updated_at = now()
       RETURNING version`,
      [roster.month, JSON.stringify(roster), roster.status],
    );
    return Number(r.rows[0].version);
  });
}

export async function deleteRoster(month: string): Promise<void> {
  await withClient((c) => c.query('DELETE FROM rosters WHERE month = $1', [month]));
}
