export type MapPin = { latitude: number; longitude: number }

const NUMBER = /^[+-]?\d+(\.\d+)?$/

/**
 * Reads the Service locations pin box: "latitude, longitude", as a map app copies it. A comma, semicolon or space between, brackets around,
 * and the typographic minus are all fine. The ranges match the server's (-90..90, -180..180), so a 400 for them is rare.
 */
export function parseMapPin(text: string): { pin: MapPin } | { error: string } {
  const cleaned = text.replace(/[−–]/g, '-').replace(/[()[\]]/g, ' ').trim()
  if (!cleaned) return { error: 'Enter the map pin as latitude, longitude.' }
  const parts = cleaned.split(/[,;\s]+/).filter(Boolean)
  if (parts.length !== 2 || !parts.every(p => NUMBER.test(p))) {
    return { error: 'Enter the pin as two numbers, latitude then longitude, like -33.8688, 151.2093.' }
  }
  const [latitude, longitude] = parts.map(Number)
  if (latitude < -90 || latitude > 90) return { error: 'Latitude must be between -90 and 90.' }
  if (longitude < -180 || longitude > 180) return { error: 'Longitude must be between -180 and 180.' }
  return { pin: { latitude, longitude } }
}

/** The pin as the box shows it: six places is about 11 cm, the most the server keeps. */
export const formatMapPin = (latitude: number, longitude: number) => `${+latitude.toFixed(6)}, ${+longitude.toFixed(6)}`
