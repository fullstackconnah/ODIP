import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock API held to the server on agreement PR 1, read from its source as mockRosterBudget.test.ts reads the server's: an agreement pattern's timing edit is the 409 agreement-pattern with the
 * revision, POST .../pattern-change answers, the old day-clash 409 is gone, and approval removes the unfilled drafts but keeps one a coordinator wrote notes on. The mock is not in the frontend's Docker build
 * context, so the suite skips itself there, and the files are read in the tests, never in the describe body (which vitest runs even for a skipped suite).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = join(__dirname, '../../../mock-api/server.js')
const PLAN_APPROVAL = join(__dirname, '../../../mock-api/planApproval.js')

describe.skipIf(!existsSync(SERVER))('the mock answers agreement pattern changes as the server does', () => {
  it('refuses a timing edit of an agreement pattern with the 409 agreement-pattern naming the revision, and answers pattern-change', () => {
    const source = readFileSync(SERVER, 'utf-8')

    expect(source).toContain('failEnvelope({ draftId: pattern.sourceDraftId }')
    expect(source).toContain("'agreement-pattern'")
    expect(source).toContain("['participants/:id/service-agreement-drafts/:id/pattern-change', (participantId, draftId, body) =>")
    expect(source).not.toContain('This agreement already has a pattern for that block, day and worker')            // the old day-clash 409 is gone (D12)
  })

  it('removes the unfilled drafts on approval but keeps one with notes, lists the rest, and counts the changed patterns', () => {
    const source = readFileSync(PLAN_APPROVAL, 'utf-8')

    expect(source).toContain("const unfilled = (shift) => shift.status === 'Draft' && !shift.staffId && !shift.notes")
    expect(source).toContain('removed: standing.length - kept.length')
    expect(source).toContain('changedPatterns: planned.toEnd.length > 0 ? planned.newPatterns.length : 0')
  })
})
