# Approach note

## The problem, as I understood it

Most of the brands depend on one person. So every weekly off, public holiday and sick day can leave a client with nobody. The roster has to plan cover for each absence ahead of time. And when cover really isn't possible, it should say so and say why, not hand over a roster that only looks complete.

## Decision 1: keep the client's calendar and the people's calendar apart

I kept running into two different questions: when does a client need someone, and when can a person work? So they're separate in the data.

Each brand's type of work (support, abandoned carts, delivery problems, retention) is its own requirement, with its own days, shift, minimum staff and size. Each person has their own working days, weekly-off allowance and leave. The roster fits the two together, and wherever they don't fit, you get an issue that explains why. Whether a brand is "one person" isn't stored anywhere. The app works it out from who is assigned, so it stays right when the team changes.

## Decision 2: a planner that can explain itself

The main choice the planner makes is which day each person takes off in each Monday-to-Sunday week. First it builds a full roster in order: fixed leave, then each brand's own people, then a fair rotation for public holidays, then backups, picked by who's free, on a matching shift, not overloaded and due a turn. After that it keeps trying to move offs around, one person at a time and then two together, and keeps any change that makes things better. A client left uncovered costs far more than anything else, so it's always fixed first. Some rules are never traded away at all: leave, availability, shift clashes, workload limits and weekly offs.

The same checker runs after generation and after every manual edit. It gives each problem a plain reason and real options to fix it.

## Decision 3: after publishing, change as little as possible

Once a roster is published, people have made plans around it. So when someone reports a sick day, the tool only changes that person's days and fills the gaps from backups, and you see the effect on coverage before saving. Re-planning the rest of the month is there too, but only if the manager picks it. Any day a manager edits by hand gets locked, so the tool never overrides them.

## What must be fixed and what's only a preference

Must fix: a client without cover, someone working on leave or on a day they can't work, clashing shifts, too much work, and missing weekly offs. Warnings and info: too many days in a row, unfair holiday duty, preferred days off not given, backups stretched thin, pending leave that would cause a gap, and comp-off balances.

Publishing with must-fix issues still open means ticking a box saying you know, and that's recorded. Each pod lead also approves their pod's month first. The approval stores a fingerprint of that pod's roster, so any later change cancels it. Publishing without every pod approved needs a second tick.

## Where AI helps

"Explain with AI" sends the engine's own findings for one issue to Claude and asks for a short explanation and a suggestion a manager can act on. It only gets those facts and can't change the roster, so it can't contradict the rules.

## How it's built

React and TypeScript with Vite. The scheduling engine is plain TypeScript with its own tests, and generation runs in a Web Worker so the page doesn't freeze. Setup and rosters are stored in Postgres on Neon, through two small Vercel functions, so everyone sees the same data. Every save carries a version number. If someone else saved first, the old save is refused instead of quietly overwriting their work. A third function makes the AI call.

## Results on the sample data

The sample has 32 people, 20 brands and 50 brand processes. December generates in about 2 seconds and covers 99.6% of required shifts. The 5 it can't cover are left uncovered on purpose, and the app explains each one with options:

- Three at Kaya Threads over Christmas. Gaurav, its only agent, is on leave on the 24th, and Simran, the backup, is away from the 21st to the 26th.
- One at GlowVeda on 15 Dec. Kavya is on five days of leave and the only backup has that day off.
- One at Aqua Pure on 14 Dec. Ishaan, the primary, has a weekly off and the backup is already on a clashing shift.

January reaches 100%.

## With more time

A proper solver (CP-SAT) to prove when a gap really can't be filled, planning across month boundaries, logins and roles, real email or Slack notifications, skill levels, and minimum staffing based on expected ticket volume.

Mohak Malviya, [LinkedIn](https://www.linkedin.com/in/mohak-malviya-a6b89b225)
