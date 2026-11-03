import { describe, it, expect } from 'vitest'
import { problemReportAppVersion, problemReportPagePath } from './problemReportPath'

describe('problemReportPagePath', () => {
  it('keeps a plain path', () => {
    expect(problemReportPagePath('/schedule')).toBe('/schedule')
    expect(problemReportPagePath('/')).toBe('/')
  })

  it('turns a GUID segment into :id and an all-digit segment into :n', () => {
    expect(problemReportPagePath('/participants/3f2a9c01-1111-4222-8333-444455556666/notes')).toBe('/participants/:id/notes')
    expect(problemReportPagePath('/claims/12345')).toBe('/claims/:n')
    expect(problemReportPagePath('/claims/12345a')).toBe('/claims/12345a')
  })

  it('is case-insensitive about the GUID', () => {
    expect(problemReportPagePath('/staff/3F2A9C01-1111-4222-8333-444455556666')).toBe('/staff/:id')
  })

  it('drops a query or hash if one is passed in', () => {
    expect(problemReportPagePath('/schedule?week=2026-11-02#top')).toBe('/schedule')
  })
})

describe('problemReportAppVersion', () => {
  it('joins the version and the first seven characters of a hex sha', () => {
    expect(problemReportAppVersion({ version: '1.4.2', buildSha: 'abcdef0123456789' })).toBe('1.4.2 (abcdef0)')
  })

  it('shows unknown while the version is 0.0.0 or missing', () => {
    expect(problemReportAppVersion({ version: '0.0.0', buildSha: undefined })).toBe('unknown')
    expect(problemReportAppVersion({ version: undefined, buildSha: undefined })).toBe('unknown')
  })

  it('drops a sha that is not hex', () => {
    expect(problemReportAppVersion({ version: '1.4.2', buildSha: 'dev-build' })).toBe('1.4.2')
    expect(problemReportAppVersion({ version: '1.4.2', buildSha: '' })).toBe('1.4.2')
  })
})
