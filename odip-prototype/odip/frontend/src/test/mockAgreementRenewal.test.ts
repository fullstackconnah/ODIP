import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock API held to the server on agreement PR 2, read from its source as mockPatternChange.test.ts reads it: the ending list in the alert's words, and Renew with the server's two 409s. The mock
 * is not in the frontend's Docker build context, so the suite skips itself there, and the file is read in the tests, never in the describe body.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = join(__dirname, '../../../mock-api/server.js')
const PRICING = join(__dirname, '../../../mock-api/planPricing.js')
const FUNDING = join(__dirname, '../../../mock-api/funding.js')

describe.skipIf(!existsSync(SERVER))('the mock answers agreement renewal as the server does', () => {
  it('lists the agreements ending in the alert\'s words, hiding one whose renewal waits until it has ended', () => {
    const source = readFileSync(SERVER, 'utf-8')

    expect(source).toContain("['service-agreements/ending', () => agreementsEnding()]")
    expect(source).toContain('if (daysLeft > 60) continue')
    expect(source).toContain('if (renewal && daysLeft >= 0) continue')
    expect(source).toContain('`Agreement ended ${approved.agreementEndDate}: shifts stop after it`')
    expect(source).toContain('`${words}. Renewal v${renewal.version} is waiting for approval`')
  })

  it('renews through the save, with plan-needed and draft-version-conflict in the server\'s words', () => {
    const source = readFileSync(SERVER, 'utf-8')

    expect(source).toContain("['participants/:id/service-agreement-drafts/:id/renew', (participantId, draftId) =>")
    expect(source).toContain("`Record the new plan first: no plan of the participant's covers ${start}, the day the renewal starts.`], 'plan-needed')")
    expect(source).toContain('`This agreement has a newer revision, v${newest.version}. Load it first: a renewal would replace it.`], \'draft-version-conflict\')')
    expect(source).toContain('funding.plansOf(participantId)')
    expect(source).toContain('return saveDraft(participantId, {')
  })
  // Fix round 1 (the finish review's recapture): the states the captures show need the mock to have a withdrawn item and the agreement alerts.
  it('withdraws one item from three weeks after today, so a renewal\u0027s review can show a line the new price list has not got', () => {
    const server = readFileSync(SERVER, 'utf-8')
    const pricing = readFileSync(PRICING, 'utf-8')

    expect(server).toContain("planPricing.withdraw('04_105_0136_6_1', planApproval.addDays(planApproval.providerToday(), 21))")
    expect(pricing).toContain('function withdraw(itemCode, from)')
    expect(pricing).toContain("addIssue(block.id, 'CatalogueNotFound', `The price list withdraws")
  })

  it('serves the agreement alerts with the budget ones, in the server\u0027s words and severities', () => {
    const server = readFileSync(SERVER, 'utf-8')
    const funding = readFileSync(FUNDING, 'utf-8')

    expect(server).toContain("type: row.daysLeft < 0 ? 'agreement-ended' : 'agreement-ending-soon', severity: row.daysLeft < 0 ? 'Critical' : 'Warning', message: row.status")
    expect(funding).toContain('alertsDto(p, ledgerOf(p.id), agreementAlertsOf(p.id))')
    expect(funding).toContain('alertsDto(person, ledgerOf(id), agreementAlertsOf(id))')
  })
  it('seeds an approved agreement that ended three days ago, since an approval refuses one already ended', () => {
    const server = readFileSync(SERVER, 'utf-8')

    expect(server).toContain("serviceAgreementDrafts['p-0001'] = [{ ...draftDto('p-0001', 1, ended, endedQuote, endedLines), approval: {")
    expect(server).toContain('agreementStartDate: planApproval.addDays(today, -59), agreementEndDate: planApproval.addDays(today, -3)')
  })
})
