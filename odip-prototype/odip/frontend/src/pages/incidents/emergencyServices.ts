import { EMERGENCY_SERVICES } from '@/api/types/enums'
import type { EmergencyService } from '@/api/types/enums'

/** The wire carries the flags as "Police, Fire" (or "None"); the form holds them as a list in the house order. */
export function parseEmergencyServices(wire: string | null | undefined): EmergencyService[] {
  const named = (wire ?? '').split(',').map((s) => s.trim())
  return EMERGENCY_SERVICES.filter((s) => named.includes(s))
}

type ServiceFields = {
  policeOfficerName?: string | null; policeReference?: string | null
  ambulanceOfficerName?: string | null; ambulanceReference?: string | null
  fireOfficerName?: string | null; fireReference?: string | null
}

/** Each ticked service with its officer name and reference (either may be missing), in Police, Ambulance, Fire order. */
export function emergencyServiceEntries(services: readonly EmergencyService[], f: ServiceFields) {
  const by = {
    Police: { name: f.policeOfficerName, ref: f.policeReference },
    Ambulance: { name: f.ambulanceOfficerName, ref: f.ambulanceReference },
    Fire: { name: f.fireOfficerName, ref: f.fireReference },
  }
  return EMERGENCY_SERVICES.filter((s) => services.includes(s)).map((service) => ({ service, name: by[service].name?.trim() || undefined, ref: by[service].ref?.trim() || undefined }))
}
