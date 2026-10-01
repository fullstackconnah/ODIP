import { describe, it, expect } from 'vitest'
import {
  apiErrorStatus, apiErrorCode, apiErrorMessages, hasApiErrorCode, finishBlockersFromError, shiftDetailFromError,
  existingAdministrationFromError, isCompetencyError, isDoseTimeError,
} from './shiftPackageErrors'
import { SHIFT_PACKAGE_ERROR_CODES } from '@/api/types'
import type { AdministrationDto, PortalFinishBlockerDto, PortalShiftDetailDto } from '@/api/types'

function axiosError(status: number, body: unknown) {
  return { isAxiosError: true, response: { status, data: body } }
}

const blocker: PortalFinishBlockerDto = {
  code: 'DOSE_OUTCOME_MISSING',
  message: 'Levetiracetam 500mg at 12:30 has no outcome. Record it, or mark it not given with a reason.',
  medicationId: 'med-1',
  medicationName: 'Levetiracetam',
  scheduledAt: '2026-09-13T12:30:00',
}

describe('shiftPackageErrors', () => {
  it('reads the status, code and messages off the ApiResponse envelope', () => {
    const error = axiosError(409, { success: false, code: 'SHIFT_BREAK_ALREADY_RUNNING', errors: ['A break is already running.'], data: null })

    expect(apiErrorStatus(error)).toBe(409)
    expect(apiErrorCode(error)).toBe(SHIFT_PACKAGE_ERROR_CODES.breakAlreadyRunning)
    expect(apiErrorMessages(error)).toEqual(['A break is already running.'])
    expect(hasApiErrorCode(error, SHIFT_PACKAGE_ERROR_CODES.breakAlreadyRunning)).toBe(true)
    expect(hasApiErrorCode(error, SHIFT_PACKAGE_ERROR_CODES.breakOverlap)).toBe(false)
  })

  it('falls back to the top-level message when there are no errors, and tolerates a network failure (no response)', () => {
    expect(apiErrorMessages(axiosError(500, { message: 'Boom' }))).toEqual(['Boom'])
    expect(apiErrorMessages(new Error('Network Error'))).toEqual([])
    expect(apiErrorStatus(new Error('Network Error'))).toBeUndefined()
    expect(apiErrorCode(undefined)).toBeUndefined()
  })

  it('reads the framework ValidationProblemDetails too: errors is an OBJECT keyed by field, and there is no success or code', () => {
    // A handover note over 2000 characters is rejected by the framework before the action runs (what the real server sends, minus the traceId).
    const tooLong = axiosError(400, {
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1', title: 'One or more validation errors occurred.', status: 400,
      errors: { HandoverText: ['The field HandoverText must be a string with a maximum length of 2000.'] },
      traceId: '00-4f2c9d0b7a1e-8c3b2a1d-00',
    })

    expect(apiErrorMessages(tooLong)).toEqual(['The field HandoverText must be a string with a maximum length of 2000.'])
    expect(apiErrorStatus(tooLong)).toBe(400)
    expect(apiErrorCode(tooLong)).toBeUndefined()
  })

  it('flattens every field of a ValidationProblemDetails, keeps the order, and ignores empty or non-text entries', () => {
    const body = {
      errors: {
        HandoverText: ['too long', 'also wrong'],
        'request.Note': 'a lone string rather than a list',
        Empty: [],
        Odd: [42, '', null, 'kept'],
      },
    }

    expect(apiErrorMessages(axiosError(400, body))).toEqual(['too long', 'also wrong', 'a lone string rather than a list', 'kept'])
  })

  it('falls back to the message when the errors object has nothing to show, and still prefers the envelope list', () => {
    expect(apiErrorMessages(axiosError(400, { errors: {}, message: 'Nope' }))).toEqual(['Nope'])
    expect(apiErrorMessages(axiosError(400, { errors: { Field: [] } }))).toEqual([])
    expect(apiErrorMessages(axiosError(409, { success: false, errors: ['one', 'two'], message: 'ignored' }))).toEqual(['one', 'two'])
  })

  it('pulls the Finish checklist out of a 422 SHIFT_FINISH_BLOCKED, and only out of that', () => {
    const detail = { finishBlockers: [blocker] } as unknown as PortalShiftDetailDto
    const blocked = axiosError(422, { success: false, code: 'SHIFT_FINISH_BLOCKED', errors: [blocker.message], data: detail })

    expect(finishBlockersFromError(blocked)).toEqual([blocker])
    expect(shiftDetailFromError(blocked)).toBe(detail)
    expect(finishBlockersFromError(axiosError(409, { success: false, code: 'SHIFT_NOTE_REQUIRED', data: detail }))).toEqual([])
  })

  it('returns the refreshed shift on a 409 SHIFT_HANDOVER_CHANGED, but not for unrelated errors', () => {
    const detail = { id: 'shift-1' } as unknown as PortalShiftDetailDto

    expect(shiftDetailFromError(axiosError(409, { success: false, code: 'SHIFT_HANDOVER_CHANGED', data: detail }))).toBe(detail)
    expect(shiftDetailFromError(axiosError(409, { success: false, code: 'SHIFT_BREAK_OVERLAP', data: detail }))).toBeUndefined()
  })

  it('returns the EXISTING record from a 409 ADMINISTRATION_ALREADY_RECORDED', () => {
    const existing = { id: 'adm-1', recordedByName: 'Jamie Lee' } as unknown as AdministrationDto
    const conflict = axiosError(409, { success: false, code: 'ADMINISTRATION_ALREADY_RECORDED', errors: ['This dose has already been recorded.'], data: existing })

    expect(existingAdministrationFromError(conflict)).toBe(existing)
    expect(existingAdministrationFromError(axiosError(409, { success: false, code: 'SHIFT_BREAK_OVERLAP', data: existing }))).toBeUndefined()
  })

  it.each([
    'MEDICATION_COMPETENCY_MISSING', 'MEDICATION_COMPETENCY_EXPIRED', 'MEDICATION_COMPETENCY_UNVERIFIABLE',
  ])('treats a 403 %s as a competency problem', (code) => {
    expect(isCompetencyError(axiosError(403, { success: false, code, errors: ['x'] }))).toBe(true)
  })

  it('does not treat other 403s or other codes as competency problems', () => {
    expect(isCompetencyError(axiosError(403, { success: false }))).toBe(false)
    expect(isCompetencyError(axiosError(409, { success: false, code: 'MEDICATION_COMPETENCY_MISSING' }))).toBe(false)
  })
})

describe('isDoseTimeError', () => {
  it.each(['ADMINISTRATION_TOO_EARLY', 'ADMINISTRATION_TIME_OUT_OF_RANGE'])('recognises a 422 %s', (code) => {
    expect(isDoseTimeError(axiosError(422, { success: false, code, errors: ['This dose is not due until 12:30.'] }))).toBe(true)
  })

  it('is false for another 422 (a slot that is not due), for a 400 with the same code, and for no response', () => {
    expect(isDoseTimeError(axiosError(422, { success: false, code: 'DOSE_SLOT_NOT_DUE' }))).toBe(false)
    expect(isDoseTimeError(axiosError(400, { success: false, code: 'ADMINISTRATION_TOO_EARLY' }))).toBe(false)
    expect(isDoseTimeError(new Error('Network Error'))).toBe(false)
  })

  it('exposes both codes in the shared constants', () => {
    expect(SHIFT_PACKAGE_ERROR_CODES.administrationTooEarly).toBe('ADMINISTRATION_TOO_EARLY')
    expect(SHIFT_PACKAGE_ERROR_CODES.administrationTimeOutOfRange).toBe('ADMINISTRATION_TIME_OUT_OF_RANGE')
  })

  it('knows the slot-busy 409 by its code, with no record to show', () => {
    const busy = axiosError(409, { success: false, code: 'ADMINISTRATION_SLOT_BUSY', errors: ['Another request is recording this dose right now. Check the dose, then try again.'], data: null })

    expect(SHIFT_PACKAGE_ERROR_CODES.administrationSlotBusy).toBe('ADMINISTRATION_SLOT_BUSY')
    expect(hasApiErrorCode(busy, SHIFT_PACKAGE_ERROR_CODES.administrationSlotBusy)).toBe(true)
    expect(existingAdministrationFromError(busy)).toBeUndefined()   // unlike ADMINISTRATION_ALREADY_RECORDED, nothing was recorded
    expect(apiErrorMessages(busy)).toEqual(['Another request is recording this dose right now. Check the dose, then try again.'])
  })
})
