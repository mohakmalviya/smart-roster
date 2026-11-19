import { useEffect, useState, type ReactNode } from 'react';
import { applySuggestion } from '../engine/actions';
import { reqLabel, type Ctx } from '../engine/context';
import { WEEKDAY_LETTER } from '../engine/dates';
import type { Cell, ID, Issue, Severity } from '../engine/types';
import { useStore } from '../state';
import { IconClose } from './icons';

export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="row">
          <h3>{title}</h3>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        {children}
        {footer && <div className="row" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="row">
          <h3 style={{ flex: 1 }}>{title}</h3>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function useEscape(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && fn();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn]);
}

export function WeekdayPicker({ value, onChange }: { value: boolean[]; onChange: (v: boolean[]) => void }) {
  // Display Monday first
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <span className="wkpick">
      {order.map((i) => (
        <button
          key={i}
          type="button"
          className={value[i] ? 'on' : ''}
          title={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}
          onClick={() => onChange(value.map((v, j) => (j === i ? !v : v)))}
        >
          {WEEKDAY_LETTER[i]}
        </button>
      ))}
    </span>
  );
}

export function SevBadge({ s }: { s: Severity }) {
  const cls = s === 'ERROR' ? 'err' : s === 'WARNING' ? 'warn' : 'info';
  return <span className={`badge ${cls}`}>{s === 'ERROR' ? 'Must fix' : s === 'WARNING' ? 'Warning' : 'Info'}</span>;
}

export function ProcTag({ ctx, reqId }: { ctx: Ctx; reqId: ID }) {
  const r = ctx.req.get(reqId);
  const p = r ? ctx.process.get(r.processId) : undefined;
  return (
    <span className="proc" style={{ background: p?.color ?? '#888' }}>
      {p?.code ?? '?'}
    </span>
  );
}

/** Short text shown inside a roster grid cell. */
export function cellCode(ctx: Ctx, c: Cell | undefined, brandId?: ID): string {
  if (!c) return '';
  switch (c.status) {
    case 'WO':
      return 'WO';
    case 'PH':
      return 'PH';
    case 'LEAVE':
      return 'L';
    case 'COMP_OFF':
      return 'CO';
    case 'NA':
      return 'NA';
    case 'IDLE':
      return '–';
    case 'WORK': {
      if (!c.duties.length) return 'SB';
      if (brandId) {
        const own = c.duties.filter((d) => ctx.req.get(d.requirementId)?.brandId === brandId);
        if (own.length) return own.map((d) => ctx.process.get(ctx.req.get(d.requirementId)!.processId)?.code).join('/');
      }
      const brands = [...new Set(c.duties.map((d) => ctx.brand.get(ctx.req.get(d.requirementId)?.brandId ?? '')?.code ?? '?'))];
      return brands.length > 2 ? `${brands[0]}+${brands.length - 1}` : brands.join('+');
    }
  }
}

export function cellTitle(ctx: Ctx, name: string, date: string, c: Cell | undefined): string {
  if (!c) return '';
  const head = `${name}, ${date}`;
  if (c.status !== 'WORK') return `${head}\n${statusText(c)}${c.locked ? '\n(locked by manager)' : ''}`;
  if (!c.duties.length) return `${head}\nWorking (standby or lead duties)`;
  return `${head}\n${c.duties.map((d) => `${reqLabel(ctx, d.requirementId)}${d.backup ? ' (backup)' : ''}`).join('\n')}${c.locked ? '\n(locked by manager)' : ''}`;
}

export function statusText(c: Cell): string {
  return {
    WORK: 'Working',
    WO: 'Weekly off',
    PH: 'Public holiday off',
    LEAVE: 'On leave',
    COMP_OFF: 'Comp-off',
    NA: 'Not available',
    IDLE: 'No duty (their processes are closed)',
  }[c.status];
}

export function Legend() {
  return (
    <div className="legend">
      <span>
        <span className="sw">UK</span>working (brand)
      </span>
      <span>
        <span className="sw" style={{ background: 'var(--st-backup)', color: 'var(--accent)' }}>
          LUM
        </span>
        covering as backup
      </span>
      <span>
        <span className="sw" style={{ color: 'var(--faint)' }}>
          SB
        </span>
        standby (lead / floater)
      </span>
      <span>
        <span className="sw" style={{ background: 'var(--st-wo)' }}>
          WO
        </span>
        weekly off
      </span>
      <span>
        <span className="sw" style={{ background: 'var(--st-ph)', color: 'var(--st-ph-fg)' }}>
          PH
        </span>
        holiday off
      </span>
      <span>
        <span className="sw" style={{ background: 'var(--st-leave)', color: 'var(--st-leave-fg)' }}>
          L
        </span>
        leave
      </span>
      <span>
        <span className="sw" style={{ background: 'var(--st-co)', color: 'var(--st-co-fg)' }}>
          CO
        </span>
        comp-off
      </span>
      <span>
        <span className="sw" style={{ background: 'var(--st-na)' }}>
          NA
        </span>
        not available
      </span>
      <span>
        <span className="sw">–</span>no duty (closed)
      </span>
      <span>
        <span className="sw" style={{ boxShadow: 'inset 0 0 0 2px var(--err)' }} />
        has a problem
      </span>
      <span>🔒 manager-locked</span>
    </div>
  );
}

/** One validation issue with its explanation and one-click fixes. */
const SEV_WORD: Record<Severity, string> = { ERROR: 'Must fix', WARNING: 'Warning', INFO: 'Info' };

export function IssueCard({ issue, compact, showSeverity = true }: { issue: Issue; compact?: boolean; showSeverity?: boolean }) {
  const { data, roster, setRoster, notify, ctx } = useStore();
  const [ai, setAi] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const explain = async () => {
    setAiBusy(true);
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue: { title: issue.title, detail: issue.detail, suggestions: issue.suggestions.map((s) => s.text) }, context: aiContext(ctx, issue) }),
      });
      const j = await res.json().catch(() => ({}));
      setAi(res.ok && j.text ? j.text : `AI explanation unavailable (${j.error ?? res.status}). The explanation above is generated by the rules engine.`);
    } catch {
      setAi('AI explanation unavailable offline. The explanation above is generated by the rules engine.');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className={`issue ${issue.severity}`}>
      <div className="issue-head">
        {showSeverity && <span className={`sev ${issue.severity}`}>{SEV_WORD[issue.severity]}</span>}
        <span className="title">{issue.title}</span>
      </div>
      <div className="detail">{issue.detail}</div>
      {!compact && issue.suggestions.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {issue.suggestions.map((s, i) => (
            <div className="sugg" key={i}>
              <span className="t">{s.text}</span>
              {s.action && roster && (
                <button
                  className="btn sm primary"
                  onClick={() => {
                    setRoster(applySuggestion(data, roster, s.action!));
                    notify('Applied: ' + s.text);
                  }}
                >
                  Apply
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!compact && issue.severity !== 'INFO' && (
        <div className="row">
          <button className="btn sm" onClick={explain} disabled={aiBusy}>
            {aiBusy ? 'Asking Claude…' : 'Explain with AI'}
          </button>
        </div>
      )}
      {ai && (
        <div className="ai">
          <div className="ai-head">Claude's explanation</div>
          {ai}
        </div>
      )}
    </div>
  );
}

function aiContext(ctx: Ctx, issue: Issue): string {
  const lines: string[] = [];
  if (issue.requirementId) {
    const r = ctx.req.get(issue.requirementId);
    if (r) {
      lines.push(`Process: ${reqLabel(ctx, r.id)}; shift ${ctx.shift.get(r.shiftId)?.name}; calendar ${r.calendar.preset}; min staff ${r.minStaff}; effort ${r.effort} FTE.`);
      lines.push(`Primaries: ${(ctx.primariesOf.get(r.id) ?? []).map((id) => ctx.emp.get(id)?.name).join(', ') || 'none'}.`);
      lines.push(`Backups: ${(ctx.backupsOf.get(r.id) ?? []).map((id) => ctx.emp.get(id)?.name).join(', ') || 'none'}.`);
    }
  }
  if (issue.employeeId) {
    const e = ctx.emp.get(issue.employeeId);
    if (e) lines.push(`Employee: ${e.name}, role ${e.role}, ${e.offsPerWeek} weekly off(s), max load ${e.maxLoad} FTE.`);
  }
  lines.push(`Policy: max ${ctx.data.policy.maxConsecutiveDays} consecutive days; max ${ctx.data.policy.maxDaySpanHours}h day span.`);
  return lines.join('\n');
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty panel">{children}</div>;
}

export function downloadFile(name: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
