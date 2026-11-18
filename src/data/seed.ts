import type {
  Assignment,
  Brand,
  CalendarPreset,
  Dataset,
  Employee,
  Holiday,
  Leave,
  OperatingCalendar,
  Pod,
  ProcessType,
  Requirement,
  Shift,
  Weekday,
} from '../engine/types';

// ─────────────────────────────────────────────────────────────────────────────
// Sample dataset — fictional company, 32 employees, 4 pods, 20 brands.
//
//  • 16 of 20 brands (80%) are single-resource: one person runs every process.
//    (Kabir runs two single-resource brands: Zesty Bites + Nimbu Fresh.)
//  • 4 brands have 2–3 people:
//      UrbanKicks  – 3 people; CS is SHARED by two (Mon needs 2), third runs ACC+NDR
//      GlowVeda    – 3 people; each runs a SEPARATE process
//      BrewHaus    – 2 people; split processes, cross-trained as each other's backup
//      PetPal      – 2 people SHARE CS (sale day needs 2), each also owns a side process
//  • Each pod has a lead and a floater who act as backups.
//  • Calendars differ by process: 365-day, daily-except-holidays, Mon–Sat, Mon–Fri.
//  • Two non-default shifts: Aqua Pure runs an evening shift, Orbit Gadgets a morning shift.
//  • December 2026 leaves are seeded to create both resolvable and unresolvable situations.
// ─────────────────────────────────────────────────────────────────────────────

export const CALENDAR_PRESETS: Record<Exclude<CalendarPreset, 'CUSTOM'>, { label: string; cal: OperatingCalendar }> = {
  ALL_365: {
    label: '365 days (incl. Sundays & public holidays)',
    cal: { preset: 'ALL_365', weekdays: [true, true, true, true, true, true, true], publicHolidays: true },
  },
  DAILY_NO_PH: {
    label: 'Every day, public holidays off',
    cal: { preset: 'DAILY_NO_PH', weekdays: [true, true, true, true, true, true, true], publicHolidays: false },
  },
  MON_SAT_NO_PH: {
    label: 'Mon–Sat, Sundays & public holidays off',
    cal: { preset: 'MON_SAT_NO_PH', weekdays: [false, true, true, true, true, true, true], publicHolidays: false },
  },
  MON_FRI_NO_PH: {
    label: 'Mon–Fri, weekends & public holidays off',
    cal: { preset: 'MON_FRI_NO_PH', weekdays: [false, true, true, true, true, true, false], publicHolidays: false },
  },
};

export function presetCalendar(p: Exclude<CalendarPreset, 'CUSTOM'>): OperatingCalendar {
  const c = CALENDAR_PRESETS[p].cal;
  return { ...c, weekdays: [...c.weekdays] };
}

const ALL_DAYS = [true, true, true, true, true, true, true];

const processes: ProcessType[] = [
  { id: 'CS', code: 'CS', name: 'Customer Support', color: '#2563eb' },
  { id: 'ACC', code: 'ACC', name: 'Abandoned Cart Conversion', color: '#d97706' },
  { id: 'NDR', code: 'NDR', name: 'Non-Delivery Report Mgmt', color: '#7c3aed' },
  { id: 'RET', code: 'RET', name: 'Retention', color: '#059669' },
];

const shifts: Shift[] = [
  { id: 'GEN', name: 'General', start: '09:30', end: '18:30' },
  { id: 'MOR', name: 'Morning', start: '07:00', end: '15:00' },
  { id: 'EVE', name: 'Evening', start: '14:00', end: '22:00' },
];

const pods: Pod[] = [
  { id: 'aurora', name: 'Aurora', leadId: 'priya' },
  { id: 'borealis', name: 'Borealis', leadId: 'rahul' },
  { id: 'cosmos', name: 'Cosmos', leadId: 'ananya' },
  { id: 'delta', name: 'Delta', leadId: 'karan' },
];

const brands: Brand[] = [
  // Aurora
  { id: 'uk', name: 'UrbanKicks', code: 'UK', podId: 'aurora' },
  { id: 'lum', name: 'Lumen Lamps', code: 'LUM', podId: 'aurora' },
  { id: 'coc', name: 'Cocoa Craft', code: 'COC', podId: 'aurora' },
  { id: 'peb', name: 'Pebble Wear', code: 'PEB', podId: 'aurora' },
  { id: 'tt', name: 'Tiny Toes', code: 'TT', podId: 'aurora' },
  // Borealis
  { id: 'gv', name: 'GlowVeda', code: 'GV', podId: 'borealis' },
  { id: 'vv', name: 'Velvet Vogue', code: 'VV', podId: 'borealis' },
  { id: 'spr', name: 'Spice Route', code: 'SPR', podId: 'borealis' },
  { id: 'aqp', name: 'Aqua Pure', code: 'AQP', podId: 'borealis' },
  // Cosmos
  { id: 'bh', name: 'BrewHaus', code: 'BH', podId: 'cosmos' },
  { id: 'zb', name: 'Zesty Bites', code: 'ZB', podId: 'cosmos' },
  { id: 'nf', name: 'Nimbu Fresh', code: 'NF', podId: 'cosmos' },
  { id: 'hc', name: 'Hearth & Co', code: 'HC', podId: 'cosmos' },
  { id: 'og', name: 'Orbit Gadgets', code: 'OG', podId: 'cosmos' },
  { id: 'tp', name: 'Tara Pods', code: 'TP', podId: 'cosmos' },
  // Delta
  { id: 'pp', name: 'PetPal', code: 'PP', podId: 'delta' },
  { id: 'kt', name: 'Kaya Threads', code: 'KT', podId: 'delta' },
  { id: 'mm', name: 'Mango Mile', code: 'MM', podId: 'delta' },
  { id: 'fp', name: 'Fern & Petal', code: 'FP', podId: 'delta' },
  { id: 'bf', name: 'Bolt Fitness', code: 'BF', podId: 'delta' },
];

type ReqSpec = [
  brandId: string,
  processId: string,
  preset: Exclude<CalendarPreset, 'CUSTOM'>,
  effort: number,
  opts?: { minStaff?: number; weekdayMin?: Partial<Record<Weekday, number>>; dateMin?: Record<string, number>; shiftId?: string },
];

const reqSpecs: ReqSpec[] = [
  // UrbanKicks — multi (shared CS)
  ['uk', 'CS', 'ALL_365', 1.0, { weekdayMin: { 1: 2 } }],
  ['uk', 'ACC', 'DAILY_NO_PH', 0.6],
  ['uk', 'NDR', 'MON_SAT_NO_PH', 0.4],
  ['lum', 'CS', 'ALL_365', 0.5],
  ['lum', 'ACC', 'DAILY_NO_PH', 0.3],
  ['lum', 'NDR', 'MON_SAT_NO_PH', 0.2],
  ['coc', 'CS', 'MON_SAT_NO_PH', 0.4],
  ['coc', 'RET', 'MON_FRI_NO_PH', 0.2],
  ['peb', 'CS', 'DAILY_NO_PH', 0.5],
  ['peb', 'ACC', 'DAILY_NO_PH', 0.3],
  ['peb', 'NDR', 'MON_SAT_NO_PH', 0.2],
  ['tt', 'CS', 'MON_SAT_NO_PH', 0.4],
  // GlowVeda — multi (separate processes)
  ['gv', 'CS', 'ALL_365', 1.0],
  ['gv', 'ACC', 'DAILY_NO_PH', 0.7],
  ['gv', 'NDR', 'MON_SAT_NO_PH', 0.4],
  ['gv', 'RET', 'MON_FRI_NO_PH', 0.3],
  ['vv', 'CS', 'ALL_365', 0.5],
  ['vv', 'ACC', 'DAILY_NO_PH', 0.3],
  ['vv', 'RET', 'MON_FRI_NO_PH', 0.2],
  ['spr', 'CS', 'MON_SAT_NO_PH', 0.6],
  ['spr', 'NDR', 'MON_SAT_NO_PH', 0.4],
  ['aqp', 'CS', 'DAILY_NO_PH', 0.6, { shiftId: 'EVE' }],
  ['aqp', 'ACC', 'DAILY_NO_PH', 0.4, { shiftId: 'EVE' }],
  // BrewHaus — multi (split processes)
  ['bh', 'CS', 'MON_SAT_NO_PH', 0.5],
  ['bh', 'RET', 'MON_SAT_NO_PH', 0.3],
  ['bh', 'ACC', 'DAILY_NO_PH', 0.5],
  ['bh', 'NDR', 'MON_SAT_NO_PH', 0.3],
  ['zb', 'CS', 'ALL_365', 0.5],
  ['zb', 'ACC', 'DAILY_NO_PH', 0.2],
  ['nf', 'CS', 'MON_SAT_NO_PH', 0.3],
  ['hc', 'CS', 'DAILY_NO_PH', 0.5],
  ['hc', 'NDR', 'MON_SAT_NO_PH', 0.3],
  ['hc', 'RET', 'MON_FRI_NO_PH', 0.2],
  ['og', 'CS', 'ALL_365', 0.6, { shiftId: 'MOR' }],
  ['og', 'ACC', 'DAILY_NO_PH', 0.4, { shiftId: 'MOR' }],
  ['tp', 'CS', 'MON_SAT_NO_PH', 0.6],
  ['tp', 'ACC', 'MON_SAT_NO_PH', 0.4],
  // PetPal — multi (shared CS, sale day on 12 Dec needs 2)
  ['pp', 'CS', 'ALL_365', 0.7, { dateMin: { '2026-12-12': 2 } }],
  ['pp', 'NDR', 'MON_SAT_NO_PH', 0.3],
  ['pp', 'RET', 'MON_FRI_NO_PH', 0.3],
  ['kt', 'CS', 'ALL_365', 0.6],
  ['kt', 'ACC', 'DAILY_NO_PH', 0.4],
  ['mm', 'CS', 'MON_SAT_NO_PH', 0.5],
  ['mm', 'ACC', 'MON_SAT_NO_PH', 0.3],
  ['mm', 'NDR', 'MON_SAT_NO_PH', 0.2],
  ['fp', 'CS', 'DAILY_NO_PH', 0.6],
  ['fp', 'RET', 'MON_FRI_NO_PH', 0.4],
  ['bf', 'CS', 'ALL_365', 0.5],
  ['bf', 'ACC', 'DAILY_NO_PH', 0.3],
  ['bf', 'NDR', 'MON_SAT_NO_PH', 0.2],
];

const requirements: Requirement[] = reqSpecs.map(([brandId, processId, preset, effort, o]) => ({
  id: `${brandId}-${processId.toLowerCase()}`,
  brandId,
  processId,
  shiftId: o?.shiftId ?? 'GEN',
  calendar: presetCalendar(preset),
  minStaff: o?.minStaff ?? 1,
  weekdayMin: o?.weekdayMin ?? {},
  dateMin: o?.dateMin ?? {},
  effort,
}));

type EmpSpec = [id: string, name: string, podId: string, role: Employee['role'], opts?: Partial<Employee>];

const empSpecs: EmpSpec[] = [
  // Aurora
  ['priya', 'Priya Nair', 'aurora', 'LEAD', { maxLoad: 0.6 }],
  ['vikram', 'Vikram Rao', 'aurora', 'FLOATER', { preferredOffDays: [3] }],
  ['aditi', 'Aditi Sharma', 'aurora', 'AGENT', { preferredOffDays: [0] }],
  ['rohan', 'Rohan Gupta', 'aurora', 'AGENT', { preferredOffDays: [6] }],
  ['sneha', 'Sneha Kulkarni', 'aurora', 'AGENT'],
  ['arjun', 'Arjun Desai', 'aurora', 'AGENT', { preferredOffDays: [0] }],
  ['meera', 'Meera Joshi', 'aurora', 'AGENT'],
  ['nikhil', 'Nikhil Verma', 'aurora', 'AGENT', { preferredOffDays: [2] }],
  // Borealis
  ['rahul', 'Rahul Mehta', 'borealis', 'LEAD', { maxLoad: 0.6 }],
  ['farah', 'Farah Khan', 'borealis', 'FLOATER'],
  ['kavya', 'Kavya Reddy', 'borealis', 'AGENT', { preferredOffDays: [0] }],
  ['siddharth', 'Siddharth Jain', 'borealis', 'AGENT'],
  ['pooja', 'Pooja Patil', 'borealis', 'AGENT'],
  ['tanvi', 'Tanvi Bhatt', 'borealis', 'AGENT', { preferredOffDays: [6] }],
  ['aman', 'Aman Choudhary', 'borealis', 'AGENT'],
  ['ishaan', 'Ishaan Kapoor', 'borealis', 'AGENT', { preferredOffDays: [1] }],
  // Cosmos
  ['ananya', 'Ananya Iyer', 'cosmos', 'LEAD', { maxLoad: 0.6 }],
  ['dev', 'Dev Malik', 'cosmos', 'FLOATER'],
  ['harsh', 'Harsh Vardhan', 'cosmos', 'AGENT', { compOffOpening: 1 }],
  ['riya', 'Riya Sen', 'cosmos', 'AGENT'],
  ['kabir', 'Kabir Anand', 'cosmos', 'AGENT', { preferredOffDays: [0] }],
  ['neha', 'Neha Bansal', 'cosmos', 'AGENT', { offsPerWeek: 2, preferredOffDays: [0, 6] }],
  ['yash', 'Yash Thakur', 'cosmos', 'AGENT'],
  // Ayesha is not available on Saturdays (hard availability), Tara Pods runs Mon–Sat → backup needed every Saturday
  ['ayesha', 'Ayesha Siddiqui', 'cosmos', 'AGENT', { availableWeekdays: [true, true, true, true, true, true, false] }],
  // Delta
  ['karan', 'Karan Malhotra', 'delta', 'LEAD', { maxLoad: 0.6 }],
  ['simran', 'Simran Kaur', 'delta', 'FLOATER'],
  ['zoya', 'Zoya Ali', 'delta', 'AGENT', { preferredOffDays: [5] }],
  ['manav', 'Manav Shetty', 'delta', 'AGENT'],
  ['gaurav', 'Gaurav Pillai', 'delta', 'AGENT', { preferredOffDays: [0], compOffOpening: 2 }],
  ['divya', 'Divya Menon', 'delta', 'AGENT'],
  ['lakshmi', 'Lakshmi Rao', 'delta', 'AGENT'],
  ['sameer', 'Sameer Khan', 'delta', 'AGENT', { preferredOffDays: [5] }],
];

const employees: Employee[] = empSpecs.map(([id, name, podId, role, o]) => ({
  id,
  name,
  podId,
  role,
  offsPerWeek: 1,
  availableWeekdays: [...ALL_DAYS],
  preferredOffDays: [],
  maxLoad: 1.5,
  compOffOpening: 0,
  active: true,
  ...o,
}));

const assignments: Assignment[] = [];
function P(emp: string, ...reqIds: string[]) {
  for (const r of reqIds) assignments.push({ id: `${emp}:${r}:P`, employeeId: emp, requirementId: r, role: 'PRIMARY' });
}
function B(emp: string, ...reqIds: string[]) {
  for (const r of reqIds) assignments.push({ id: `${emp}:${r}:B`, employeeId: emp, requirementId: r, role: 'BACKUP' });
}

// ── Aurora
P('aditi', 'uk-cs');
P('rohan', 'uk-cs');
P('sneha', 'uk-acc', 'uk-ndr');
B('rohan', 'uk-ndr');
P('arjun', 'lum-cs', 'lum-acc', 'lum-ndr');
P('meera', 'coc-cs', 'coc-ret', 'tt-cs'); // Meera runs two single-resource brands
P('nikhil', 'peb-cs', 'peb-acc', 'peb-ndr');
B('arjun', 'peb-cs');
B('vikram', 'coc-ret', 'uk-cs', 'uk-acc', 'uk-ndr', 'lum-cs', 'lum-acc', 'lum-ndr', 'coc-cs', 'tt-cs', 'peb-cs', 'peb-acc', 'peb-ndr');
B('priya', 'lum-cs', 'peb-cs', 'tt-cs');

// ── Borealis
P('kavya', 'gv-cs');
P('siddharth', 'gv-acc');
P('pooja', 'gv-ndr', 'gv-ret');
B('siddharth', 'gv-ndr');
B('pooja', 'gv-acc');
P('tanvi', 'vv-cs', 'vv-acc', 'vv-ret');
P('aman', 'spr-cs', 'spr-ndr');
P('ishaan', 'aqp-cs', 'aqp-acc');
B('tanvi', 'aqp-cs'); // shift-incompatible on days she works her own (GEN) brand — engine must notice
B('farah', 'gv-ret', 'vv-ret', 'gv-cs', 'gv-acc', 'gv-ndr', 'vv-cs', 'vv-acc', 'spr-cs', 'spr-ndr', 'aqp-cs', 'aqp-acc');
B('rahul', 'vv-cs', 'aqp-cs', 'spr-cs');

// ── Cosmos
P('harsh', 'bh-cs', 'bh-ret');
P('riya', 'bh-acc', 'bh-ndr');
B('riya', 'bh-cs', 'bh-ret');
B('harsh', 'bh-acc');
P('kabir', 'zb-cs', 'zb-acc', 'nf-cs'); // Kabir runs two single-resource brands
P('neha', 'hc-cs', 'hc-ndr', 'hc-ret');
P('yash', 'og-cs', 'og-acc');
P('ayesha', 'tp-cs', 'tp-acc');
B('dev', 'bh-ret', 'bh-ndr', 'hc-ret', 'bh-cs', 'bh-acc', 'zb-cs', 'zb-acc', 'nf-cs', 'hc-cs', 'hc-ndr', 'og-cs', 'og-acc', 'tp-cs', 'tp-acc');
B('ananya', 'zb-cs', 'og-cs', 'hc-cs', 'tp-cs');

// ── Delta
P('zoya', 'pp-cs', 'pp-ret');
P('manav', 'pp-cs', 'pp-ndr');
P('gaurav', 'kt-cs', 'kt-acc');
P('divya', 'mm-cs', 'mm-acc', 'mm-ndr');
P('lakshmi', 'fp-cs', 'fp-ret');
P('sameer', 'bf-cs', 'bf-acc', 'bf-ndr');
B('divya', 'bf-cs');
B('simran', 'pp-ret', 'mm-acc', 'mm-ndr', 'pp-cs', 'pp-ndr', 'kt-cs', 'kt-acc', 'mm-cs', 'fp-cs', 'fp-ret', 'bf-cs', 'bf-acc', 'bf-ndr');
B('karan', 'fp-cs', 'bf-cs', 'mm-cs');

const holidays: Holiday[] = [
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-04', name: 'Holi' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-09', name: 'Diwali (observed)' },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
  { date: '2026-12-25', name: 'Christmas' },
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-14', name: 'Makar Sankranti / Pongal' },
  { date: '2027-01-26', name: 'Republic Day' },
  { date: '2027-03-22', name: 'Holi' },
];

const leaves: Leave[] = [
  { id: 'lv1', employeeId: 'kabir', start: '2026-12-03', end: '2026-12-03', type: 'SICK', status: 'APPROVED', note: 'Runs two brands — both need cover' },
  { id: 'lv2', employeeId: 'harsh', start: '2026-12-05', end: '2026-12-05', type: 'COMP_OFF', status: 'APPROVED' },
  { id: 'lv3', employeeId: 'sneha', start: '2026-12-07', end: '2026-12-09', type: 'PLANNED', status: 'APPROVED' },
  { id: 'lv4', employeeId: 'yash', start: '2026-12-10', end: '2026-12-11', type: 'PLANNED', status: 'APPROVED', note: 'Morning-shift brand' },
  { id: 'lv5', employeeId: 'kavya', start: '2026-12-14', end: '2026-12-18', type: 'PLANNED', status: 'APPROVED' },
  { id: 'lv6', employeeId: 'simran', start: '2026-12-21', end: '2026-12-26', type: 'PLANNED', status: 'APPROVED', note: 'Delta floater away over Christmas' },
  { id: 'lv7', employeeId: 'gaurav', start: '2026-12-24', end: '2026-12-24', type: 'PLANNED', status: 'APPROVED' },
  { id: 'lv8', employeeId: 'tanvi', start: '2026-12-28', end: '2026-12-29', type: 'PLANNED', status: 'PENDING' },
  { id: 'lv9', employeeId: 'lakshmi', start: '2026-12-30', end: '2026-12-31', type: 'PLANNED', status: 'APPROVED' },
  { id: 'lv10', employeeId: 'rohan', start: '2027-01-04', end: '2027-01-06', type: 'PLANNED', status: 'APPROVED' },
  { id: 'lv11', employeeId: 'ishaan', start: '2027-01-18', end: '2027-01-20', type: 'PLANNED', status: 'APPROVED' },
];

export function createSampleDataset(): Dataset {
  return structuredClone({
    version: 1,
    pods,
    processes,
    shifts,
    brands,
    requirements,
    employees,
    assignments,
    holidays,
    leaves,
    policy: { maxConsecutiveDays: 6, maxDaySpanHours: 10 },
  });
}
