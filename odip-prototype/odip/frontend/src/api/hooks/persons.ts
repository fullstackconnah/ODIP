import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../client'
import type { PersonDto } from '../types'

/** CONTACT-01: the tenant contact book — SearchableSelect's data source for the "existing
 * person" picker. `search` is debounced by the caller (see ContactsTab), not here. */
export function usePersons(search?: string) {
  return useQuery({
    queryKey: ['persons', search ?? ''],
    queryFn: () => apiGet<PersonDto[]>('/persons', { search: search || undefined }),
  })
}
