// ─────────────────────────────────────────────────────────────────────────────
// Domain model
//
//   Pod 1──* Employee            (an employee belongs to one pod; a pod has a lead)
//   Pod 1──* Brand               (a brand is owned by one pod)
//   Brand 1──* Requirement       (a "requirement" = one process run for one brand,
//                                 with its own operating calendar, shift and staffing)
//   Requirement *──* Employee    via Assignment (role PRIMARY or BACKUP)
//
// The brand/process operating calendar (when the CLIENT needs coverage) is kept
// strictly separate from an employee's working pattern (when the PERSON works).
// The roster is the reconciliation of the two.
// ─────────────────────────────────────────────────────────────────────────────

export type ID = string;
/** ISO date, yyyy-mm-dd */
export type ISODate = string;
/** 0 = Sunday … 6 = Saturday (same as Date.getDay) */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Pod {
  id: ID;
  name: string;
  /** Employee id of the pod lead (the lead is also an employee in the roster). */
  leadId: ID | null;
}

export interface ProcessType {
  id: ID;
  /** Short code shown in the grid, e.g. CS, ACC, NDR */
  code: string;
  name: string;
  color: string;
}

export interface Shift {
  id: ID;
  name: string;
  /** "HH:MM" 24h */
  start: string;
  end: string;
}

export interface Brand {
  id: ID;
  name: string;
  /** 2–4 letter code used in compact grid cells */
  code: string;
  podId: ID;
}

export type CalendarPreset = 'ALL_365' | 'DAILY_NO_PH' | 'MON_SAT_NO_PH' | 'MON_FRI_NO_PH' | 'CUSTOM';

export interface OperatingCalendar {
  preset: CalendarPreset;
  /** index = weekday; true = operates on that weekday */
  weekdays: boolean[];
  /** operates on public holidays? */
  publicHolidays: boolean;
}

/** One process operated for one brand (e.g. "Brand X – Customer Support"). */
export interface Requirement {
  id: ID;
  brandId: ID;
  processId: ID;
  shiftId: ID;
  calendar: OperatingCalendar;
  /** Minimum people needed on a normal operating day. */
  minStaff: number;
  /** Optional per-weekday minimum (e.g. Monday peak = 2). Missing key = minStaff. */
  weekdayMin: Partial<Record<Weekday, number>>;
  /** Date-specific minimums (sale days etc). 0 = closed that day. */
  dateMin: Record<ISODate, number>;
  /**
   * Workload of one person covering this requirement for a day, in FTE.
   * Small brands' processes are fractions of a person so that one person can
   * run every process of a brand; a dedicated process is 1.0.
   */
  effort: number;
}

export interface Employee {
  id: ID;
  name: string;
  podId: ID;
  role: 'AGENT' | 'LEAD' | 'FLOATER';
  /** Weekly offs per Mon–Sun week (contract). */
  offsPerWeek: number;
  /** Weekdays the person can work at all (hard availability). */
  availableWeekdays: boolean[];
  /** Preferred weekly-off weekdays (soft). */
  preferredOffDays: Weekday[];
  /** Max FTE load that can be scheduled on one day (1.0 = normal; >1 = stretched). */
  maxLoad: number;
  /** Comp-off balance carried in from earlier months. */
  compOffOpening: number;
  active: boolean;
}

export interface Assignment {
  id: ID;
  employeeId: ID;
  requirementId: ID;
  /** PRIMARY works the requirement whenever available; BACKUP is used only to fill gaps. */
  role: 'PRIMARY' | 'BACKUP';
}

export interface Holiday {
  date: ISODate;
  name: string;
}

export type LeaveType = 'PLANNED' | 'SICK' | 'COMP_OFF' | 'UNAVAILABLE';
export interface Leave {
  id: ID;
  employeeId: ID;
  start: ISODate;
  end: ISODate;
  type: LeaveType;
  status: 'APPROVED' | 'PENDING';
  note?: string;
}

export interface Policy {
  /** Max consecutive working days before a warning. */
  maxConsecutiveDays: number;
  /** Max hours from earliest shift start to latest shift end for one person on one day. */
  maxDaySpanHours: number;
}

export interface Dataset {
  version: number;
  pods: Pod[];
  processes: ProcessType[];
  shifts: Shift[];
  brands: Brand[];
  requirements: Requirement[];
  employees: Employee[];
  assignments: Assignment[];
  holidays: Holiday[];
  leaves: Leave[];
  policy: Policy;
}

// ─────────────────────────────── Roster ─────────────────────────────────────

export type CellStatus =
  | 'WORK' // working (duties lists what)
  | 'WO' // weekly off
  | 'PH' // public-holiday off
  | 'LEAVE' // approved leave (planned/sick)
  | 'COMP_OFF' // comp-off taken
  | 'NA' // not available (availability pattern / unavailable record)
  | 'IDLE'; // available but nothing to cover (all their processes closed today)

export interface Duty {
  requirementId: ID;
  /** true if the person covers this as a backup (not a primary assignment). */
  backup: boolean;
}

export interface Cell {
  status: CellStatus;
  duties: Duty[];
  /** Set when the operations manager edited this cell; generator will keep it. */
  locked?: boolean;
  note?: string;
}

/** roster.cells[employeeId][isoDate] */
export type CellMap = Record<ID, Record<ISODate, Cell>>;

export interface Roster {
  month: string; // yyyy-mm
  cells: CellMap;
  generatedAt: string;
  status: 'DRAFT' | 'PUBLISHED';
  /** Snapshot of cells at the time of publishing, used to show changes after publish. */
  publishedCells?: CellMap;
  publishedAt?: string;
  /** Issue keys the manager explicitly acknowledged when publishing. */
  acknowledged?: string[];
  /** Short log of what the engine/manager did. */
  log: RosterLogEntry[];
}

export interface RosterLogEntry {
  at: string;
  text: string;
}

// ─────────────────────────────── Issues ─────────────────────────────────────

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export type IssueType =
  | 'COVERAGE_GAP'
  | 'NO_STAFF_CONFIGURED'
  | 'ASSIGNED_WHILE_UNAVAILABLE'
  | 'SHIFT_CONFLICT'
  | 'OVERLOAD'
  | 'NOT_QUALIFIED'
  | 'WEEKLY_OFF_SHORTFALL'
  | 'MAX_CONSECUTIVE'
  | 'MULTI_BRAND_IMPACT'
  | 'PENDING_LEAVE_RISK'
  | 'COMP_OFF_BALANCE'
  | 'PREFERENCE_NOT_MET'
  | 'DUTY_ON_CLOSED_DAY'
  | 'STRETCHED';

export interface Suggestion {
  kind: 'ASSIGN_BACKUP' | 'MOVE_WEEKLY_OFF' | 'CANCEL_LEAVE_REVIEW' | 'CONFIG';
  text: string;
  /** Machine-applicable fix, when there is one. */
  action?: SuggestedAction;
}

export type SuggestedAction =
  | { type: 'ADD_DUTY'; employeeId: ID; date: ISODate; requirementId: ID }
  | { type: 'MOVE_OFF'; employeeId: ID; fromDate: ISODate; toDate: ISODate; requirementId: ID };

export interface Issue {
  /** Stable key: same problem → same key across re-validation. */
  key: string;
  type: IssueType;
  severity: Severity;
  /** Hard constraint (must be fixed or acknowledged) vs preference. */
  hard: boolean;
  date?: ISODate;
  employeeId?: ID;
  requirementId?: ID;
  brandId?: ID;
  title: string;
  /** Plain-language explanation of WHY this happened. */
  detail: string;
  suggestions: Suggestion[];
}

/** Per requirement per date: required vs scheduled. */
export interface CoverageEntry {
  required: number;
  staffed: number;
  primaries: ID[];
  backups: ID[];
}
export type CoverageMap = Record<ID, Record<ISODate, CoverageEntry>>;
