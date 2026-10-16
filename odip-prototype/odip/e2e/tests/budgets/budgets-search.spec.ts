import { expect, Page } from '@playwright/test';
import { call, test } from '../../support/fixtures';
import { expectStatus, type ApiResult, type Session } from '../../support/api';
import { addDays, sydneyToday } from '../../support/dates';

// Budget phase 2b, spec item 3, Tests bullet: "mock-api, local-test and e2e: the endpoints and demo figures
// (one participant over, one forecast over, one with an NDIA rejection), the endpoints.md lines, and the e2e
// search."
//
// This spec is the e2e search: the Budgets list's participant search, in real Chromium, against the real
// candidate API and a real PostgreSQL database. Nothing is mocked and nothing is stubbed.
//
// WHAT IS ACTUALLY ASSERTED, and why each is the server's fact rather than the browser's:
//   BudgetsController.List          GET /api/v1/funding/budgets returns BudgetListDto for the tenant, already
//                                  risk-ordered by BudgetListService.Rank. The server is the authority for the
//                                  order AND the figures; the page filters what it was given and ranks nothing
//                                  (BudgetsPage.tsx: "It adds nothing up and ranks nothing").
//   BudgetsPage                     `found = rows.filter(row => matchesName(row.participantName))`, then the
//                                  status filter narrows THAT. So the search is applied FIRST and the counts
//                                  in each status tab are counts of the searched rows, not of the whole list.
//   budgetRows.ts                   the participant name is `row.participantName`, and the row's action is
//                                  `fundingTabPath(participantId)` = `/participants/{id}?tab=funding`.
//   BudgetRiskTable                 each row's participant cell is a Link whose accessible name is
//                                  "Open funding for {name}" and whose visible text is the participant's name.
//   SearchInput                     the search box's accessible name is its `label` prop: "Search participants".
//
// THE SEARCH IS PROVEN TO NARROW, NOT TO FILTER BY SOMETHING ELSE. Two participants are seeded with
// distinguishable names, so a search that matched nothing would
// empty the table, a search that matched everything would leave it alone, and a search that matched the wrong
// column would leave the wrong rows. Both directions are asserted: one name narrows to exactly that
// participant's rows, and a name that matches nothing takes the page to its own "No budgets match these
// filters" state with the way back offered.
//
// GUARDRAILS: the session is a real dev-login of a seeded coordinator (no credential is invented here), every
// row created is synthetic test data of this spec with a per-run token, and nothing is intercepted.

const API_PREFIX = '/api/v1';

/** Per-run tag: the seeded participant names must be unique per run, because the shared scratch database is
 *  never cleaned and a re-run must not find the previous run's rows under a search of the same name.
 *
 *  The tag is in the FIRST name and the last name both, so the rendered participant name is unique per run
 *  ("Pr2bAb12Cd Sisi BudgetSearch"). A run that is repeated, or two runs overlapping, therefore cannot make a
 *  later search match an earlier run's participant - which would otherwise make this spec's "the search
 *  narrows to exactly one participant" assertions fail for a reason that has nothing to do with the search. */
const runTag = Date.now().toString(36).slice(-4);

/** The two participants this spec seeds. Two, not one: a search is only proved by a NARROWING, and one
 *  participant could never distinguish "the search narrowed the list" from "the list was already this short". */
const SEEDED_PEOPLE = [
  { first: 'Sisi', last: `BudgetSearch${runTag}`, planAmount: 20000, tag: 'one' },
  { first: 'Dylan', last: `BudgetSearch${runTag}`, planAmount: 20000, tag: 'two' },
] as const;

/** The participant names as the app will render and match them, which is what the search compares against.
 *  `participantName` on the wire is the server's own joining of the participant's names. */
function expectedNames(): string[] {
  return SEEDED_PEOPLE.map(p => `${p.first} ${p.last}`);
}

/** One active, non-draft, NDIS-funded participant. Address is on the seeded tenant's own demo domain so no
 *  address confirmation is demanded; an NDIS number is carried so anything priced from the plan is not $0.
 *  A create never accepts an activation boolean (ParticipantsController.Create), so the real screen's
 *  activation step is done the same way the product does it. */
async function makeFundedParticipant(session: Session, person: (typeof SEEDED_PEOPLE)[number]): Promise<string> {
  const res: ApiResult = await expectStatus(
    'POST participant',
    201,
    await call(session, 'POST', '/participants', {
      firstName: person.first,
      lastName: person.last,
      dateOfBirth: '1990-05-14',
      email: `${person.first.toLowerCase()}.${runTag}@demo.odip.com.au`,
      phone: '0400000000',
      addressStreet: '1 Budget Street',
      addressSuburb: 'Newtown',
      addressState: 'NSW',
      addressPostcode: '2042',
      ndisNumber: `420${Math.floor(100000000 + Math.random() * 899999999)}`,
      planType: 1, // PlanManaged: an agency-managed plan can hold pools the provider is paid from
      fundingSource: 0, // NDIS: without this the participant is never listed at all (BudgetListService)
      isDraft: false,
    }),
  );
  const id = res.data?.id as string | undefined;
  expect(typeof id === 'string' && id.length > 0, 'the created participant has an id').toBe(true);

  const activated: ApiResult = await expectStatus(
    'POST participant status',
    200,
    await call(session, 'POST', `/participants/${id}/status`, {
      isActive: true,
      reason: 'E2E browser acceptance: activate so the participant appears on the Budgets list',
    }),
  );
  expect(activated.data?.isActive, 'the participant is active before the list is opened').toBe(true);

  // One Core (flexible) pool (category 0, as FundingPlanValidator demands) with a single funding period that
  // runs the whole plan, so the period is current today and the participant has exactly one row.
  const from = addDays(sydneyToday(), -30);
  const to = addDays(sydneyToday(), 300);
  await expectStatus(
    'POST funding plan',
    201,
    await call(session, 'POST', `/participants/${id}/funding/plans`, {
      planStart: from,
      planEnd: to,
      reassessmentDate: addDays(sydneyToday(), 270),
      periodLengthMonths: 3,
      evidence: 0, // PlanCopy
      confirmedOn: sydneyToday(),
      confirmedByName: 'E2E Browser Acceptance',
      pools: [
        {
          kind: 0, // CoreFlexible: categories 01-04 are bought from one pool, so the category stays 0
          paceCategory: 0,
          managementType: 2, // PlanType.AgencyManaged
          periods: [{ periodStart: from, periodEnd: to, planAmount: person.planAmount, setAside: 0 }],
        },
      ],
    }),
  );

  return id as string;
}

type BudgetRow = { participantId: string; participantName: string; poolName: string; status: string };
/** The rows of a budget list response's `data` (the API wraps every body in `data`, as `call` unwraps it). */
function rowsIn(data: { rows?: unknown } | undefined): BudgetRow[] {
  return (data?.rows ?? []) as BudgetRow[];
}
/** The server's rows for this tenant, straight from the API: confirms the seed before the page is opened. */
async function serverRows(session: Session): Promise<BudgetRow[]> {
  const res: ApiResult = await expectStatus(
    'GET funding budgets',
    200,
    await call(session, 'GET', '/funding/budgets'),
  );
  return rowsIn(res.data);
}

/** The participant names of the rows currently drawn in the table, in the order they are drawn. Read from the
 *  Participant column's links (their accessible names carry the participant's name). */
async function visibleRowNames(page: Page): Promise<string[]> {
  const links = page.getByRole('link', { name: /^Open funding for / });
  const names: string[] = [];
  const count = await links.count();
  for (let i = 0; i < count; i += 1) {
    const label = await links.nth(i).getAttribute('aria-label');
    // "Open funding for {name}" -> the name the server sent, which is what the search matched.
    names.push((label ?? '').replace(/^Open funding for /, ''));
  }
  return names;
}

/** The Budgets page's own search box, by its accessible name ("Search participants", SearchInput's `label`). */
function searchBox(page: Page) {
  return page.getByRole('textbox', { name: 'Search participants' });
}

test.describe('Budget phase 2b: the Budgets list search', () => {
  test('the participant search narrows the risk-sorted list to the participant named, and a name that matches nothing says so', async ({
    page,
    session,
  }) => {
    // Seeds two participants and asserts the server sent them, so this is EVIDENCE work and it sets its own
    // budget. The config other specs share stays untouched.
    test.setTimeout(180_000);

    // ── Seed two funded participants, then confirm the SERVER put both on the list before opening it. ──
    for (const person of SEEDED_PEOPLE) await makeFundedParticipant(session, person);

    const wanted = expectedNames();
    const served = await serverRows(session);
    const servedNames = new Set(served.map(r => r.participantName));
    for (const name of wanted) {
      expect(
        servedNames.has(name),
        `the server lists "${name}" on the Budgets list before the page is opened`,
      ).toBe(true);
    }

    // ── Open the list unfiltered. The page's OWN list response is the reference: the shared tenant's list moves
    // while other specs run, so the snapshot above can differ from what this page loaded. ──
    const listResponse = page.waitForResponse(
      r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/v1/funding/budgets' && r.ok(),
    );
    await page.goto('/budgets');
    const pageRows = rowsIn((await (await listResponse).json())?.data);
    const pageNames = pageRows.map(r => r.participantName);
    expect(pageNames, 'the page\'s own list response holds both seeded participants').toEqual(
      expect.arrayContaining(wanted),
    );
    await expect(
      page.getByRole('heading', { name: 'Budgets', exact: true }),
      'the Budgets page is open',
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('table'), 'the budget risk table is rendered').toBeVisible({ timeout: 60_000 });

    await expect
      .poll(
        () => visibleRowNames(page),
        { message: 'both seeded participants are on the unfiltered list' },
      )
      .toEqual(expect.arrayContaining(wanted));
    expect(
      await visibleRowNames(page),
      'with no search typed, the page shows its own response\'s rows in the order it sent them',
    ).toEqual(pageNames);

    // ── The first seeded participant's row links to their Funding tab (budgetRows.ts fundingTabPath). ──
    const firstName = wanted[0];
    const firstRow = pageRows.find(r => r.participantName === firstName);
    expect(firstRow, 'the page sent a row for this participant, so its link target is known').toBeTruthy();
    await expect(
      page.getByRole('link', { name: `Open funding for ${firstName}` }),
      'the row for this participant links to their Funding tab',
    ).toHaveAttribute('href', `/participants/${firstRow!.participantId}?tab=funding`);

    // ── THE SEARCH, the case the spec names: type one participant's name. ──
    // The needle is the whole visible name as it is drawn, so a match can only come from the name column.
    await searchBox(page).fill(firstName);

    // Narrowed to exactly the seeded participant's rows, and to NOTHING else from this spec's own seed.
    await expect
      .poll(
        () => visibleRowNames(page),
        { message: 'the search narrows the list to the participant named and to no other seeded participant' },
      )
      .toEqual([firstName]);

    // The other seeded participant is gone as well (the exact-list check above already leaves no other row).
    await expect(
      page.getByRole('link', { name: `Open funding for ${wanted[1]}` }),
      'the other seeded participant is gone from the list while the search names the first',
    ).toHaveCount(0);

    // The All count is of the SEARCHED rows (BudgetsPage counts `found`, not `rows`), so it drops to this
    // participant's own row count. Only the All tab is checked. ToggleGroup is a role="radiogroup" of
    // role="radio", so it is addressed by its own role and group name.
    const allTab = page
      .getByRole('radiogroup', { name: 'Filter budgets by status' })
      .getByRole('radio', { name: /^All \(\d+\)$/ });
    await expect(
      allTab,
      'the All filter counts the searched rows, so its count is this participant\'s own row count',
    ).toHaveText('All (1)');
    await expect(
      allTab,
      'the All filter is the one selected while no status is chosen',
    ).toHaveAttribute('aria-checked', 'true');

    // ── The other name, from the SAME page, with no reload: the search is the page's, and it moves both ways. ──
    await searchBox(page).fill(wanted[1]);
    await expect
      .poll(
        () => visibleRowNames(page),
        { message: 'the search moves to the other participant, so it filters rather than fixing the list' },
      )
      .toEqual([wanted[1]]);

    // ── A name that matches nothing takes the page to its OWN state, with the way back offered. ──
    // This is the negative case the spec's "no fabricated zero balances" rule needs: a search matching nothing
    // must never be drawn as an empty table, which reads as "nobody is at risk".
    await searchBox(page).fill('Pr2bNoSuchParticipantZZZ');
    await expect(
      page.getByText('No budgets match these filters.'),
      'a search matching nothing says so, instead of drawing an empty risk-free table',
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Clear filters' }),
      'the page offers the way back from a search that matched nothing',
    ).toBeVisible();
    await expect(
      page.getByRole('table'),
      'no table is drawn for a search that matched nothing',
    ).toHaveCount(0);

    // The way back actually works: Clear filters restores the list.
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect
      .poll(
        () => visibleRowNames(page),
        { message: 'clearing the filters brings the server\'s rows back' },
      )
      .toEqual(pageNames);

    // ── The search is case-insensitive, because it is lowercased on both sides (BudgetsPage). ──
    await searchBox(page).fill(firstName.toUpperCase());
    await expect
      .poll(
        () => visibleRowNames(page),
        { message: 'the search matches the participant\'s name whatever its case' },
      )
      .toEqual([firstName]);
  });
});