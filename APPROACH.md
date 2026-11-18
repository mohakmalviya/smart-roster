# Approach note

**Problem as I read it.** The hard part of this roster isn't filling a grid. It's that most brands depend on one person, so every weekly off, holiday and sick day is a potential client outage. The tool therefore has to be honest: it should plan cover for each absence in advance, and when cover is impossible it should say so and explain why, rather than quietly produce a roster that looks fine.

**Key decision 1: separate "when the client needs cover" from "when a person works".** Each brand process is its own requirement, with its own calendar, shift, staffing minimums and effort. Each person has their own availability, weekly-off contract and leave. The roster reconciles the two, and every place where they can't be reconciled becomes an explained issue. Single-resource brands aren't a special case in the data. They are derived (one primary), so they stay correct as the team changes.

**Key decision 2: an explainable optimiser, not a black box.** The decision variables are the weekly-off days in each full Mon–Sun week. A constructive pass builds a roster: fixed leave, then primaries, then a fair public-holiday rotation, then backups ranked by availability, shift compatibility, load and fairness. Local search then moves offs, singly and in pairs, to minimise a weighted cost in which a coverage gap outweighs everything else. Hard rules (leave, availability, shift clashes, load caps, weekly-off entitlement) are never traded away. One validator runs after generation and after every manual edit, and it attaches a plain-language reason and concrete fixes to each issue.

**Key decision 3: changes are repairs, not regenerations.** After publishing, people have planned around the roster. Reporting a sick day changes only the affected person-days and refills the gaps from backups; the preview shows the coverage impact first. Re-optimising the rest of the month is available, but only as an explicit choice. Manager edits are locked so the engine never overrides a person.

**Mandatory vs preference.** Must-fix covers client coverage, leave and availability, shift clashes, overload and the weekly-off entitlement. Warnings and info cover the consecutive-day limit, holiday fairness, preferred off-days, stretched backups, pending-leave risk and comp-off balance. Publishing with must-fix issues needs an explicit, recorded acknowledgement.

**AI where it helps.** "Explain with AI" sends the engine's own findings to Claude and asks for a short, manager-friendly explanation and recommendation. It's given only those facts and can't change the roster, so it can't contradict the rules engine.

**Stack.** React + TypeScript (Vite). The engine is plain TypeScript with unit tests, and generation runs in a Web Worker. Data is kept in browser storage behind one module. A Vercel function handles the AI call.

**Results on the sample data (32 people, 20 brands, 50 brand processes).** December generates in about 2 seconds with 99.6% coverage. Its 5 uncovered head-days are deliberately infeasible (a 365-day brand whose only agent and backup are both away at Christmas, and a 5-day leave with a single backup), and each is explained with options. January reaches 100% coverage.

**With more time:** an exact CP-SAT solver to prove infeasibility, planning across months with a rolling window, server storage with roles and real notifications, skill levels, and demand-driven staffing minimums.
