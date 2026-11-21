export function Guide() {
  return (
    <div className="guide">
      <header className="guide-intro">
        <h2>How Smart Roster works</h2>
        <p>
          The tool separates two calendars that are easy to mix up: <b>when a client needs cover</b> (each brand process has its own operating days, shift and
          minimum staff) and <b>when a person works</b> (weekly offs, availability, leave, comp-offs). The roster fits the two together, and every place where
          they don’t fit is reported with the reason.
        </p>
      </header>

      <section className="panel guide-card">
        <h3>A 2-minute demo</h3>
        <ol>
          <li>
            Press <b>Generate roster</b> for December 2026. About two seconds later you get a full month for 32 people across 20 brands.
          </li>
          <li>
            <b>Overview</b> shows coverage per brand process per day. December has a few red cells on purpose: Kaya Threads runs 365 days, its only agent is on
            leave on 24 Dec and the Delta floater is away over Christmas.
          </li>
          <li>
            Open <b>Issues</b>. Each gap says who normally covers it, why each of them can’t, and what would fix it. Some fixes are one click (“Apply”).
          </li>
          <li>
            In <b>Roster → Brand</b>, pick a single-resource brand, click a cell and change it. The drawer shows what the change breaks or fixes before you
            apply it.
          </li>
          <li>
            <b>Publish</b>, then in <b>Changes</b> report that someone is sick for two days. Preview the minimal repair: only their days change, and a backup
            takes over. Apply it, and the notification for each affected person is drafted.
          </li>
          <li>
            In <b>Setup</b>, add a brand and a process, assign a primary and a backup, and regenerate.
          </li>
        </ol>
      </section>

      <section className="panel guide-card">
        <h3>Mandatory rules vs preferences</h3>
        <ul>
          <li>
            <b>Mandatory (Must fix):</b> each operating day of each brand process has at least its minimum staff; nobody works on approved leave, comp-off or
            unavailable days; nobody holds two clashing shifts; nobody goes over their maximum load; everyone gets their weekly-off entitlement in every Monday
            to Sunday week.
          </li>
          <li>
            <b>Preferences (Warning / Info):</b> preferred off-days, fair rotation of public holidays, spreading backup duty, max consecutive working days,
            pending leave risk, comp-off balance.
          </li>
        </ul>
        <p>The generator never trades a mandatory rule for a preference. When it can’t meet every rule, it leaves the gap in the roster and explains why.</p>
      </section>

      <section className="panel guide-card">
        <h3>How generation works</h3>
        <ol>
          <li>Fixed facts first: leave, comp-off, availability, and any cell a manager locked.</li>
          <li>
            The decision is <i>which days each person takes as weekly off</i> in each full Monday to Sunday week. Weeks that cross the month boundary use the
            neighbouring month’s roster, so nobody loses or doubles an off.
          </li>
          <li>
            For each day: primaries work their processes; on public holidays only as many primaries as the client needs work, chosen by fewest holidays worked.
          </li>
          <li>
            Remaining gaps are filled from configured backups, then from same-pod people. A backup must be free, on a compatible shift, and under their load
            cap.
          </li>
          <li>
            A local search moves offs (one person, then pairs of people in problem weeks) to cut a weighted cost: gaps ≫ consecutive-day runs &gt; holiday
            fairness &gt; idle days &gt; preferences.
          </li>
          <li>The result goes through the same validation as every manual edit.</li>
        </ol>
      </section>

      <section className="panel guide-card">
        <h3>Single-resource brands</h3>
        <p>
          About 80% of brands have one person. Their weekly off is itself a coverage gap whenever the brand operates that day, so the engine plans each off
          together with a named backup. If no backup can take it, it moves the off to a day the brand is closed or less loaded. When a single resource is
          suddenly unavailable, only their days change and the backup list is tried in order. If nobody qualifies, the gap is flagged with the options a manager
          has: cross-cover from the pod, move someone’s off, or review the leave.
        </p>
      </section>

      <section className="panel guide-card">
        <h3>Assumptions</h3>
        <ul>
          <li>Weeks run Monday to Sunday; weekly offs are counted per full week, including days in the neighbouring month.</li>
          <li>Working a public holiday earns one comp-off, which the employee view tracks as a balance.</li>
          <li>Pod leads carry a smaller load (0.6 FTE) so they have time to lead; floaters have no primary brand and exist to cover gaps.</li>
          <li>Data is stored in the browser (localStorage). The storage layer is one module and can be swapped for a server database.</li>
        </ul>
      </section>
    </div>
  );
}
