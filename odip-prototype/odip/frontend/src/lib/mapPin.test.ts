import { describe, expect, it } from 'vitest'
import { formatMapPin, parseMapPin } from './mapPin'

describe('parseMapPin', () => {
  it.each([
    ['-33.8688, 151.2093', -33.8688, 151.2093],
    ['-33.8688,151.2093', -33.8688, 151.2093],
    ['  -33.8688   151.2093 ', -33.8688, 151.2093],
    ['-33.8688;151.2093', -33.8688, 151.2093],
    ['−33.8688, 151.2093', -33.8688, 151.2093], // the minus sign some map apps copy
    ['(-33.8688, 151.2093)', -33.8688, 151.2093], // pasted with brackets
    ['0, 0', 0, 0],
    ['90, 180', 90, 180],
    ['-90, -180', -90, -180],
  ])('reads %j', (text, latitude, longitude) => {
    expect(parseMapPin(text)).toEqual({ pin: { latitude, longitude } })
  })

  it('asks for a pin when the box is empty', () => {
    expect(parseMapPin('   ')).toEqual({ error: 'Enter the map pin as latitude, longitude.' })
  })

  it.each(['-33.8688', 'a, b', '1, 2, 3', '-33.8688 east', '12,5, 151,2'])('refuses %j as not two numbers', text => {
    expect(parseMapPin(text)).toEqual({ error: 'Enter the pin as two numbers, latitude then longitude, like -33.8688, 151.2093.' })
  })

  it('names the coordinate that is out of range', () => {
    expect(parseMapPin('91, 10')).toEqual({ error: 'Latitude must be between -90 and 90.' })
    expect(parseMapPin('10, 181')).toEqual({ error: 'Longitude must be between -180 and 180.' })
  })
})

describe('formatMapPin', () => {
  it('writes latitude, longitude to six places at most, without trailing zeros', () => {
    expect(formatMapPin(-33.8688, 151.2093)).toBe('-33.8688, 151.2093')
    expect(formatMapPin(-33.86881234567, 151.20931234567)).toBe('-33.868812, 151.209312')
    expect(formatMapPin(0, 0)).toBe('0, 0')
  })
})
