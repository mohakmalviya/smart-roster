# Smart Roster

A browser-based roster manager for a brand-support operation: employees in pods, brands owned by pods, and several processes (customer support, accounts, NDR, returns) run for each brand on its own calendar. It generates a monthly roster, checks it against every rule, explains each conflict it cannot solve, and handles changes after the roster is published with the fewest possible edits.

**Live demo:** https://smart-roster-rosy.vercel.app · **Demo video:** _add link_ · **Approach note:** [APPROACH.md](APPROACH.md)

## What it does

| Requirement | Where |
|---|---|
| Central data for employees, brands, processes, pods, leads and allocations | Setup tab (all editable); sample data has 32 employees, 20 brands, 4 pods |
| ~80% single-resource brands; the rest with 2–3 people on separate or shared processes | Sample data: 16 of 20 brands are single-resource; UrbanKicks, GlowVeda, BrewHaus and PetPal are teams |
| Configurable working days per brand **and** per process | Each brand process has its own calendar: 365 days, daily with public holidays off, Mon–Sat, Mon–Fri, or custom weekdays; plus per-weekday and per-date minimum staffing |
| Availability, weekly offs, leave, comp-offs, public holidays | Employees (available weekdays, offs per week, preferred off-days), Holidays & leave |
| Monthly generation that explains conflicts instead of producing an invalid roster | **Generate roster**; anything it can't solve stays visible as a gap with the reason |
| Mandatory rules vs preferences | Issues are "Must fix" (mandatory) or Warning/Info (preferences); publishing with must-fix issues needs an explicit acknowledgement |
| Company, pod, brand, process and employee views | Roster tab lenses; Overview has a coverage heatmap and a "who is working" board per day |
| Manual edits with validation | Click any cell: the drawer shows what the change resolves and what it breaks *before* you apply it. Edited cells are locked and survive regeneration |
| Changes after generation | Changes tab: report sickness or unavailability → preview → minimal repair, or re-optimise the rest of the month |
| **Optional, done:** fair weekly offs and holiday rotation, preferences, backup recommendations, one-click fixes, re-optimise from a date, publish/approval, leave approval with risk preview, per-person change notifications, CSV export, JSON import/export, **AI conflict explanations**, **dynamic adding of brands/pods/processes/shifts** | |

## Run it locally

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173, then press **Generate roster**. Data is kept in the browser's localStorage; Setup → Data → *Reset to sample data* starts over.

Optional, for the "✨ Explain with AI" button:

```bash
cp .env.example .env
```

Then put your Anthropic API key in `.env`. Without a key everything else works, and the button says the AI explanation is unavailable. The engine's own explanation is always shown.

```bash
npm test
```

```bash
npm run build
```

### Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New → Project**, import the repo. The framework is detected as Vite; no build settings to change.
3. Under **Environment Variables** add `ANTHROPIC_API_KEY` (optional; only the AI button needs it).
4. Deploy. `api/explain.ts` becomes a serverless function at `/api/explain`.

## Architecture

```
src/
  engine/            pure TypeScript, no React; unit-tested
    types.ts         domain model
    context.ts       indexes the dataset for one month (who covers what, required staff per day)
    generate.ts      roster generator + minimal repair after changes
    validate.ts      every rule, coverage, per-employee stats, explanations and suggested fixes
    actions.ts       manual edit, lock, apply suggestion, diff against published version
  data/seed.ts       sample dataset
  state.tsx          app state + localStorage persistence (the only storage-aware module)
  worker.ts          generation runs in a Web Worker so the UI never freezes
  views/             Overview, Roster (5 lenses + cell editor), Issues, Changes, Setup, Guide
api/explain.ts       Vercel function: AI explanation of one issue (Claude API)
```

The engine is independent of the UI, so the same functions run in the browser, in the worker, in tests and could run on a server.

## Tell us how you think

### 1. How did you model the data?

Two calendars are kept strictly apart, because mixing them is where rostering tools go wrong:

- **When the client needs cover.** The unit is a *requirement*: one process run for one brand (e.g. "GlowVeda · NDR"). Each has its own operating calendar (weekdays + whether it runs on public holidays), shift, minimum staff, optional per-weekday and per-date minimums (a sale day needs 2, a closure is 0), and an *effort* in FTE. Effort lets one person run all three small processes of a brand (0.3 + 0.3 + 0.4) while a busy process takes a whole person.
- **When a person works.** An employee has a pod, a role (agent, lead, floater), weekly offs per week, the weekdays they can work at all, preferred off-days, a maximum daily load and a comp-off balance. Leave records (planned, sick, comp-off, unavailable; approved or pending) and public holidays sit on top.

The two are linked by **assignments**: an employee is PRIMARY or BACKUP on a requirement. A pod owns brands and has a lead who is also an employee. The roster itself is a grid of cells, `cells[employee][date] = { status, duties[] }`, where status is working, weekly off, holiday, leave, comp-off, not available or idle, and each duty says which requirement and whether it is backup cover. "Single-resource" is not a flag; it's derived (a brand with one primary), so it stays correct when Setup changes.

### 2. How does generation work, and how does it satisfy constraints?

It's a constraint-satisfaction problem solved by construction plus local search, which suits this size (30–60 people, one month) and keeps every step explainable:

1. **Fixed facts first:** approved leave, comp-offs, unavailability and any cell a manager locked.
2. **Decision variables:** which day(s) each person takes off in each full Monday–Sunday week. Weeks that cross a month boundary read the neighbouring month's roster, so nobody gets two offs or none at the turn of the month.
3. **Materialise each day:** primaries work their processes; closed processes leave people idle; on public holidays only as many primaries work as the client needs, picked by who has worked the fewest holidays (each one earns a comp-off).
4. **Fill gaps** from the process's configured backups (and its other primaries, e.g. one who had the holiday off). A backup must be free, on a compatible shift (the day's span ≤ 10 h by default) and under their load cap; same-pod people come first, then whoever has done the fewest backup days. People who know the process but aren't configured as its backup are never assigned automatically; they're offered as one-click suggestions.
5. **Local search** moves offs (single moves, then pairs of people in "problem weeks") to minimise a weighted cost: uncovered head-day 1000 ≫ over-long working run 300 > working on a holiday 8 > idle day 6 > missed preference 4 > using a backup 3. Because the gap weight dominates, a preference is never bought with a coverage gap, and the weekly-off entitlement is never traded away at all.
6. **Validate** the result with the same validator that runs after every manual edit.

December's sample generates in about 2 seconds (tens of thousands of candidate plans) with 99.6% coverage. The 5 uncovered head-days left are genuinely infeasible, and each is explained.

### 3. Single-resource brands vs multi-employee brands

For a **single-resource** brand, the person's weekly off *is* a coverage gap on any day the brand operates, so each off is planned together with who covers it. The search prefers to put the off on a day the brand is closed (Sunday for Mon–Sat brands). If the brand runs 365 days, it puts the off where a backup is free and on a compatible shift. Backups are spread so one floater isn't covering three brands on the same day.

For **multi-employee** brands, the team staggers its offs so the minimum staff is met each day, with peaks handled per weekday (UrbanKicks needs 2 on Mondays). On public holidays only the required number work, rotated fairly. Shared processes (two people on the same CS queue) and separate processes (one on CS, one on returns) are the same model: each requirement simply has its own list of primaries.

### 4. What happens when a single-resource employee is unavailable?

They report it in **Changes** (or the leave is approved). The engine does a **minimal repair**: only that person's affected days change, then each opened gap is filled from that process's configured backups in order (free, compatible shift, under load, same pod first, fewest backup days so far). The preview shows every edit and the coverage after, before anything is saved. If nobody qualifies, the gap stays as a must-fix issue that names each candidate and why they can't help, and offers the remaining options: a one-click cross-cover by someone who knows the process (shown with the load it would put on them), moving someone's weekly off, reviewing the leave, or agreeing reduced cover with the client. If the roster was published, each affected person gets a drafted change notification.

The alternative, **re-optimise from a date**, keeps everything before that date and any manager-locked cell, and re-plans offs from then on. It can fix gaps that one backup can't, at the cost of changing more people's plans. The manager picks; the default is the minimal repair.

### 5. How are conflicting requirements and insufficient staffing handled?

The generator never produces a roster that looks valid but isn't. Rules have a fixed precedence:

- **Hard rules, never broken by the engine:** approved leave and availability, one compatible shift per person, the load cap, the weekly-off entitlement.
- **The goal it optimises hardest:** client coverage.
- **Soft goals:** consecutive-day limit, holiday fairness, preferences.

When coverage still can't be met, the gap is left visible as a must-fix issue that explains *why* (e.g. "Primary: Gaurav, planned leave. Backup: Simran, planned leave") and what would fix it. Where the engine can see a fix that bends a soft rule (a stretched cross-cover, a moved off), it offers it as a one-click suggestion rather than applying it silently. Configuration problems, such as a process with no primary or a pending leave that would leave a brand uncovered, are flagged before they become gaps. Publishing with open must-fix issues requires an explicit acknowledgement, which is recorded.

### 6. What is automated and what is left to humans?

**Automated:** planning weekly offs, the holiday rotation and comp-off tracking, assigning backups, detecting every conflict with an explanation, suggesting fixes, repairing the roster after a change, drafting change notifications, and showing the coverage impact of any edit or leave request before it is applied.

**Left to people, deliberately:** anything that trades one person's or client's interest against another's. That means approving leave, accepting a stretched cross-cover or overtime, agreeing reduced cover with a client, and publishing. The tool makes the consequences visible and the action one click away, but doesn't take it. Manager edits are locked so the engine never undoes a human decision. The AI explanation only rewrites the engine's own findings; it can't change the roster.

### 7. What changes if the team doubles?

The generator's work grows roughly with people × weeks, and evaluation is incremental (only changed days are recomputed). Pair moves are already limited to the people involved in a problem week, so 60–70 people is still seconds in a Web Worker. Beyond that, the natural split is **by pod**: pods share few backups, so each pod can be solved independently (in parallel), with a final pass for cross-pod floaters. The bigger changes would be operational rather than algorithmic:

- Move storage from localStorage to a server database (Postgres): `state.tsx` is the only module that touches storage.
- Add authentication and roles, so pod leads edit their pod and ops managers publish.
- Add an audit trail per change and real notifications (email or Slack) in place of the drafted ones.

The data model doesn't change.

### 8. What would you improve with one more week?

- **An exact solver for the hard cases.** Hand the off-day decisions to a CP-SAT / ILP solver when local search leaves gaps, so the tool can *prove* a gap is infeasible rather than only failing to find a fix.
- **Plan across months.** January can't move December's last week today, so a few consecutive-day warnings remain at the turn of the month; I would solve with a rolling window.
- **Server persistence, login and roles,** plus real email or Slack notifications and an approval workflow per pod lead.
- **Skills and proficiency levels** instead of "knows this process or not", and shift preferences beyond off-days.
- **Demand-driven minimums,** from ticket volume forecasts per brand, instead of fixed numbers.
- **More tests**, especially property-based tests on random datasets (no hard rule ever broken), and end-to-end UI tests.

## Assumptions

- Weeks run Monday to Sunday; weekly-off entitlement is counted per full week.
- Working a public holiday earns one comp-off.
- Pod leads carry a reduced load (0.6 FTE) so they have time to lead; floaters have no brand of their own.
- One shift per process; a person may cover two processes on one day if the combined span is within the limit (10 h by default).
- Sample data covers December 2026 and January 2027 (holidays and leave are seeded for both). December contains deliberately unsolvable situations to show how conflicts are explained.
