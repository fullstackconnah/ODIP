import { describe, expect, it } from 'vitest'
import { ADDRESS_NEEDS_CONFIRMATION, addressConfirmationRequest } from './addressConfirmation'

const SENTENCE =
  'jane@gmial.com is not at acme.com.au or a common email provider. The sign-in link goes to whoever owns this address. Check it is right.'

/** An axios-shaped failure: the API's envelope sits on `response.data`. */
const apiError = (status: number, data: object) => ({ response: { status, data } })

describe('addressConfirmationRequest', () => {
  it('is the server\'s sentence when the 400 carries the confirmation code, so the screen can ask instead of showing an error', () => {
    const error = apiError(400, { success: false, errors: [SENTENCE], code: ADDRESS_NEEDS_CONFIRMATION })

    expect(addressConfirmationRequest(error)).toBe(SENTENCE)
  })

  it('names the code the server sends', () => {
    expect(ADDRESS_NEEDS_CONFIRMATION).toBe('AddressNeedsConfirmation')
  })

  it('is null for any other 400, so an ordinary refusal is still shown as an error', () => {
    expect(addressConfirmationRequest(apiError(400, { success: false, errors: ['A user with this email already exists'] }))).toBeNull()
    expect(addressConfirmationRequest(apiError(400, { success: false, errors: ['x'], code: 'SomethingElse' }))).toBeNull()
  })

  it('is null for the same code on any other status, because only a 400 asks', () => {
    expect(addressConfirmationRequest(apiError(409, { success: false, errors: [SENTENCE], code: ADDRESS_NEEDS_CONFIRMATION }))).toBeNull()
    expect(addressConfirmationRequest(apiError(500, { success: false, errors: [SENTENCE], code: ADDRESS_NEEDS_CONFIRMATION }))).toBeNull()
  })

  it('is null for a failure that is not the API\'s at all', () => {
    expect(addressConfirmationRequest(new Error('Network Error'))).toBeNull()
    expect(addressConfirmationRequest(undefined)).toBeNull()
    expect(addressConfirmationRequest(null)).toBeNull()
  })

  it('still asks, with a sentence of its own, when the 400 carries the code but no words', () => {
    const asked = addressConfirmationRequest(apiError(400, { success: false, code: ADDRESS_NEEDS_CONFIRMATION }))

    expect(asked).toBe('This address is not at your organisation\'s domain or a common email provider. The sign-in link goes to whoever owns it. Check it is right.')
  })
})
