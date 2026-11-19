import { useState } from 'react';
import type { IssueType, Severity } from '../engine/types';
import { useStore } from '../state';
import { Empty, IssueCard } from '../ui/common';

const TYPE_LABEL: Record<IssueType, string> = {
  COVERAGE_GAP: 'Coverage gap',
  NO_STAFF_CONFIGURED: 'No staff configured',
  ASSIGNED_WHILE_UNAVAILABLE: 'Scheduled while unavailable',
  SHIFT_CONFLICT: 'Shift clash',
  OVERLOAD: 'Overload',
  NOT_QUALIFIED: 'Not assigned to process',
  WEEKLY_OFF_SHORTFALL: 'Weekly off missing',
  MAX_CONSECUTIVE: 'Too many days in a row',
  MULTI_BRAND_IMPACT: 'Multi-brand impact',
  PENDING_LEAVE_RISK: 'Pending leave risk',
  COMP_OFF_BALANCE: 'Comp-off balance',
  PREFERENCE_NOT_MET: 'Preference not met',
  DUTY_ON_CLOSED_DAY: 'Duty on a closed day',
  STRETCHED: 'Stretched backup',
};

export function Issues() {
  const { validation, ctx, roster } = useStore();
  const [sev, setSev] = useState<Severity | 'ALL'>('ALL');
  const [type, setType] = useState<IssueType | 'ALL'>('ALL');
  const [pod, setPod] = useState('ALL');
  if (!roster || !validation) return <Empty>Generate a roster to see issues.</Empty>;

  const podOf = (i: (typeof validation.issues)[number]) => {
    if (i.brandId) return ctx.brand.get(i.brandId)?.podId;
    if (i.requirementId) return ctx.brand.get(ctx.req.get(i.requirementId)?.brandId ?? '')?.podId;
    if (i.employeeId) return ctx.emp.get(i.employeeId)?.podId;
    return undefined;
  };
  const list = validation.issues.filter((i) => (sev === 'ALL' || i.severity === sev) && (type === 'ALL' || i.type === type) && (pod === 'ALL' || podOf(i) === pod));
  const types = [...new Set(validation.issues.map((i) => i.type))];
  const s = validation.summary;
  const acked = new Set(roster.acknowledged ?? []);

  return (
    <div className="stack">
      <div className="row">
        <div className="seg">
          {(
            [
              ['ALL', `All (${validation.issues.length})`],
              ['ERROR', `Must fix (${s.errors})`],
              ['WARNING', `Warnings (${s.warnings})`],
              ['INFO', `Info (${s.infos})`],
            ] as [Severity | 'ALL', string][]
          ).map(([k, l]) => (
            <button key={k} className={sev === k ? 'active' : ''} onClick={() => setSev(k)}>
              {l}
            </button>
          ))}
        </div>
        <select value={type} onChange={(e) => setType(e.target.value as IssueType | 'ALL')}>
          <option value="ALL">Every type</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]} ({validation.issues.filter((i) => i.type === t).length})
            </option>
          ))}
        </select>
        <select value={pod} onChange={(e) => setPod(e.target.value)}>
          <option value="ALL">Every pod</option>
          {ctx.data.pods.map((p) => (
            <option key={p.id} value={p.id}>
              Pod {p.name}
            </option>
          ))}
        </select>
      </div>
      <p className="small muted">
        <b>Must fix</b> means a mandatory rule is broken (client cover, availability, leave, shift clash, weekly-off entitlement). <b>Warnings</b> and{' '}
        <b>info</b> cover preferences and fairness. The roster is still valid, but someone should look.
      </p>
      {list.length === 0 && <Empty>Nothing matches these filters. {s.errors === 0 && 'Every mandatory rule is met.'}</Empty>}
      {list.map((i) => (
        <div key={i.key} style={{ position: 'relative' }}>
          {acked.has(i.key) && (
            <span className="badge neutral" style={{ position: 'absolute', right: 10, top: 10 }}>
              acknowledged at publish
            </span>
          )}
          <IssueCard issue={i} />
        </div>
      ))}
    </div>
  );
}
