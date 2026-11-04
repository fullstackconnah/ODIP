/** One saved place (GET /service-locations): hidden ones too, so a shift keeps its place's name. */
export interface ServiceLocationDto {
  id: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  /** How far from the pin a worker can start and still count as at the place. 50 to 2000. */
  radiusMetres: number
  /** One of the seven Australian zones; null follows the organisation's. */
  timeZoneId: string | null
  isActive: boolean
}

/** The body of POST and PUT /service-locations: the whole place. Hiding one is POST /{id}/archive. */
export interface SaveServiceLocationDto {
  name: string
  address: string | null
  latitude: number
  longitude: number
  radiusMetres: number
  timeZoneId: string | null
}
