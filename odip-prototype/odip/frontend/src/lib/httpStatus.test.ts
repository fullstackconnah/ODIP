import { describe, it, expect } from 'vitest'
import { httpStatusOf, isNotFoundError } from './httpStatus'

const axiosLike = (status: number) => ({ isAxiosError: true, response: { status, data: {} } })

describe('httpStatusOf', () => {
  it('reads the status of an axios-style error', () => {
    expect(httpStatusOf(axiosLike(404))).toBe(404)
    expect(httpStatusOf(axiosLike(500))).toBe(500)
  })

  it('is undefined when the error carries no response (a dropped connection, a thrown string, nothing)', () => {
    expect(httpStatusOf(new Error('Network Error'))).toBeUndefined()
    expect(httpStatusOf('boom')).toBeUndefined()
    expect(httpStatusOf(null)).toBeUndefined()
    expect(httpStatusOf(undefined)).toBeUndefined()
  })
})

describe('isNotFoundError', () => {
  it('is true only for a 404', () => {
    expect(isNotFoundError(axiosLike(404))).toBe(true)
    for (const status of [400, 401, 403, 409, 500, 503]) expect(isNotFoundError(axiosLike(status))).toBe(false)
  })

  it('is false when there is no error to classify', () => {
    expect(isNotFoundError(undefined)).toBe(false)
    expect(isNotFoundError(null)).toBe(false)
    expect(isNotFoundError(new Error('Network Error'))).toBe(false)
  })
})
