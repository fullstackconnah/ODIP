// Mirrors UiPreferencesDto (GET/PUT api/v1/me/ui-preferences). The server keeps only 'days' or 'list'; null when never chosen.
export interface UiPreferences {
  itineraryView: 'days' | 'list' | null
}
