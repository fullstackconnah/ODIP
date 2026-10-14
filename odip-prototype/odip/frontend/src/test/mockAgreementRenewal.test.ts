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
})
