import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPut } from '../client'
import type { UiPreferences } from '../types'

// UI PREFERENCES: mirrors UiPreferencesController (api/v1/me/ui-preferences), the signed-in person's saved screen choices.

export const UI_PREFERENCES_KEY = ['ui-preferences'] as const

export function useMyUiPreferences() {
  return useQuery({
    queryKey: UI_PREFERENCES_KEY,
    queryFn: () => apiGet<UiPreferences>('/me/ui-preferences'),
  })
}

/** One PUT per call. The cache takes the choice at once so a remount never re-applies an older server value; a refused save is not rolled back (the browser copy still holds the choice). */
export function useSaveUiPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: UiPreferences) => apiPut<UiPreferences>('/me/ui-preferences', prefs),
    onMutate: prefs => qc.setQueryData<UiPreferences>(UI_PREFERENCES_KEY, prefs),
  })
}
