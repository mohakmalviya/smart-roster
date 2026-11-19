import { useMemo, useState } from 'react';
import { publishedDiff } from '../engine/actions';
import { buildContext, reqLabel } from '../engine/context';
import { fmtDate, shiftMonth } from '../engine/dates';
import { applyAvailabilityChanges, describe } from '../engine/generate';
import type { Dataset, ID, Leave, LeaveType } from '../engine/types';
import { diffIssues, validate } from '../engine/validate';
import { uid, useStore } from '../state';
import { Empty } from '../ui/common';

const LEAVE_LABEL: Record<LeaveType, string> = {
  SICK: 'Sick / emergency',
  PLANNED: 'Planned leave',
  UNAVAILABLE: 'Unavailable (other)',
  COMP_OFF: 'Comp-off',
};

export function Changes() {
  const { roster } = useStore();
  return (
    <div className="stack">
      {roster ? <ReportUnavailability /> : <Empty>Generate a roster first; then report changes here and the engine repairs it with the fewest possible edits.</Empty>}
      <PendingLeaves />
      {roster && <Notifications />}
      {roster && <ActivityLog />}
    </div>
  );
}

/** Builds the "what if" for a dataset change: minimal repair + issue diff, without saving. */
function usePreview(next: Dataset | null) {
  const { roster, state, month, validation } = useStore();
  return useMemo(() => {
    if (!next || !roster || !validation) return null;
    const res = applyAvailabilityChanges(next, roster);
    const ctx2 = buildContext(next, month, { prev: state.rosters[shiftMonth(month, -1)]?.cells, next: state.rosters[shiftMonth(month, 1)]?.cells });
    const v2 = validate(ctx2, res.roster.cells);
    return { res, v2, diff: diffIssues(validation.issues, v2.issues) };
  }, [next, roster, validation, state.rosters, month]);
}

function ReportUnavailability() {
  const { ctx, data, applyAvailability, generate, notify, busy } = useStore();
  const [emp, setEmp] = useState<ID>(ctx.emps[0]?.id ?? '');
  const [from, setFrom] = useState(ctx.dates[Math.min(12, ctx.dates.length - 1)]);
  const [to, setTo] = useState(ctx.dates[Math.min(12, ctx.dates.length - 1)]);
  const [type, setType] = useState<LeaveType>('SICK');
  const [draft, setDraft] = useState<Dataset | null>(null);
  const preview = usePreview(draft);
  const e = ctx.emp.get(emp);
  const reqs = ctx.primaryReqsOf.get(emp) ?? [];
  const brands = new Set(reqs.map((r) => ctx.req.get(r)!.brandId));
  const soleOwner = reqs.filter((r) => (ctx.primariesOf.get(r) ?? []).length === 1);

  const makeDraft = () => {
    if (to < from) return notify('The end date is before the start date.');
    const lv: Leave = { id: uid('lv'), employeeId: emp, start: from, end: to, type, status: 'APPROVED', note: 'Reported after generation' };
    setDraft({ ...data, leaves: [...data.leaves, lv] });
  };

  return (
    <div className="panel panel-pad stack">
      <div>
        <h3>Report a change after generation</h3>
        <p className="small muted">
          Someone is sick, has an emergency, or a comp-off was granted. The engine changes only the affected person-days and fills the resulting gaps from
          backups, so the rest of the published roster stays as people know it.
        </p>
      </div>
      <div className="row">
        <label className="field">
          Employee
          <select value={emp} onChange={(x) => (setEmp(x.target.value), setDraft(null))}>
            {ctx.emps.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <input type="date" value={from} min={ctx.dates[0]} max={ctx.dates[ctx.dates.length - 1]} onChange={(x) => (setFrom(x.target.value), setTo((t) => (t < x.target.value ? x.target.value : t)), setDraft(null))} />
        </label>
        <label className="field">
          To
          <input type="date" value={to} min={from} max={ctx.dates[ctx.dates.length - 1]} onChange={(x) => (setTo(x.target.value), setDraft(null))} />
        </label>
        <label className="field">
          Type
          <select value={type} onChange={(x) => (setType(x.target.value as LeaveType), setDraft(null))}>
            {(Object.keys(LEAVE_LABEL) as LeaveType[]).map((t) => (
              <option key={t} value={t}>
                {LEAVE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={makeDraft}>
          Preview impact
        </button>
      </div>
      {e && (
        <div className="small muted">
          {e.name} is primary on {reqs.length} process(es) across {brands.size} brand(s)
          {soleOwner.length > 0 && (
            <>
              {' '}
              , and the only person on {soleOwner.map((r) => reqLabel(ctx, r)).join(', ')}, so each of those days needs a backup.
            </>
          )}
          .
        </div>
      )}

      {preview && draft && (
        <div className="stack" style={{ gap: 8 }}>
          <h4>Proposed minimal repair ({preview.res.changes.length} edit(s))</h4>
          <div className="table-wrap" style={{ maxHeight: 260 }}>
            <table className="data small">
              <tbody>
                {preview.res.changes.length === 0 && (
                  <tr>
                    <td className="muted">No roster cells change (they were already off, or the days are locked).</td>
                  </tr>
                )}
                {preview.res.changes.map((c, i) => (
                  <tr key={i}>
                    <td style={c.startsWith('⚠') ? { color: 'var(--err)' } : {}}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row small">
            <span>
              Coverage after: <b>{preview.v2.summary.coveragePct.toFixed(1)}%</b> ({preview.v2.summary.gapUnits} uncovered shifts)
            </span>
            {preview.diff.added.filter((i) => i.severity === 'ERROR').length > 0 && (
              <span className="badge err">{preview.diff.added.filter((i) => i.severity === 'ERROR').length} new must-fix</span>
            )}
            {preview.diff.added.filter((i) => i.severity === 'WARNING').length > 0 && (
              <span className="badge warn">{preview.diff.added.filter((i) => i.severity === 'WARNING').length} new warnings</span>
            )}
            {preview.diff.resolved.length > 0 && <span className="badge ok">{preview.diff.resolved.length} resolved</span>}
          </div>
          {preview.diff.added
            .filter((i) => i.severity === 'ERROR')
            .slice(0, 5)
            .map((i) => (
              <div key={i.key} className="banner err small">
                <b>{i.title}.</b> {i.detail}
              </div>
            ))}
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                const ch = applyAvailability(draft);
                setDraft(null);
                notify(`Minimal repair applied: ${ch.length} edit(s).`);
              }}
            >
              Apply minimal repair
            </button>
            <button
              className="btn"
              disabled={!!busy}
              onClick={() => {
                const d = draft;
                setDraft(null);
                generate({ freezeBefore: from, data: d });
              }}
            >
              Re-optimise from {fmtDate(from)} instead
            </button>
            <button className="btn ghost" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
          <p className="small faint">
            Minimal repair keeps everyone else's days. Re-optimise also moves weekly offs from {fmtDate(from)} onwards, which can fix gaps a backup alone
            cannot, but changes more people's plans.
          </p>
        </div>
      )}
    </div>
  );
}

function PendingLeaves() {
  const { ctx, data, updateData, applyAvailability, roster, validation, notify } = useStore();
  const pending = data.leaves.filter((l) => l.status === 'PENDING');
  const [preview, setPreview] = useState<string | null>(null);
  const draft = useMemo(() => {
    if (!preview) return null;
    return { ...data, leaves: data.leaves.map((l) => (l.id === preview ? { ...l, status: 'APPROVED' as const } : l)) };
  }, [preview, data]);
  const p = usePreview(draft);

  return (
    <div className="panel panel-pad stack">
      <div>
        <h3>Leave approvals</h3>
        <p className="small muted">Pending requests are not in the roster yet. Preview shows what approving one would do to coverage before you decide.</p>
      </div>
      {pending.length === 0 && <div className="small muted">No pending requests.</div>}
      {pending.map((l) => {
        const e = ctx.emp.get(l.employeeId);
        const risk = validation?.issues.find((i) => i.type === 'PENDING_LEAVE_RISK' && i.key.includes(l.id));
        return (
          <div key={l.id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div className="row">
              <b>{e?.name ?? l.employeeId}</b>
              <span className="small">
                {LEAVE_LABEL[l.type]}, {fmtDate(l.start)}
                {l.end !== l.start && ` – ${fmtDate(l.end)}`}
              </span>
              {l.note && <span className="small faint">“{l.note}”</span>}
              {risk && <span className="badge warn">risk</span>}
              <div className="spacer" />
              {roster && (
                <button className="btn sm" onClick={() => setPreview(preview === l.id ? null : l.id)}>
                  {preview === l.id ? 'Hide preview' : 'Preview'}
                </button>
              )}
              <button
                className="btn sm primary"
                onClick={() => {
                  const next = { ...data, leaves: data.leaves.map((x) => (x.id === l.id ? { ...x, status: 'APPROVED' as const } : x)) };
                  if (roster) {
                    const ch = applyAvailability(next);
                    notify(`Approved. Roster repaired with ${ch.length} edit(s).`);
                  } else updateData(() => next, 'Approved.');
                  setPreview(null);
                }}
              >
                Approve
              </button>
              <button className="btn sm danger" onClick={() => updateData((d) => ({ ...d, leaves: d.leaves.filter((x) => x.id !== l.id) }), 'Request rejected.')}>
                Reject
              </button>
            </div>
            {risk && <div className="small muted">{risk.detail}</div>}
            {preview === l.id && p && (
              <div className="stack small" style={{ gap: 4 }}>
                {p.res.changes.map((c, i) => (
                  <div key={i} style={c.startsWith('⚠') ? { color: 'var(--err)' } : {}}>
                    {c}
                  </div>
                ))}
                <div>
                  Coverage after approval: <b>{p.v2.summary.coveragePct.toFixed(1)}%</b>
                  {p.diff.added.some((i) => i.severity === 'ERROR') ? '. This creates gaps that need a decision.' : '. No new gaps.'}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Notifications() {
  const { ctx, roster } = useStore();
  if (!roster) return null;
  if (roster.status !== 'PUBLISHED')
    return (
      <div className="panel panel-pad">
        <h3>Change notifications</h3>
        <p className="small muted">Publish the roster to start tracking changes. After that, every edit shows here as a notification for the person affected.</p>
      </div>
    );
  const diff = publishedDiff(roster);
  const byEmp = new Map<ID, typeof diff>();
  for (const d of diff) byEmp.set(d.empId, [...(byEmp.get(d.empId) ?? []), d]);
  return (
    <div className="panel panel-pad stack">
      <div>
        <h3>Change notifications</h3>
        <p className="small muted">
          Changes since publishing on {roster.publishedAt ? new Date(roster.publishedAt).toLocaleString() : 'an unknown date'}. In production these would be sent by email or chat;
          here they are drafted per person.
        </p>
      </div>
      {byEmp.size === 0 && <div className="small muted">No changes since publishing.</div>}
      {[...byEmp].map(([id, list]) => (
        <div key={id} className="issue INFO">
          <div className="title">
            To {ctx.emp.get(id)?.name}: your roster changed on {list.length} day(s)
          </div>
          <div className="detail">
            {list.map((d) => (
              <div key={d.date}>
                {fmtDate(d.date)}: {describe(ctx, d.before)} → <b>{describe(ctx, d.after)}</b>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityLog() {
  const { roster } = useStore();
  if (!roster) return null;
  return (
    <div className="panel panel-pad stack" style={{ gap: 6 }}>
      <h3>Activity log</h3>
      {[...roster.log].reverse().map((l, i) => (
        <div key={i} className="small row" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}>
          <span className="faint mono" style={{ whiteSpace: 'nowrap' }}>
            {new Date(l.at).toLocaleString()}
          </span>
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  );
}
