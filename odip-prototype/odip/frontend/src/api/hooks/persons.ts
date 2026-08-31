import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPostRaw, apiPutRaw } from '../client'
import type { PersonDto, CreatePersonDto, UpdatePersonDto } from '../types'

/** CONTACT-01: the tenant contact book — SearchableSelect's data source for the "existing
 * person" picker. `search` is debounced by the caller (see ContactsTab), not here. */
export function usePersons(search?: string) {
  return useQuery({
    queryKey: ['persons', search ?? ''],
    queryFn: () => apiGet<PersonDto[]>('/persons', { search: search || undefined }),
  })
}

export function useCreatePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreatePersonDto) => apiPostRaw<PersonDto>('/persons', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persons'] }),
  })
}

export function useUpdatePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePersonDto }) => apiPutRaw<PersonDto>(`/persons/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persons'] }),
  })
}
